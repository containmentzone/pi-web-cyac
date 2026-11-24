import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import type { WebSocket } from "ws";
import type { TermClientMsg, TermServerMsg } from "../shared/protocol.js";

/**
 * Interactive shells for the web UI's terminal panel. Each thread gets at most one shell,
 * started in the thread's working directory. The shell outlives the browser tab: closing the panel
 * or losing the connection only detaches, and reattaching replays recent output. It ends when the
 * shell exits, when someone kills it from the panel, or when the server stops.
 */

interface IPty {
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  readonly pid: number;
}
interface PtyModule {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): IPty;
}

// Loaded lazily so a platform without a prebuilt PTY still runs the rest of the web UI.
let ptyModule: PtyModule | Error | undefined;
function loadPty(): PtyModule {
  if (!ptyModule) {
    try {
      ptyModule = createRequire(import.meta.url)("@lydell/node-pty") as PtyModule;
    } catch (err) {
      ptyModule = new Error(`No terminal support on this platform (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (ptyModule instanceof Error) throw ptyModule;
  return ptyModule;
}

/**
 * Linux no_new_privs is inherited by every child and can never be cleared, so when the server runs
 * with it (systemd NoNewPrivileges=, or options that imply it), sudo in the shell cannot work.
 */
function noNewPrivs(): boolean {
  try {
    return /^NoNewPrivs:\s*1/m.test(readFileSync("/proc/self/status", "utf8"));
  } catch {
    return false;
  }
}

/** A viewer this far behind is dropped; its tab reconnects and catches up from the replay buffer. */
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

/** Recent output kept for replay when a browser (re)attaches. */
const SCROLLBACK_BYTES = 256 * 1024;

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: process.env.COMSPEC || "powershell.exe", args: [] };
  const fromEnv = process.env.PI_WEB_SHELL || process.env.SHELL;
  const file = fromEnv && existsSync(fromEnv) ? fromEnv : existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  return { file, args: ["-l"] };
}

class Shell {
  readonly pty: IPty;
  private buffer = "";
  readonly sockets = new Set<WebSocket>();
  exited = false;

  constructor(
    readonly cwd: string,
    cols: number,
    rows: number,
    private onGone: () => void,
  ) {
    const { file, args } = defaultShell();
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", PI_WEB_TERMINAL: "1" };
    this.pty = loadPty().spawn(file, args, { name: "xterm-256color", cols, rows, cwd: existsSync(cwd) ? cwd : homedir(), env });
    this.pty.onData((data) => {
      this.buffer += data;
      if (this.buffer.length > SCROLLBACK_BYTES) this.buffer = this.buffer.slice(-SCROLLBACK_BYTES);
      this.broadcast({ type: "output", data });
    });
    this.pty.onExit(({ exitCode }) => {
      this.exited = true;
      this.broadcast({ type: "exit", code: exitCode });
      this.onGone();
    });
  }

  broadcast(msg: TermServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > MAX_QUEUED_BYTES) {
        this.sockets.delete(ws);
        ws.terminate();
        continue;
      }
      ws.send(raw);
    }
  }

  attach(ws: WebSocket): void {
    this.sockets.add(ws);
    const send = (msg: TermServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    send({ type: "ready", cwd: this.cwd, pid: this.pty.pid, replay: this.buffer, noNewPrivs: noNewPrivs() });
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.pty.kill(process.platform === "win32" ? undefined : "SIGHUP");
    } catch {
      // Already gone.
    }
  }
}

export class TerminalManager {
  private shells = new Map<string, Shell>();
  /** Shells being started, so two opens for one thread share a single shell. */
  private pending = new Map<string, Promise<Shell>>();
  private closed = false;

  constructor(private resolveCwd: (threadId: string) => Promise<string | undefined>) {}

  /** Serve one browser's terminal socket for a thread. */
  async handle(ws: WebSocket, threadId: string): Promise<void> {
    const send = (msg: TermServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    let shell: Shell | undefined;

    const start = async (cols: number, rows: number): Promise<Shell> => {
      const existing = this.shells.get(threadId);
      if (existing && !existing.exited) {
        // Reattaching from a panel of another size: the shell takes the newest size.
        existing.pty.resize(cols, rows);
        return existing;
      }
      let creating = this.pending.get(threadId);
      if (!creating) {
        creating = (async () => {
          const cwd = await this.resolveCwd(threadId);
          if (this.closed) throw new Error("Server is shutting down");
          if (!cwd) throw new Error("Unknown thread");
          const created = new Shell(cwd, cols, rows, () => {
            if (this.shells.get(threadId) === created) this.shells.delete(threadId);
          });
          this.shells.set(threadId, created);
          return created;
        })().finally(() => this.pending.delete(threadId));
        this.pending.set(threadId, creating);
      }
      return creating;
    };

    // ws emits "error" for oversized or malformed frames; without a listener that would crash the server.
    ws.on("error", () => {
      shell?.sockets.delete(ws);
      ws.terminate();
    });

    ws.on("message", async (data) => {
      let msg: TermClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          case "open": {
            shell?.sockets.delete(ws);
            shell = await start(clamp(msg.cols, 2, 500), clamp(msg.rows, 2, 300));
            shell.attach(ws);
            return;
          }
          case "input":
            if (shell && !shell.exited) shell.pty.write(msg.data);
            return;
          case "resize":
            if (shell && !shell.exited) shell.pty.resize(clamp(msg.cols, 2, 500), clamp(msg.rows, 2, 300));
            return;
          case "kill":
            shell?.kill();
            return;
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
    ws.on("close", () => shell?.sockets.delete(ws));
  }

  shutdown(): void {
    this.closed = true;
    for (const shell of this.shells.values()) shell.kill();
    this.shells.clear();
  }
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : min;
}
