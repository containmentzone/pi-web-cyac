import { create } from "zustand";
import type {
  CommandInfo,
  ContentBlock,
  DefaultModel,
  ModelRef,
  Notice,
  PickItem,
  PiEvent,
  PiMessage,
  ServerMsg,
  Snapshot,
  ThreadState,
  ThreadSummary,
  UIRequest,
  Widget,
} from "../../shared/protocol";

export interface ToolRunView {
  status: "running" | "ok" | "error";
  args?: unknown;
  partial?: unknown;
  result?: unknown;
  durationMs?: number;
}

export interface ThreadView {
  messages: PiMessage[];
  streamingIndex: number | null;
  toolRuns: Record<string, ToolRunView>;
  state: ThreadState;
  pendingUi: UIRequest[];
  notices: Notice[];
  statuses: Record<string, string>;
  widgets: Record<string, Widget>;
  commands: CommandInfo[];
  /** Text an extension put into the editor; seq changes on every set so the composer can react. */
  editorText?: { text: string; seq: number };
  /** Composer lease: held by some tab, and whether that tab is this one. */
  lease: { held: boolean; mine: boolean };
}

export interface AppState {
  connected: boolean;
  everConnected: boolean;
  defaultCwd: string;
  /** Server's home directory, for showing paths as ~/… . */
  home: string;
  models: ModelRef[];
  /** Model new threads start with; set in the settings modal. */
  defaultModel: DefaultModel;
  version: string;
  /** Server allows the shell panel (PI_WEB_TERMINAL not turned off). */
  terminalEnabled: boolean;
  /** Threads whose shell panel is showing. The shell itself lives on the server either way. */
  terminalOpen: Record<string, boolean>;
  threads: ThreadSummary[];
  threadsLoaded: boolean;
  current: string | null;
  views: Record<string, ThreadView>;
  errors: { id: number; message: string; threadId?: string }[];
}

export const useStore = create<AppState>(() => ({
  connected: false,
  everConnected: false,
  defaultCwd: "",
  home: "",
  models: [],
  defaultModel: null,
  version: "",
  terminalEnabled: false,
  terminalOpen: readTerminalOpen(),
  threads: [],
  threadsLoaded: false,
  current: null,
  views: {},
  errors: [],
}));

let seq = 0;

function viewFromSnapshot(s: Snapshot): ThreadView {
  const toolRuns: Record<string, ToolRunView> = {};
  for (const run of s.tools) toolRuns[run.toolCallId] = { status: "running", args: run.args, partial: run.partialResult };
  return {
    messages: s.messages,
    streamingIndex: s.streamingIndex,
    toolRuns,
    state: s.state,
    pendingUi: s.pendingUi,
    notices: s.notices,
    statuses: s.statuses,
    widgets: s.widgets,
    commands: s.commands ?? [],
    editorText: s.editorText ? { text: s.editorText, seq: ++seq } : undefined,
    lease: { held: false, mine: false },
  };
}

function updateView(threadId: string, fn: (v: ThreadView) => ThreadView): void {
  useStore.setState((st) => {
    const view = st.views[threadId];
    if (!view) return st;
    return { views: { ...st.views, [threadId]: fn(view) } };
  });
}

// ---------- pi event reducer ----------

function contentOf(m: PiMessage): ContentBlock[] {
  return Array.isArray(m.content) ? [...m.content] : [];
}

type Block = ContentBlock & { argsText?: string };

function applyAssistantDelta(message: PiMessage, ev: Record<string, any>, usage: unknown): PiMessage {
  const content = contentOf(message) as Block[];
  const i: number = ev.contentIndex ?? 0;
  const cur = content[i] as any;
  switch (ev.type) {
    case "text_start":
      content[i] = { type: "text", text: "" };
      break;
    case "text_delta":
      content[i] = { type: "text", text: (cur?.text ?? "") + ev.delta };
      break;
    case "text_end":
      content[i] = { type: "text", text: typeof ev.content === "string" ? ev.content : (ev.content?.text ?? cur?.text ?? "") };
      break;
    case "thinking_start":
      content[i] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta":
      content[i] = { type: "thinking", thinking: (cur?.thinking ?? "") + ev.delta };
      break;
    case "thinking_end":
      content[i] = {
        type: "thinking",
        thinking: typeof ev.content === "string" ? ev.content : (ev.content?.thinking ?? cur?.thinking ?? ""),
      };
      break;
    case "toolcall_start":
      content[i] = { type: "toolCall", id: ev.id, name: ev.toolName, arguments: {}, argsText: "" };
      break;
    case "toolcall_delta":
      if (cur) content[i] = { ...cur, argsText: (cur.argsText ?? "") + ev.delta };
      break;
    case "toolcall_end":
      if (ev.toolCall) content[i] = ev.toolCall;
      break;
    default:
      return message;
  }
  return { ...message, content, usage: (usage as PiMessage["usage"]) ?? message.usage };
}

function applyEvent(v: ThreadView, e: PiEvent & Record<string, any>): ThreadView {
  switch (e.type) {
    case "message_start": {
      const messages = [...v.messages, e.message as PiMessage];
      return {
        ...v,
        messages,
        streamingIndex: e.message?.role === "assistant" ? messages.length - 1 : v.streamingIndex,
      };
    }
    case "message_update": {
      if (v.streamingIndex === null) return v;
      const messages = [...v.messages];
      const msg = messages[v.streamingIndex];
      if (!msg) return v;
      messages[v.streamingIndex] = applyAssistantDelta(msg, e.assistantMessageEvent ?? {}, e.usage);
      return { ...v, messages };
    }
    case "message_end": {
      const final = e.message as PiMessage;
      const messages = [...v.messages];
      if (final.role === "assistant" && v.streamingIndex !== null) {
        messages[v.streamingIndex] = final;
        return { ...v, messages, streamingIndex: null };
      }
      const last = messages[messages.length - 1];
      if (last && last.role === final.role && last.timestamp === final.timestamp) messages[messages.length - 1] = final;
      else messages.push(final);
      return { ...v, messages };
    }
    case "tool_execution_start":
      return { ...v, toolRuns: { ...v.toolRuns, [e.toolCallId]: { status: "running", args: e.args } } };
    case "tool_execution_update":
      return {
        ...v,
        toolRuns: { ...v.toolRuns, [e.toolCallId]: { ...v.toolRuns[e.toolCallId], status: "running", partial: e.partialResult } },
      };
    case "tool_execution_end":
      return {
        ...v,
        toolRuns: {
          ...v.toolRuns,
          [e.toolCallId]: {
            ...v.toolRuns[e.toolCallId],
            status: e.isError ? "error" : "ok",
            result: e.result,
            durationMs: e.durationMs,
          },
        },
      };
    case "agent_settled":
      return { ...v, streamingIndex: null };
    default:
      return v;
  }
}

// ---------- server messages ----------

export function handleServerMessage(msg: ServerMsg): void {
  switch (msg.type) {
    case "hello":
      useStore.setState({ defaultCwd: msg.defaultCwd, home: msg.home, models: msg.models, defaultModel: msg.defaultModel, version: msg.version, terminalEnabled: !!msg.terminal });
      return;
    case "default_model":
      useStore.setState({ defaultModel: msg.defaultModel });
      return;
    case "threads":
      useStore.setState({ threads: msg.threads, threadsLoaded: true });
      return;
    case "snapshot":
      useStore.setState((st) => ({ views: { ...st.views, [msg.threadId]: viewFromSnapshot(msg.snapshot) } }));
      return;
    case "event":
      updateView(msg.threadId, (v) => applyEvent(v, msg.event as PiEvent & Record<string, any>));
      return;
    case "state":
      updateView(msg.threadId, (v) => ({ ...v, state: msg.state }));
      return;
    case "ui_request":
      // Live panels (settings, terminal) re-send their request; replace it where it is.
      updateView(msg.threadId, (v) => ({
        ...v,
        pendingUi: v.pendingUi.some((r) => r.id === msg.request.id)
          ? v.pendingUi.map((r) => (r.id === msg.request.id ? msg.request : r))
          : [...v.pendingUi, msg.request],
      }));
      return;
    case "commands":
      updateView(msg.threadId, (v) => ({ ...v, commands: msg.commands }));
      return;
    case "completions":
      completionWaiters.get(msg.reqId)?.(msg.items);
      completionWaiters.delete(msg.reqId);
      return;
    case "ui_dismiss":
      updateView(msg.threadId, (v) => ({ ...v, pendingUi: v.pendingUi.filter((r) => r.id !== msg.id) }));
      return;
    case "notice":
      updateView(msg.threadId, (v) => ({ ...v, notices: [...v.notices, msg.notice].slice(-100) }));
      return;
    case "status":
      updateView(msg.threadId, (v) => {
        const statuses = { ...v.statuses };
        if (msg.text === undefined) delete statuses[msg.key];
        else statuses[msg.key] = msg.text;
        return { ...v, statuses };
      });
      return;
    case "widget":
      updateView(msg.threadId, (v) => {
        const widgets = { ...v.widgets };
        if (msg.widget === undefined) delete widgets[msg.key];
        else widgets[msg.key] = msg.widget;
        return { ...v, widgets };
      });
      return;
    case "editor_text":
      updateView(msg.threadId, (v) => ({ ...v, editorText: { text: msg.text, seq: ++seq } }));
      return;
    case "lease":
      updateView(msg.threadId, (v) => ({ ...v, lease: { held: msg.held, mine: msg.mine } }));
      return;
    case "focus":
      navigate(msg.threadId);
      return;
    case "error":
      pushError(msg.message, msg.threadId);
      return;
  }
}

const completionWaiters = new Map<number, (items: PickItem[]) => void>();
let completionSeq = 0;

/** Registers a waiter for argument completions; the caller sends the "complete" request. */
export function awaitCompletions(): { reqId: number; result: Promise<PickItem[]> } {
  const reqId = ++completionSeq;
  const result = new Promise<PickItem[]>((resolve) => {
    completionWaiters.set(reqId, resolve);
    setTimeout(() => {
      if (completionWaiters.delete(reqId)) resolve([]);
    }, 5000);
  });
  return { reqId, result };
}

export function pushError(message: string, threadId?: string): void {
  const id = ++seq;
  useStore.setState((st) => ({ errors: [...st.errors, { id, message, threadId }].slice(-5) }));
  setTimeout(() => useStore.setState((st) => ({ errors: st.errors.filter((e) => e.id !== id) })), 8000);
}

// ---------- routing (thread id in the URL hash) ----------

export function threadFromHash(): string | null {
  const m = /^#\/t\/([^/]+)$/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function navigate(threadId: string | null): void {
  const hash = threadId ? `#/t/${encodeURIComponent(threadId)}` : "#/";
  if (window.location.hash !== hash) window.location.hash = hash;
  else useStore.setState({ current: threadId });
}

function readTerminalOpen(): Record<string, boolean> {
  try {
    const ids = JSON.parse(localStorage.getItem("pi-web-term-open") ?? "[]") as unknown;
    return Array.isArray(ids) ? Object.fromEntries(ids.filter((i) => typeof i === "string").map((i) => [i, true])) : {};
  } catch {
    return {};
  }
}

/** Show or hide a thread's terminal panel; remembered across reloads in this browser. */
export function toggleTerminal(threadId: string, open?: boolean): void {
  useStore.setState((s) => ({ terminalOpen: { ...s.terminalOpen, [threadId]: open ?? !s.terminalOpen[threadId] } }));
  try {
    const ids = Object.entries(useStore.getState().terminalOpen).filter(([, v]) => v).map(([k]) => k);
    localStorage.setItem("pi-web-term-open", JSON.stringify(ids.slice(-50)));
  } catch {
    // Panel state resets on reload.
  }
}
