import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { UIAction, UIRequest, UIResponse } from "../shared/protocol.js";

/**
 * Runs pi TUI components (ctx.ui.custom factories, such as the /mcp manager) on the server
 * without a terminal: the component renders to ANSI lines at a fixed width, the lines are mirrored
 * into a terminal panel in the browser, and keys typed there are fed back as terminal input.
 */

export interface TerminalHost {
  openDialog(request: UIRequest, finish: (response?: UIResponse) => void, onAction?: (action: UIAction) => void): void;
  updateDialog(request: UIRequest): void;
  closeDialog(id: string): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

const WIDTH = 96;
const ROWS = 40;
const CURSOR_MARKER = "\u001b_pi:c\u0007";

type Theme = unknown;
const THEME_KEY = Symbol.for("pi-web-cyac.theme");
const store = globalThis as { [THEME_KEY]?: Theme };

/** The pi extension hands over the host's real theme when it runs inside pi's TUI. */
export function setHostTheme(theme: Theme | undefined): void {
  if (theme) store[THEME_KEY] = theme;
}

let fallbackTheme: Promise<Theme | undefined> | undefined;
async function getTheme(): Promise<Theme | undefined> {
  if (store[THEME_KEY]) return store[THEME_KEY];
  // Standalone server: load pi's theme module directly and initialise the dark theme.
  fallbackTheme ??= (async () => {
    try {
      const mod = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/theme/theme.js")).href);
      mod.initTheme?.("dark");
      return mod.theme as Theme;
    } catch {
      return undefined;
    }
  })();
  return fallbackTheme;
}

function keybindings(): unknown {
  const kb = getKeybindings();
  return new Proxy(kb, {
    get(target, prop, receiver) {
      if (prop === "matches") {
        return (data: string, id: string) => {
          try {
            return target.matches(data, id as never);
          } catch {
            return false;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  dispose?(): void;
  focused?: boolean;
}

export async function runCustom<T>(
  host: TerminalHost,
  factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: T) => void) => unknown,
  options?: { overlayOptions?: unknown },
): Promise<T | undefined> {
  const theme = await getTheme();
  if (!theme) {
    host.notify("This extension UI needs pi's terminal theme, which is not available here.", "warning");
    return undefined;
  }
  const id = randomUUID();
  let component: Component | undefined;
  let finished = false;
  let opened = false;
  let scheduled = false;
  let resolveResult: (value: T | undefined) => void = () => {};
  const result = new Promise<T | undefined>((r) => (resolveResult = r));

  const draw = (): UIRequest => {
    let lines: string[] = [];
    try {
      lines = component ? component.render(WIDTH) : [];
    } catch (err) {
      lines = [`render error: ${err instanceof Error ? err.message : String(err)}`];
    }
    return { id, method: "terminal", title: "", lines: lines.map((l) => l.split(CURSOR_MARKER).join("")) };
  };

  const requestRender = () => {
    if (!opened || finished || scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (opened && !finished) host.updateDialog(draw());
    });
  };

  const finish = (value: T | undefined) => {
    if (finished) return;
    finished = true;
    try {
      component?.dispose?.();
    } catch {
      // Disposal errors do not matter once the panel is gone.
    }
    host.closeDialog(id);
    resolveResult(value);
  };

  // Enough of pi-tui's TUI for components that only ask to re-render and read the size.
  const tui: unknown = new Proxy(
    {
      requestRender,
      terminal: { columns: WIDTH, rows: ROWS, write() {} },
      get columns() {
        return WIDTH;
      },
      get rows() {
        return ROWS;
      },
      setFocus(c: Component | null) {
        if (c) c.focused = true;
      },
      showOverlay: () => ({ hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => true }),
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return () => undefined;
      },
    },
  );

  try {
    component = (await factory(tui, theme, keybindings(), (value: T) => finish(value))) as Component;
  } catch (err) {
    host.notify(err instanceof Error ? err.message : String(err), "error");
    return undefined;
  }
  if (finished) return result;
  if (component && "focused" in component) component.focused = true;

  opened = true;
  void options;
  host.openDialog(
    draw(),
    // Closing the panel in the browser cancels, like Escape on an overlay.
    () => finish(undefined),
    (action) => {
      if (!("keys" in action) || finished) return;
      try {
        component?.handleInput?.(action.keys);
      } catch (err) {
        host.notify(err instanceof Error ? err.message : String(err), "error");
      }
      requestRender();
    },
  );
  return result;
}
