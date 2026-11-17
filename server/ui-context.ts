import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { UIAction, UIRequest, UIResponse, Widget } from "../shared/protocol.js";
import { runCustom } from "./tui-bridge.js";

/** What the UI context needs from its thread. Implemented by LiveThread. */
export interface UIHost {
  openDialog(request: UIRequest, finish: (response?: UIResponse) => void, onAction?: (action: UIAction) => void): void;
  updateDialog(request: UIRequest): void;
  closeDialog(id: string): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, widget: Widget | undefined): void;
  setExtTitle(title: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/**
 * Terminal themes have no meaning in a browser. Extensions that style text through ctx.ui.theme
 * (theme.fg(color, text), theme.bold(text), ...) get their text back unstyled.
 */
const plainTheme = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === "name") return "web";
      return (...args: unknown[]) => {
        const last = args[args.length - 1];
        return typeof last === "string" ? last : "";
      };
    },
  },
);

/**
 * An ExtensionUIContext that forwards ctx.ui to the browser, modelled on pi's RPC mode
 * (modes/rpc/rpc-mode.ts, createExtensionUIContext). Dialogs are kept server-side by the host until
 * answered, timed out or aborted, so they survive reloads and show in every open tab.
 */
export function createWebUIContext(host: UIHost): ExtensionUIContext {
  function dialog<T>(
    opts: ExtensionUIDialogOptions | undefined,
    fallback: T,
    request: DistributiveOmit<UIRequest, "id">,
    parse: (response: UIResponse) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(fallback);
    const id = randomUUID();
    return new Promise<T>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let done = false;
      const finish = (response?: UIResponse) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onAbort);
        host.closeDialog(id);
        resolve(response ? parse(response) : fallback);
      };
      const onAbort = () => finish();
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) timer = setTimeout(() => finish(), opts.timeout);
      host.openDialog({ id, ...request } as UIRequest, finish);
    });
  }

  const valueOf = (r: UIResponse) => ("cancelled" in r ? undefined : "value" in r ? r.value : undefined);

  const ui = {
    select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
      dialog(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, valueOf),
    confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
      dialog(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
        "confirmed" in r ? r.confirmed : false,
      ),
    input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
      dialog(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, valueOf),
    editor: (title: string, prefill?: string) =>
      dialog(undefined, undefined, { method: "editor", title, prefill }, valueOf),

    notify(message: string, type?: "info" | "warning" | "error") {
      host.notify(message, type ?? "info");
    },
    setStatus(key: string, text: string | undefined) {
      host.setStatus(key, text);
    },
    setWidget(key: string, content: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }) {
      // Like RPC mode, only string arrays are supported; TUI component factories are ignored.
      if (content === undefined) host.setWidget(key, undefined);
      else if (Array.isArray(content)) {
        host.setWidget(key, { lines: content.map(String), placement: options?.placement ?? "aboveEditor" });
      }
    },
    setTitle(title: string) {
      host.setExtTitle(title);
    },
    setEditorText(text: string) {
      host.setEditorText(text);
    },
    pasteToEditor(text: string) {
      host.setEditorText(host.getEditorText() + text);
    },
    getEditorText() {
      return host.getEditorText();
    },

    // Terminal-only features: same behaviour as pi's RPC mode.
    onTerminalInput: () => () => {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setFooter() {},
    setHeader() {},
    // Runs the extension's TUI component on the server and mirrors it into a terminal panel.
    custom: (factory: any, options?: any) => runCustom(host, factory, options),
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent: () => undefined,
    get theme() {
      return plainTheme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching is not supported in the web UI" }),
    getToolsExpanded: () => false,
    setToolsExpanded() {},
  };

  return ui as unknown as ExtensionUIContext;
}
