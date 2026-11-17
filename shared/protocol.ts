// Wire protocol between the server and the browser. One WebSocket per browser tab;
// every thread-scoped message carries a threadId.
//
// The message and event shapes mirror pi's own (see pi docs: message-types.md, json.md).
// They are declared loosely here so the web build does not depend on pi's Node-only types.

// ---------- pi shapes (structural subset) ----------

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { total: number; [k: string]: number };
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; redacted?: boolean }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "image"; data: string; mimeType: string };

export interface PiMessage {
  role: string;
  content?: string | ContentBlock[];
  timestamp?: number;
  // assistant
  model?: string;
  provider?: string;
  usage?: Usage;
  stopReason?: string;
  errorMessage?: string;
  // toolResult
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  // bashExecution / custom / summaries
  command?: string;
  output?: string;
  exitCode?: number;
  customType?: string;
  display?: boolean;
  summary?: string;
  [k: string]: unknown;
}

/** A pi session event after the server strips cumulative snapshots from message_update. */
export interface PiEvent {
  type: string;
  [k: string]: unknown;
}

// ---------- app shapes ----------

export interface ModelRef {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
}

export interface ThreadSummary {
  id: string;
  path?: string;
  cwd: string;
  name?: string;
  title: string;
  firstMessage: string;
  created: string;
  modified: string;
  messageCount: number;
  live: boolean;
  busy: boolean;
  needsInput: boolean;
  archived: boolean;
}

export type UIRequest =
  | { id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { id: string; method: "editor"; title: string; prefill?: string };

export type UIResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export interface Notice {
  id: string;
  message: string;
  level: "info" | "warning" | "error";
  /** Number of transcript messages that existed when the notice arrived; it renders after them. */
  after: number;
  at: number;
}

export interface Widget {
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  startedAt: number;
}

export interface ThreadStats {
  tokens: number;
  cost: number;
  contextPercent: number | null;
  contextWindow: number | null;
}

export interface ThreadState {
  busy: boolean;
  model: ModelRef | null;
  thinkingLevel: string;
  thinkingLevels: string[];
  stats: ThreadStats;
  queue: { steering: string[]; followUp: string[] };
  title: string;
  /** Title set by an extension through ctx.ui.setTitle; overrides the session name in the header. */
  extTitle?: string;
}

export interface Snapshot {
  thread: ThreadSummary;
  messages: PiMessage[];
  /** Index into messages of the assistant message still streaming, or null. */
  streamingIndex: number | null;
  tools: ToolRun[];
  state: ThreadState;
  pendingUi: UIRequest[];
  notices: Notice[];
  statuses: Record<string, string>;
  widgets: Record<string, Widget>;
  editorText?: string;
}

// ---------- client -> server ----------

export type ClientMsg =
  | { type: "subscribe"; threadId: string }
  | { type: "unsubscribe"; threadId: string }
  | { type: "prompt"; threadId: string; text: string; behavior?: "steer" | "followUp" }
  | { type: "abort"; threadId: string }
  | { type: "set_model"; threadId: string; provider: string; modelId: string }
  | { type: "set_thinking"; threadId: string; level: string }
  | { type: "ui_response"; threadId: string; response: UIResponse }
  | { type: "rename"; threadId: string; name: string }
  | { type: "archive"; threadId: string; archived: boolean }
  | { type: "create_thread"; cwd?: string; reqId?: string };

// ---------- server -> client ----------

export type ServerMsg =
  | { type: "hello"; defaultCwd: string; models: ModelRef[]; version: string }
  | { type: "threads"; threads: ThreadSummary[] }
  | { type: "snapshot"; threadId: string; snapshot: Snapshot }
  | { type: "event"; threadId: string; event: PiEvent }
  | { type: "state"; threadId: string; state: ThreadState }
  | { type: "ui_request"; threadId: string; request: UIRequest }
  | { type: "ui_dismiss"; threadId: string; id: string }
  | { type: "notice"; threadId: string; notice: Notice }
  | { type: "status"; threadId: string; key: string; text?: string }
  | { type: "widget"; threadId: string; key: string; widget?: Widget }
  | { type: "editor_text"; threadId: string; text: string }
  | { type: "focus"; threadId: string; reqId?: string }
  | { type: "error"; threadId?: string; message: string };
