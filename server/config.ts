import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));

function findWebDir(): string | undefined {
  if (process.env.PI_WEB_STATIC_DIR) return resolve(process.env.PI_WEB_STATIC_DIR);
  // Built layout: dist/server/server/index.js -> dist/web. Dev layout: server/index.ts -> dist/web.
  for (const candidate of [join(here, "../../web"), join(here, "../dist/web")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return undefined;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Bind address. Defaults to loopback; set it to your Tailscale IP (or 0.0.0.0 inside a container). */
  host: process.env.PI_WEB_HOST ?? "127.0.0.1",
  port: int("PI_WEB_PORT", 8787),
  /** Working directory offered for new threads. */
  defaultCwd: resolve(process.env.PI_WEB_CWD ?? process.cwd() ?? homedir()),
  /** Custom pi session directory. Unset = pi's default (~/.pi/agent/sessions, or PI_CODING_AGENT_SESSION_DIR). */
  sessionDir: process.env.PI_WEB_SESSION_DIR ? resolve(process.env.PI_WEB_SESSION_DIR) : undefined,
  /** UI-only thread metadata (archived flags). Never stored in pi's session files. */
  stateFile: resolve(process.env.PI_WEB_STATE_FILE ?? join(getAgentDir(), "pi-web", "threads.json")),
  /** Idle live sessions with no viewers are disposed after this many minutes and reopened on demand. */
  idleMinutes: int("PI_WEB_IDLE_MINUTES", 30),
  webDir: findWebDir(),
};
