import type { CSSProperties, ReactNode } from "react";

/**
 * Minimal ANSI renderer for terminal panels: SGR colours (16, 256, truecolor), bold, dim, italic,
 * underline, inverse, strikethrough, and OSC 8 hyperlinks. Other escapes are dropped.
 */

const BASE16 = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
];

function color256(n: number): string {
  if (n < 16) return BASE16[n]!;
  if (n < 232) {
    const i = n - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(i / 36)]!;
    const g = steps[Math.floor((i % 36) / 6)]!;
    const b = steps[i % 6]!;
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

function applySgr(style: Style, params: number[]): Style {
  const s = { ...style };
  if (params.length === 0) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) {
      for (const k of Object.keys(s)) delete s[k as keyof Style];
    } else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 9) s.strike = true;
    else if (p === 22) s.bold = s.dim = false;
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p === 27) s.inverse = false;
    else if (p === 29) s.strike = false;
    else if (p >= 30 && p <= 37) s.fg = BASE16[p - 30];
    else if (p >= 90 && p <= 97) s.fg = BASE16[p - 90 + 8];
    else if (p >= 40 && p <= 47) s.bg = BASE16[p - 40];
    else if (p >= 100 && p <= 107) s.bg = BASE16[p - 100 + 8];
    else if (p === 39) s.fg = undefined;
    else if (p === 49) s.bg = undefined;
    else if (p === 38 || p === 48) {
      const mode = params[i + 1];
      let value: string | undefined;
      if (mode === 5) {
        value = color256(params[i + 2] ?? 0);
        i += 2;
      } else if (mode === 2) {
        value = `rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`;
        i += 4;
      }
      if (p === 38) s.fg = value;
      else s.bg = value;
    }
  }
  return s;
}

function css(s: Style): CSSProperties | undefined {
  const out: CSSProperties = {};
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) {
    fg = s.bg ?? "var(--bg)";
    bg = s.fg ?? "var(--ink)";
  }
  if (fg) out.color = fg;
  if (bg) out.backgroundColor = bg;
  if (s.bold) out.fontWeight = 700;
  if (s.dim) out.opacity = 0.6;
  if (s.italic) out.fontStyle = "italic";
  const deco = [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ");
  if (deco) out.textDecoration = deco;
  return Object.keys(out).length ? out : undefined;
}

// CSI ... final byte | OSC ... (BEL | ESC \) | APC/other ESC sequences.
const TOKEN = /\u001b\[([0-9;:?]*)([@-~])|\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|\u001b[_P^]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function renderAnsiLine(line: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let style: Style = {};
  let link: string | undefined;
  let last = 0;
  let n = 0;
  const push = (text: string) => {
    if (!text) return;
    const span = (
      <span key={n++} style={css(style)}>
        {text}
      </span>
    );
    parts.push(
      link ? (
        <a key={n++} href={link} target="_blank" rel="noreferrer">
          {span}
        </a>
      ) : (
        span
      ),
    );
  };
  for (const m of line.matchAll(TOKEN)) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] === "m") {
      style = applySgr(
        style,
        (m[1] ?? "")
          .split(/[;:]/)
          .filter((x) => x !== "")
          .map(Number),
      );
    } else if (m[3] !== undefined) {
      const osc = /^8;[^;]*;(.*)$/.exec(m[3]);
      if (osc) link = osc[1] || undefined;
    }
  }
  push(line.slice(last));
  return (
    <div key={key} className="term__line">
      {parts.length ? parts : " "}
    </div>
  );
}

/** Browser key event → terminal input bytes, as pi-tui expects them. */
export function keyToTerminal(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): string | undefined {
  if (e.metaKey) return undefined;
  const named: Record<string, string> = {
    ArrowUp: "\u001b[A",
    ArrowDown: "\u001b[B",
    ArrowRight: "\u001b[C",
    ArrowLeft: "\u001b[D",
    Enter: "\r",
    Escape: "\u001b",
    Backspace: "\u007f",
    Tab: e.shiftKey ? "\u001b[Z" : "\t",
    Home: "\u001b[H",
    End: "\u001b[F",
    PageUp: "\u001b[5~",
    PageDown: "\u001b[6~",
    Delete: "\u001b[3~",
  };
  let out = named[e.key];
  if (!out && e.ctrlKey && /^[a-z]$/i.test(e.key)) out = String.fromCharCode(e.key.toLowerCase().charCodeAt(0) - 96);
  if (!out && e.key.length === 1 && !e.ctrlKey) out = e.key;
  if (out && e.altKey) out = `\u001b${out}`;
  return out;
}
