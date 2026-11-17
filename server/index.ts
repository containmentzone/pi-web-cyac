import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type WebSocket, WebSocketServer } from "ws";
import type { ClientMsg, ServerMsg } from "../shared/protocol.js";
import { config } from "./config.js";
import type { Client, LiveThread } from "./live-thread.js";
import { ThreadManager } from "./threads.js";

const manager = await ThreadManager.create();
const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, pi: VERSION }));

app.get("/api/threads", async (c) => c.json(await manager.list()));

app.post("/api/threads", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { cwd?: string };
  try {
    const thread = await manager.create(body.cwd || undefined);
    return c.json(manager.summaryFor(thread), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

if (config.webDir) {
  const webDir = config.webDir;
  const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: webDir }));
  // Single-page app: unknown paths get index.html (thread ids live in the URL hash, so this is rare).
  app.get("*", (c) => c.html(indexHtml));
} else {
  app.get("/", (c) => c.text("pi-web: no built frontend found. Run `npm run build`, or use `npm run dev`.", 503));
}

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

wss.on("connection", async (ws: WebSocket) => {
  const subscriptions = new Map<string, LiveThread>();
  const client: Client = {
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  manager.clients.add(client);

  const fail = (message: string, threadId?: string) => client.send({ type: "error", message, threadId });

  ws.on("message", async (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return fail("Malformed message");
    }
    const threadId = "threadId" in msg ? msg.threadId : undefined;
    try {
      switch (msg.type) {
        case "subscribe": {
          const thread = await manager.get(msg.threadId);
          subscriptions.set(msg.threadId, thread);
          thread.attach(client);
          return;
        }
        case "unsubscribe": {
          subscriptions.get(msg.threadId)?.detach(client);
          subscriptions.delete(msg.threadId);
          return;
        }
        case "create_thread": {
          const thread = await manager.create(msg.cwd || undefined);
          client.send({ type: "focus", threadId: thread.id, reqId: msg.reqId });
          return;
        }
        case "archive":
          manager.setArchived(msg.threadId, msg.archived);
          return;
      }
      const thread = await manager.get(msg.threadId);
      switch (msg.type) {
        case "prompt":
          await thread.prompt(msg.text, msg.behavior);
          return;
        case "abort":
          await thread.abort();
          return;
        case "ui_response":
          thread.answer(msg.response);
          return;
        case "set_model": {
          const model = manager.models.getModel(msg.provider, msg.modelId);
          if (!model) return fail(`Model not found: ${msg.provider}/${msg.modelId}`, msg.threadId);
          await thread.session.setModel(model);
          thread.pushState();
          return;
        }
        case "set_thinking":
          thread.session.setThinkingLevel(msg.level as Parameters<typeof thread.session.setThinkingLevel>[0]);
          thread.pushState();
          return;
        case "rename":
          thread.session.setSessionName(msg.name.trim());
          return;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err), threadId);
    }
  });

  ws.on("close", () => {
    manager.clients.delete(client);
    for (const thread of subscriptions.values()) thread.detach(client);
    subscriptions.clear();
  });

  client.send({ type: "hello", defaultCwd: config.defaultCwd, models: await manager.availableModels(), version: VERSION });
  client.send({ type: "threads", threads: await manager.list() });
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[pi-web] pi ${VERSION} · http://${info.address}:${info.port}`);
  if (!config.webDir) console.log("[pi-web] no built frontend found; API and WebSocket only");
});

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

let stopping = false;
const shutdown = async () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("[pi-web] shutting down");
  for (const ws of wss.clients) ws.close(1001, "server shutting down");
  await manager.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
