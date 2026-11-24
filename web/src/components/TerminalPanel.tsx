import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TermClientMsg, TermServerMsg } from "../../../shared/protocol";
import { Badge, Button } from "../cyac";
import { toggleTerminal, useStore } from "../store";
import { useTheme } from "../theme";
import { tildify } from "./format";

/**
 * Interactive shell for a thread, docked under the transcript. The shell runs on the server in the
 * thread's working directory and keeps running while the panel is hidden or the page reloads;
 * reopening reattaches and replays recent output.
 */

type Status = { kind: "connecting" } | { kind: "live"; pid: number } | { kind: "exited"; code: number } | { kind: "error"; message: string };

const HEIGHT_KEY = "pi-web-term-height";
const MIN_HEIGHT = 120;

function readHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(n) && n >= MIN_HEIGHT) return n;
  } catch {
    // Default height below.
  }
  return Math.round(window.innerHeight * 0.38);
}

/** Terminal colours from the CyAc tokens of the active theme. */
function themeFromTokens(theme: "void" | "paper"): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = theme === "void";
  return {
    background: v("--bg"),
    foreground: v("--ink"),
    cursor: v("--focus"),
    cursorAccent: v("--bg"),
    selectionBackground: dark ? "#c8ff1a55" : "#1a1cf533",
    black: dark ? v("--surface-raised") : v("--ink"),
    red: v("--pulse-text"),
    green: v("--brand-text"),
    yellow: v("--caution-text"),
    blue: v("--cobalt-text"),
    magenta: dark ? "#d38cff" : "#7a2a9e",
    cyan: v("--cyan-text"),
    white: dark ? v("--ink-muted") : v("--line-strong"),
    brightBlack: dark ? v("--line-strong") : v("--ink-muted"),
    brightRed: dark ? "#ff8ab5" : v("--pulse-text"),
    brightGreen: dark ? v("--brand") : "#00852a",
    brightYellow: v("--acid-text"),
    brightBlue: dark ? "#b3b6ff" : v("--cobalt"),
    brightMagenta: dark ? "#e6b8ff" : "#93339c",
    brightCyan: dark ? "#8af1ff" : "#00809a",
    brightWhite: dark ? v("--ink") : v("--surface-raised"),
  };
}

// Keys a phone keyboard lacks, shown on touch screens only.
const KEYS: { label: string; seq: string; title: string }[] = [
  { label: "Esc", seq: "\u001b", title: "Escape" },
  { label: "Tab", seq: "\t", title: "Tab" },
  { label: "^C", seq: "\u0003", title: "Ctrl+C" },
  { label: "^D", seq: "\u0004", title: "Ctrl+D" },
  { label: "↑", seq: "\u001b[A", title: "Up" },
  { label: "↓", seq: "\u001b[B", title: "Down" },
  { label: "←", seq: "\u001b[D", title: "Left" },
  { label: "→", seq: "\u001b[C", title: "Right" },
];

export function TerminalPanel({ threadId }: { threadId: string }) {
  const theme = useTheme();
  const home = useStore((s) => s.home);
  const cwd = useStore((s) => s.threads.find((t) => t.id === threadId)?.cwd);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const sendRef = useRef<(msg: TermClientMsg) => void>(() => {});
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [height, setHeight] = useState(readHeight);
  const [nnp, setNnp] = useState(false);

  useEffect(() => {
    const host = hostRef.current!;
    const css = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily: css.getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowProposedApi: false,
      theme: themeFromTokens(document.documentElement.getAttribute("data-theme") === "paper" ? "paper" : "void"),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    // Ctrl+` belongs to the page (it hides the panel), not the shell.
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.key === "`"));

    let ws: WebSocket | null = null;
    let disposed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let size = { cols: 0, rows: 0 };

    const send = (msg: TermClientMsg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    sendRef.current = send;

    const refit = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols !== size.cols || term.rows !== size.rows) {
        size = { cols: term.cols, rows: term.rows };
        send({ type: "resize", ...size });
      }
    };

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${window.location.host}/ws/term?thread=${encodeURIComponent(threadId)}`);
      ws = sock;
      setStatus({ kind: "connecting" });
      sock.onopen = () => {
        retry = 0;
        refit();
        size = { cols: term.cols, rows: term.rows };
        send({ type: "open", ...size });
      };
      sock.onmessage = (ev) => {
        let msg: TermServerMsg;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case "ready":
            term.reset();
            if (msg.replay) term.write(msg.replay);
            setNnp(msg.noNewPrivs);
            setStatus({ kind: "live", pid: msg.pid });
            return;
          case "output":
            term.write(msg.data);
            return;
          case "exit":
            term.write(`\r\n\u001b[2m[process exited with code ${msg.code}]\u001b[0m\r\n`);
            setStatus({ kind: "exited", code: msg.code });
            return;
          case "error":
            setStatus({ kind: "error", message: msg.message });
            return;
        }
      };
      sock.onclose = () => {
        if (disposed || ws !== sock) return;
        ws = null;
        setStatus((s) => (s.kind === "exited" || s.kind === "error" ? s : { kind: "connecting" }));
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };

    const onData = term.onData((data) => send({ type: "input", data }));
    const ro = new ResizeObserver(() => refit());
    ro.observe(host);
    // Measure with the real font once it has loaded, or the grid comes out the wrong size.
    void document.fonts?.ready.then(() => !disposed && refit());
    connect();
    term.focus();

    return () => {
      disposed = true;
      clearTimeout(timer);
      ro.disconnect();
      onData.dispose();
      ws?.close();
      term.dispose();
      termRef.current = null;
      sendRef.current = () => {};
    };
  }, [threadId]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themeFromTokens(theme);
  }, [theme]);

  const restart = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    sendRef.current({ type: "open", cols: term.cols, rows: term.rows });
    term.focus();
  }, []);

  // Drag the top edge to resize; the height is remembered for every thread.
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const max = Math.max(MIN_HEIGHT, window.innerHeight - 200);
    let next = startH;
    const move = (ev: PointerEvent) => {
      next = Math.min(max, Math.max(MIN_HEIGHT, startH + (startY - ev.clientY)));
      setHeight(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(next)));
      } catch {
        // Height resets on reload.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const badge =
    status.kind === "live" ? (
      <Badge tone="accent" dot>
        LIVE
      </Badge>
    ) : status.kind === "exited" ? (
      <Badge tone="caution">EXIT {status.code}</Badge>
    ) : status.kind === "error" ? (
      <Badge tone="alert">ERROR</Badge>
    ) : (
      <Badge dot>LINKING</Badge>
    );

  return (
    <section className="tty" style={{ height }} aria-label="Terminal">
      <div
        className="tty__grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onPointerDown={onDragStart}
      />
      <header className="tty__head">
        <span className="tty__code">TTY</span>
        {badge}
        <span className="tty__cwd" title={cwd}>
          {cwd ? tildify(cwd, home) : ""}
          {status.kind === "live" ? ` · pid ${status.pid}` : ""}
        </span>
        <span className="tty__actions">
          {status.kind === "exited" || status.kind === "error" ? (
            <Button size="xs" variant="ghost" onClick={restart}>
              New shell
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => sendRef.current({ type: "kill" })} disabled={status.kind !== "live"} title="End the shell">
              Kill
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => toggleTerminal(threadId, false)} title="Hide the panel (Ctrl+`). The shell keeps running.">
            Hide
          </Button>
        </span>
      </header>
      {status.kind === "error" && <div className="tty__error">{status.message}</div>}
      {nnp && (
        <div className="tty__warn">
          <Badge tone="caution" /> pi runs with no_new_privs, so sudo will fail in this shell. Turn off NoNewPrivileges (and options
          that imply it) where pi is launched.
        </div>
      )}
      <div className="tty__screen" ref={hostRef} onClick={() => termRef.current?.focus()} />
      <div className="tty__keys" aria-label="Terminal keys">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            className="tty__key"
            title={k.title}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => sendRef.current({ type: "input", data: k.seq })}
          >
            {k.label}
          </button>
        ))}
      </div>
    </section>
  );
}
