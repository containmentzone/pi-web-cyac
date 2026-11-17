import { existsSync, statSync } from "node:fs";
import {
  type AgentSession,
  createAgentSession,
  type ExtensionCommandContextActions,
  ModelRuntime,
  SessionManager,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { ModelRef, ServerMsg, ThreadSummary } from "../shared/protocol.js";
import { config } from "./config.js";
import { type Client, LiveThread, type ThreadOwner, toModelRef } from "./live-thread.js";
import { Sidecar } from "./sidecar.js";

const LIST_TTL_MS = 5_000;

function shorten(text: string, max = 60): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/**
 * Owns every live pi session (one per thread) and the thread list. The list comes from pi's own
 * session files (SessionManager.listAll) plus live threads that have not been written yet.
 */
export class ThreadManager implements ThreadOwner {
  readonly clients = new Set<Client>();
  private readonly live = new Map<string, LiveThread>();
  private readonly opening = new Map<string, Promise<LiveThread>>();
  private readonly sidecar = new Sidecar(config.stateFile);
  private infos: SessionInfo[] = [];
  private infosAt = 0;
  private infosLoading: Promise<SessionInfo[]> | undefined;
  private broadcastTimer: NodeJS.Timeout | undefined;
  private sweepTimer: NodeJS.Timeout | undefined;

  private constructor(readonly models: ModelRuntime) {}

  static async create(): Promise<ThreadManager> {
    const models = await ModelRuntime.create();
    const manager = new ThreadManager(models);
    manager.sweepTimer = setInterval(() => manager.sweep(), 60_000);
    manager.sweepTimer.unref();
    return manager;
  }

  async availableModels(): Promise<ModelRef[]> {
    try {
      const models = await this.models.getAvailable();
      return models.map((m) => toModelRef(m)).filter((m): m is ModelRef => m !== null);
    } catch (err) {
      console.error("[pi-web] could not list models:", err);
      return [];
    }
  }

  // ---------- thread list ----------

  private async loadInfos(force = false): Promise<SessionInfo[]> {
    if (!force && Date.now() - this.infosAt < LIST_TTL_MS) return this.infos;
    this.infosLoading ??= (config.sessionDir ? SessionManager.listAll(config.sessionDir) : SessionManager.listAll())
      .then((infos) => {
        this.infos = infos;
        this.infosAt = Date.now();
        return infos;
      })
      .finally(() => {
        this.infosLoading = undefined;
      });
    return this.infosLoading;
  }

  async list(force = false): Promise<ThreadSummary[]> {
    const infos = await this.loadInfos(force);
    const byId = new Map<string, ThreadSummary>();
    for (const info of infos) byId.set(info.id, this.fromInfo(info));
    for (const thread of this.live.values()) byId.set(thread.id, this.summaryFor(thread));
    return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
  }

  private fromInfo(info: SessionInfo): ThreadSummary {
    const live = this.live.get(info.id);
    return {
      id: info.id,
      path: info.path,
      cwd: info.cwd,
      name: info.name,
      title: info.name || shorten(info.firstMessage) || "New thread",
      firstMessage: shorten(info.firstMessage, 140),
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      live: !!live,
      busy: live?.busy ?? false,
      needsInput: live?.needsInput ?? false,
      archived: !!this.sidecar.get(info.id).archived,
    };
  }

  summaryFor(thread: LiveThread): ThreadSummary {
    const s = thread.session;
    const info = this.infos.find((i) => i.id === thread.id);
    const messages = s.messages as unknown as Array<{ role: string; content?: unknown }>;
    const firstUser = messages.find((m) => m.role === "user");
    const firstText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content.map((b: any) => (b?.type === "text" ? b.text : "")).join("")
          : (info?.firstMessage ?? "");
    const now = new Date().toISOString();
    return {
      id: thread.id,
      path: s.sessionFile,
      cwd: s.sessionManager.getCwd(),
      name: s.sessionName,
      title: s.sessionName || shorten(firstText) || "New thread",
      firstMessage: shorten(firstText, 140),
      created: info?.created.toISOString() ?? now,
      modified: thread.busy ? now : new Date(Math.max(info?.modified.getTime() ?? 0, thread.lastActivity)).toISOString(),
      messageCount: messages.length,
      live: true,
      busy: thread.busy,
      needsInput: thread.needsInput,
      archived: !!this.sidecar.get(thread.id).archived,
    };
  }

  /** Coalesces list pushes so a burst of state changes sends one update. */
  threadsChanged(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(async () => {
      this.broadcastTimer = undefined;
      const threads = await this.list(true).catch(() => undefined);
      if (threads) this.broadcastAll({ type: "threads", threads });
    }, 150);
  }

  broadcastAll(msg: ServerMsg): void {
    for (const client of this.clients) client.send(msg);
  }

  setArchived(id: string, archived: boolean): void {
    this.sidecar.set(id, { archived });
    this.threadsChanged();
  }

  // ---------- opening and creating ----------

  async get(id: string): Promise<LiveThread> {
    const live = this.live.get(id);
    if (live) return live;
    const pending = this.opening.get(id);
    if (pending) return pending;
    const promise = (async () => {
      let info = (await this.loadInfos()).find((i) => i.id === id);
      info ??= (await this.loadInfos(true)).find((i) => i.id === id);
      if (!info) throw new Error(`Unknown thread ${id}`);
      return this.openPath(info.path);
    })().finally(() => this.opening.delete(id));
    this.opening.set(id, promise);
    return promise;
  }

  async create(cwd: string = config.defaultCwd): Promise<LiveThread> {
    assertDir(cwd);
    return this.adopt(SessionManager.create(cwd, config.sessionDir));
  }

  async openPath(path: string): Promise<LiveThread> {
    const existing = [...this.live.values()].find((t) => t.session.sessionFile === path);
    if (existing) return existing;
    const sm = SessionManager.open(path, config.sessionDir);
    assertDir(sm.getCwd());
    return this.adopt(sm);
  }

  private async adopt(sessionManager: SessionManager, setup?: (session: AgentSession) => Promise<void>): Promise<LiveThread> {
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: sessionManager.getCwd(),
      sessionManager,
      modelRuntime: this.models,
    });
    const thread = new LiveThread(session, this);
    this.live.set(thread.id, thread);
    await thread.start();
    if (setup) await setup(session);
    if (modelFallbackMessage) thread.notify(modelFallbackMessage, "warning");
    this.threadsChanged();
    return thread;
  }

  /** Focus a thread in every browser (used when an extension command opens a new session). */
  private focus(thread: LiveThread): void {
    this.broadcastAll({ type: "focus", threadId: thread.id });
  }

  /**
   * ctx actions for extension commands. pi's runtime replaces "the" active session; a multi-thread
   * server opens the new session as another thread instead and focuses it in the browser.
   */
  commandActions(thread: LiveThread): ExtensionCommandContextActions {
    const session = () => thread.session;
    return {
      waitForIdle: () => session().waitForIdle(),
      newSession: async (options) => {
        const sm = SessionManager.create(session().sessionManager.getCwd(), config.sessionDir);
        if (options?.parentSession) sm.newSession({ parentSession: options.parentSession });
        const next = await this.adopt(sm, async (s) => {
          if (options?.setup) {
            await options.setup(s.sessionManager);
            s.refreshContext();
          }
        });
        if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
        this.focus(next);
        return { cancelled: false };
      },
      fork: async (entryId, options) => {
        const position = options?.position ?? "before";
        const current = session();
        const entry = current.sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");
        let targetLeafId: string | null;
        let selectedText: string | undefined;
        if (position === "at") {
          targetLeafId = entry.id;
        } else {
          const message = entry.type === "message" ? (entry.message as any) : undefined;
          if (message?.role !== "user") throw new Error("Invalid entry ID for forking");
          targetLeafId = entry.parentId;
          selectedText =
            typeof message.content === "string"
              ? message.content
              : (message.content ?? []).map((b: any) => (b?.type === "text" ? b.text : "")).join("");
        }
        const file = current.sessionFile;
        let sm: SessionManager;
        if (!targetLeafId || !file || !existsSync(file)) {
          sm = SessionManager.create(current.sessionManager.getCwd(), config.sessionDir);
          if (file) sm.newSession({ parentSession: file });
        } else {
          sm = SessionManager.open(file, config.sessionDir);
          if (!sm.createBranchedSession(targetLeafId)) throw new Error("Failed to create forked session");
        }
        const next = await this.adopt(sm);
        if (selectedText) next.setEditorText(selectedText);
        if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
        this.focus(next);
        return { cancelled: false };
      },
      navigateTree: async (targetId, options) => {
        const result = await session().navigateTree(targetId, options);
        return { cancelled: result.cancelled };
      },
      switchSession: async (sessionPath, options) => {
        const next = await this.openPath(sessionPath);
        if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
        this.focus(next);
        return { cancelled: false };
      },
      reload: async () => {
        await session().reload();
      },
    };
  }

  // ---------- lifecycle ----------

  /** Dispose idle threads nobody is watching; they reopen from disk on the next subscribe. */
  private sweep(): void {
    const cutoff = Date.now() - config.idleMinutes * 60_000;
    for (const [id, thread] of this.live) {
      if (thread.subscribers.size > 0 || thread.busy || thread.needsInput) continue;
      if (thread.lastActivity > cutoff) continue;
      // Never drop a thread that has not been written yet: it would vanish from the list.
      if (!thread.session.sessionFile || !existsSync(thread.session.sessionFile)) continue;
      this.live.delete(id);
      thread.dispose();
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const thread of this.live.values()) {
      try {
        thread.dispose();
      } catch {
        // Best effort on shutdown.
      }
    }
    this.live.clear();
  }
}

function assertDir(path: string): void {
  let ok = false;
  try {
    ok = statSync(path).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`Working directory does not exist: ${path}`);
}
