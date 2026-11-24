import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type WebSocket, WebSocketServer } from "ws";
import type { ClientMsg, ServerMsg } from "../shared/protocol.js";
import { completeArgs } from "./commands.js";
import { config } from "./config.js";
import type { Client, LiveThread } from "./live-thread.js";
import { TerminalManager } from "./terminal.js";
import { ThreadManager } from "./threads.js";

export interface WebServerOptions {
  host?: string;
  port?: number;
  /** Log lines go here; the pi extension routes them away from the terminal UI. */
  log?: (line: string) => void;
}

export interface WebServer {
  url: string;
  close(): Promise<void>;
}

/** Start the HTTP + WebSocket server. Used by the standalone CLI and by the pi extension. */
export async function startServer(options: WebServerOptions = {}): Promise<WebServer> {
  const log = options.log ?? ((line: string) => console.log(line));
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;
  const manager = await ThreadManager.create();
  const terminals = new TerminalManager(async (threadId) => (await manager.list()).find((t) => t.id === threadId)?.cwd);
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
          case "ui_action":
            thread.act(msg.id, msg.action);
            return;
          case "complete": {
            const items = await completeArgs(thread.session, msg.text);
            client.send({ type: "completions", threadId: msg.threadId, reqId: msg.reqId, items });
            return;
          }
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

    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      manager.clients.delete(client);
      for (const thread of subscriptions.values()) thread.detach(client);
      subscriptions.clear();
    });

    client.send({ type: "hello", defaultCwd: config.defaultCwd, home: homedir(), models: await manager.availableModels(), version: VERSION, terminal: config.terminal });
    client.send({ type: "threads", threads: await manager.list() });
  });

  const server = serve({ fetch: app.fetch, hostname: host, port });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${boundPort}`;
  log(`[pi-web] pi ${VERSION} · ${url}`);
  if (!config.webDir) log("[pi-web] no built frontend found; API and WebSocket only");

  const termWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    if (reqUrl.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    const threadId = reqUrl.searchParams.get("thread");
    // A shell is a step past prompting the agent, so only pages served by this server may open one:
    // another site open in the same browser must not reach it through the tailnet address.
    if (reqUrl.pathname === "/ws/term" && config.terminal && threadId && allowedHost(req) && sameOrigin(req)) {
      termWss.handleUpgrade(req, socket, head, (ws) => void terminals.handle(ws, threadId));
      return;
    }
    socket.destroy();
  });

  let closing: Promise<void> | undefined;
  return {
    url,
    close() {
      closing ??= (async () => {
        for (const ws of wss.clients) ws.close(1001, "server shutting down");
        for (const ws of termWss.clients) ws.close(1001, "server shutting down");
        terminals.shutdown();
        await manager.shutdown();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })();
      return closing;
    },
  };
}

/**
 * DNS rebinding guard: a hostile domain re-pointed at this machine would pass the Origin check, but its
 * Host header still names that domain. Allow IP literals, localhost, single-label names (MagicDNS short
 * names), *.ts.net, and anything listed in PI_WEB_ALLOWED_HOSTS.
 */
function allowedHost(req: IncomingMessage): boolean {
  const forwarded = req.headers["x-forwarded-host"];
  // Behind a proxy that only forwards the hosts it serves (PI_WEB_TRUST_PROXY, e.g. the cyac proxy),
  // its X-Forwarded-Host is good enough: a browser cannot set that header on a WebSocket, so a rebound
  // domain reaching this port directly has none and falls through to the checks below.
  if (config.trustProxy && typeof forwarded === "string" && forwarded !== "") return true;
  if (!req.headers.host || !isAllowedHostName(req.headers.host)) return false;
  // A proxy may rewrite Host to localhost and pass the browser's host along; that one must pass too.
  if (forwarded === undefined) return true;
  const entries = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded).split(",").map((h) => h.trim());
  return entries.every((h) => h !== "" && isAllowedHostName(h));
}

function isAllowedHostName(raw: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (!hostname.includes(".")) return true;
  if (hostname.endsWith(".ts.net")) return true;
  return config.allowedHosts.some((h) => hostname === h || (h.startsWith(".") && hostname.endsWith(h)));
}

/** True when the browser says the page came from this host (or sent no Origin, like a CLI client). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    // Reverse proxies such as `tailscale serve` may rewrite Host and pass the original along.
    const forwarded = req.headers["x-forwarded-host"];
    return host === req.headers.host || (typeof forwarded === "string" && forwarded.split(",").some((h) => h.trim() === host));
  } catch {
    return false;
  }
}
