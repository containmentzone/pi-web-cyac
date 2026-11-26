import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionCommandContextActions,
} from "@earendil-works/pi-coding-agent";
import type {
  ModelRef,
  Notice,
  PiEvent,
  PiMessage,
  ServerMsg,
  Snapshot,
  ThreadState,
  ThreadSummary,
  ToolRun,
  UIAction,
  UIRequest,
  UIResponse,
  Widget,
} from "../shared/protocol.js";
import { listCommands } from "./commands.js";
import { createWebUIContext, type UIHost } from "./ui-context.js";

export interface Client {
  send(msg: ServerMsg): void;
}

/** Callbacks from a thread to the manager that owns it. */
export interface ThreadOwner {
  threadsChanged(): void;
  /** Runs web-handled slash commands (/model, /login, /settings, ...). True when it handled the text. */
  runBuiltin(thread: LiveThread, text: string): Promise<boolean>;
  summaryFor(thread: LiveThread): ThreadSummary;
  commandActions(thread: LiveThread): ExtensionCommandContextActions;
}

const MAX_NOTICES = 100;
/** A composer lease lapses this long after its holder last typed. */
const LEASE_MS = 30_000;

export function toModelRef(model: AgentSession["model"]): ModelRef | null {
  if (!model) return null;
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
  };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

/** First line of a user message, trimmed, for auto-naming. */
function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function userText(message: PiMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  return "";
}

/**
 * One open pi session plus everything the browser needs to rebuild its view: the in-flight
 * streaming message, running tools, pending ctx.ui dialogs, statuses and widgets.
 */
export class LiveThread implements UIHost {
  readonly subscribers = new Set<Client>();
  busy = false;
  lastActivity = Date.now();

  private partial: PiMessage | null = null;
  private readonly tools = new Map<string, ToolRun>();
  private readonly dialogs = new Map<
    string,
    { request: UIRequest; finish: (r?: UIResponse) => void; onAction?: (action: UIAction) => void }
  >();
  private notices: Notice[] = [];
  private readonly statuses = new Map<string, string>();
  private readonly widgets = new Map<string, Widget>();
  private extTitle: string | undefined;
  private editorText = "";
  /** The tab typing in the composer. Others see it locked until it sends, clears or goes quiet. */
  private lease: { client: Client; timer: NodeJS.Timeout } | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    readonly session: AgentSession,
    private readonly owner: ThreadOwner,
  ) {}

  get id(): string {
    return this.session.sessionId;
  }

  get needsInput(): boolean {
    return this.dialogs.size > 0;
  }

  async start(): Promise<void> {
    this.unsubscribe = this.session.subscribe((event) => this.onEvent(event));
    await this.session.bindExtensions({
      uiContext: createWebUIContext(this),
      // pi has no "web" mode. RPC is the closest: extensions already guard TUI-only features.
      mode: "rpc",
      commandContextActions: this.owner.commandActions(this),
      onError: (err) => {
        this.notify(`Extension error in ${err.extensionPath} (${err.event}): ${err.error}`, "error");
      },
    });
  }

  dispose(): void {
    if (this.lease) clearTimeout(this.lease.timer);
    for (const { finish } of [...this.dialogs.values()]) finish();
    this.unsubscribe?.();
    this.session.dispose();
  }

  // ---------- browser-facing ----------

  attach(client: Client): void {
    this.subscribers.add(client);
    this.lastActivity = Date.now();
    client.send({ type: "snapshot", threadId: this.id, snapshot: this.snapshot() });
    this.sendLease(client);
  }

  detach(client: Client): void {
    this.release(client);
    this.subscribers.delete(client);
    this.lastActivity = Date.now();
  }

  snapshot(): Snapshot {
    const messages = plain(this.session.messages) as PiMessage[];
    let streamingIndex: number | null = null;
    if (this.partial) {
      const last = messages[messages.length - 1];
      const duplicate = last && last.role === this.partial.role && last.timestamp === this.partial.timestamp;
      if (!duplicate) messages.push(plain(this.partial));
      streamingIndex = messages.length - 1;
    }
    return {
      thread: this.owner.summaryFor(this),
      messages,
      streamingIndex,
      tools: plain([...this.tools.values()]),
      state: this.state(),
      pendingUi: [...this.dialogs.values()].map((d) => d.request),
      notices: this.notices,
      statuses: Object.fromEntries(this.statuses),
      widgets: Object.fromEntries(this.widgets),
      editorText: this.editorText || undefined,
      commands: listCommands(this.session),
    };
  }

  state(): ThreadState {
    const s = this.session;
    let stats: ThreadState["stats"] = { tokens: 0, cost: 0, contextPercent: null, contextWindow: null };
    try {
      const st = s.getSessionStats();
      stats = {
        tokens: st.tokens.total,
        cost: st.cost,
        contextPercent: st.contextUsage?.percent ?? null,
        contextWindow: st.contextUsage?.contextWindow ?? s.model?.contextWindow ?? null,
      };
    } catch {
      // Stats are best effort; a fresh session may not have them yet.
    }
    let thinkingLevels: string[] = [];
    try {
      thinkingLevels = s.supportsThinking() ? [...s.getAvailableThinkingLevels()] : [];
    } catch {
      thinkingLevels = [];
    }
    return {
      busy: this.busy,
      model: toModelRef(s.model),
      thinkingLevel: s.thinkingLevel,
      thinkingLevels,
      stats,
      queue: { steering: [...s.getSteeringMessages()], followUp: [...s.getFollowUpMessages()] },
      title: this.owner.summaryFor(this).title,
      extTitle: this.extTitle,
    };
  }

  /** Take or renew the composer lease. False when another tab holds it. */
  claim(client: Client): boolean {
    if (this.lease && this.lease.client !== client) return false;
    const fresh = !this.lease;
    if (this.lease) clearTimeout(this.lease.timer);
    this.lease = { client, timer: setTimeout(() => this.release(client), LEASE_MS) };
    if (fresh) this.pushLease();
    return true;
  }

  release(client: Client): void {
    if (this.lease?.client !== client) return;
    clearTimeout(this.lease.timer);
    this.lease = undefined;
    this.pushLease();
  }

  async prompt(client: Client, text: string, behavior?: "steer" | "followUp"): Promise<void> {
    if (this.lease && this.lease.client !== client) throw new Error("Someone else is typing in this thread.");
    this.release(client);
    this.lastActivity = Date.now();
    this.editorText = "";
    try {
      if (await this.owner.runBuiltin(this, text)) return;
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err), "error");
      return;
    }
    if (this.session.isStreaming) {
      await this.session.prompt(text, { streamingBehavior: behavior ?? "steer", source: "rpc" });
      return;
    }
    this.setBusy(true);
    try {
      await this.session.prompt(text, { source: "rpc" });
    } catch (err) {
      this.notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      // Extension commands (/name etc.) can finish without an agent run, so settle here too.
      if (!this.session.isStreaming) this.setBusy(false);
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  answer(response: UIResponse): void {
    this.dialogs.get(response.id)?.finish(response);
  }

  act(id: string, action: UIAction): void {
    this.dialogs.get(id)?.onAction?.(action);
  }

  pushCommands(): void {
    this.broadcast({ type: "commands", threadId: this.id, commands: listCommands(this.session) });
  }

  pushState(): void {
    this.broadcast({ type: "state", threadId: this.id, state: this.state() });
  }

  // ---------- UIHost (ctx.ui) ----------

  openDialog(request: UIRequest, finish: (response?: UIResponse) => void, onAction?: (action: UIAction) => void): void {
    this.dialogs.set(request.id, { request, finish, onAction });
    this.broadcast({ type: "ui_request", threadId: this.id, request });
    this.owner.threadsChanged();
  }

  /** Replace an open dialog's content (live panels: settings, terminal). */
  updateDialog(request: UIRequest): void {
    const entry = this.dialogs.get(request.id);
    if (!entry) return;
    entry.request = request;
    this.broadcast({ type: "ui_request", threadId: this.id, request });
  }

  /**
   * Ask through a dialog card and wait for the answer. Used by the built-in commands; resolves
   * undefined when cancelled.
   */
  ask(request: UIRequest, onAction?: (action: UIAction) => void): Promise<UIResponse | undefined> {
    return new Promise((resolve) => {
      let done = false;
      this.openDialog(
        request,
        (response) => {
          if (done) return;
          done = true;
          this.closeDialog(request.id);
          resolve(response);
        },
        onAction,
      );
    });
  }

  closeDialog(id: string): void {
    if (!this.dialogs.delete(id)) return;
    this.broadcast({ type: "ui_dismiss", threadId: this.id, id });
    this.owner.threadsChanged();
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    const notice: Notice = {
      id: randomUUID(),
      message,
      level,
      after: this.session.messages.length + (this.partial ? 1 : 0),
      at: Date.now(),
    };
    this.notices = [...this.notices, notice].slice(-MAX_NOTICES);
    this.broadcast({ type: "notice", threadId: this.id, notice });
  }

  setStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.statuses.delete(key);
    else this.statuses.set(key, text);
    this.broadcast({ type: "status", threadId: this.id, key, text });
  }

  setWidget(key: string, widget: Widget | undefined): void {
    if (widget === undefined) this.widgets.delete(key);
    else this.widgets.set(key, widget);
    this.broadcast({ type: "widget", threadId: this.id, key, widget });
  }

  setExtTitle(title: string): void {
    this.extTitle = title || undefined;
    this.pushState();
  }

  setEditorText(text: string): void {
    this.editorText = text;
    this.broadcast({ type: "editor_text", threadId: this.id, text });
  }

  getEditorText(): string {
    return this.editorText;
  }

  // ---------- pi events ----------

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.pushState();
    this.owner.threadsChanged();
  }

  private onEvent(event: AgentSessionEvent): void {
    this.lastActivity = Date.now();
    const e = event as unknown as PiEvent & Record<string, any>;
    switch (e.type) {
      case "agent_start":
        this.setBusy(true);
        break;
      case "agent_settled":
        this.partial = null;
        this.tools.clear();
        this.autoName();
        this.setBusy(false);
        this.pushState();
        this.owner.threadsChanged();
        break;
      case "message_start":
        if (e.message?.role === "assistant") this.partial = e.message;
        break;
      case "message_update":
        this.partial = e.message;
        break;
      case "message_end":
        this.partial = null;
        if (e.message?.role === "assistant") queueMicrotask(() => this.pushState());
        break;
      case "tool_execution_start":
        this.tools.set(e.toolCallId, {
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          args: e.args,
          startedAt: Date.now(),
        });
        break;
      case "tool_execution_update": {
        const run = this.tools.get(e.toolCallId);
        if (run) run.partialResult = e.partialResult;
        break;
      }
      case "tool_execution_end":
        this.tools.delete(e.toolCallId);
        break;
      case "session_start":
        this.pushCommands();
        break;
      case "session_info_changed":
        this.pushState();
        this.owner.threadsChanged();
        break;
      case "thinking_level_changed":
      case "queue_update":
      case "compaction_end":
        this.pushState();
        break;
    }
    this.broadcast({ type: "event", threadId: this.id, event: toWireEvent(e) });
  }

  /** Name an unnamed thread after its first user message, as the doc proposes. */
  private autoName(): void {
    if (this.session.sessionName) return;
    const first = (this.session.messages as unknown as PiMessage[]).find((m) => m.role === "user");
    const title = first ? titleFrom(userText(first)) : "";
    if (title) {
      try {
        this.session.setSessionName(title);
      } catch {
        // Naming is cosmetic.
      }
    }
  }

  private sendLease(client: Client): void {
    client.send({ type: "lease", threadId: this.id, held: !!this.lease, mine: this.lease?.client === client });
  }

  private pushLease(): void {
    for (const client of this.subscribers) this.sendLease(client);
  }

  private broadcast(msg: ServerMsg): void {
    for (const client of this.subscribers) client.send(msg);
  }
}

/**
 * pi's message_update carries the whole partial message on every delta. Like pi's JSON/RPC
 * modes, the wire keeps only the delta so the stream stays linear in size.
 */
function toWireEvent(e: PiEvent & Record<string, any>): PiEvent {
  switch (e.type) {
    case "message_update": {
      const ame = e.assistantMessageEvent ?? {};
      const { partial, ...delta } = ame;
      if (ame.type === "toolcall_start") {
        const block = partial?.content?.[ame.contentIndex];
        return {
          type: e.type,
          usage: e.message?.usage,
          assistantMessageEvent: { ...delta, id: block?.id, toolName: block?.name },
        };
      }
      return { type: e.type, usage: e.message?.usage, assistantMessageEvent: delta };
    }
    case "agent_end":
      return { type: e.type, willRetry: e.willRetry };
    case "turn_end":
      return { type: e.type };
    default:
      return e;
  }
}
