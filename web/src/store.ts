import { create } from "zustand";
import type {
  ContentBlock,
  ModelRef,
  Notice,
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
  /** Text an extension put into the editor; seq changes on every set so the composer can react. */
  editorText?: { text: string; seq: number };
}

export interface AppState {
  connected: boolean;
  everConnected: boolean;
  defaultCwd: string;
  models: ModelRef[];
  version: string;
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
  models: [],
  version: "",
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
    editorText: s.editorText ? { text: s.editorText, seq: ++seq } : undefined,
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
      useStore.setState({ defaultCwd: msg.defaultCwd, models: msg.models, version: msg.version });
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
      updateView(msg.threadId, (v) => ({
        ...v,
        pendingUi: [...v.pendingUi.filter((r) => r.id !== msg.request.id), msg.request],
      }));
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
    case "focus":
      navigate(msg.threadId);
      return;
    case "error":
      pushError(msg.message, msg.threadId);
      return;
  }
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
