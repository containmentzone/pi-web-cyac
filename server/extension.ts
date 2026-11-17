// pi extension entry: `pi install npm:@containmentzone/pi-web-cyac`, then `/web` inside pi.
// The web server runs inside the pi process and uses the host's pi installation.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// Static import on purpose: pi resolves @earendil-works/pi-coding-agent to the host install only
// for modules loaded through its extension loader, which a dynamic import() would bypass.
import { startServer, type WebServer } from "./app.js";

// pi loads extensions once per session (web threads are sessions too), so the running
// server is kept on globalThis rather than in module state.
const KEY = Symbol.for("pi-web-cyac.server");
type Holder = { [KEY]?: Promise<WebServer> };
const holder = globalThis as Holder;

function parseTarget(arg: string): { host?: string; port?: number } {
  const t = arg.trim();
  if (!t) return {};
  if (/^\d+$/.test(t)) return { port: Number(t) };
  const m = /^(.*):(\d+)$/.exec(t);
  return m ? { host: m[1]!.replace(/^\[|\]$/g, ""), port: Number(m[2]) } : { host: t };
}

async function start(target: { host?: string; port?: number }): Promise<WebServer> {
  if (!holder[KEY]) {
    holder[KEY] = startServer({ ...target, log: () => {} }).catch((err) => {
      holder[KEY] = undefined;
      throw err;
    });
  }
  return holder[KEY]!;
}

export default function piWeb(pi: ExtensionAPI) {
  pi.registerCommand("web", {
    description: "Start the CyAc web UI for pi (/web [host:port], /web stop)",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();
      if (arg === "stop") {
        const running = holder[KEY];
        holder[KEY] = undefined;
        if (running) await (await running).close();
        ctx.ui.notify(running ? "pi web UI stopped" : "pi web UI is not running", "info");
        return;
      }
      try {
        const server = await start(parseTarget(arg));
        ctx.ui.notify(`pi web UI: ${server.url}`, "info");
      } catch (err) {
        ctx.ui.notify(`pi web UI failed to start: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // PI_WEB_AUTOSTART=1 starts the server as soon as pi loads the extension.
  if (process.env.PI_WEB_AUTOSTART === "1" || process.env.PI_WEB_AUTOSTART === "true") {
    void start({}).catch(() => {});
  }
}
