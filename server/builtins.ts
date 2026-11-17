import { randomUUID } from "node:crypto";
import type { AgentSession, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { PickItem, SettingItem, UIRequest, UIResponse } from "../shared/protocol.js";
import { modelItems, WEB_BUILTINS } from "./commands.js";
import type { LiveThread } from "./live-thread.js";

/**
 * pi's interactive-only slash commands, rebuilt on the web UI's dialog cards. Each follows what the
 * TUI does in modes/interactive/interactive-mode.ts, minus terminal-only settings.
 */

const NAMES = new Set(WEB_BUILTINS.map((c) => c.name));
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

type BuiltinOwner = {
  newThread(from: LiveThread): Promise<void>;
};

function valueOf(r: UIResponse | undefined): string | undefined {
  return r && "value" in r ? r.value : undefined;
}

async function pick(
  thread: LiveThread,
  title: string,
  items: PickItem[],
  extra: { message?: string; search?: boolean; selected?: string } = {},
): Promise<string | undefined> {
  const request: UIRequest = { id: randomUUID(), method: "select", title, options: [], items, ...extra };
  return valueOf(await thread.ask(request));
}

async function input(
  thread: LiveThread,
  title: string,
  extra: { placeholder?: string; message?: string; secret?: boolean } = {},
): Promise<string | undefined> {
  return valueOf(await thread.ask({ id: randomUUID(), method: "input", title, ...extra }));
}

/** Like thread.ask, but a prompt signal from the login flow closes the card. */
async function askWithSignal(thread: LiveThread, request: UIRequest, signal?: AbortSignal): Promise<UIResponse | undefined> {
  if (signal?.aborted) return undefined;
  const onAbort = () => thread.answer({ id: request.id, cancelled: true });
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await thread.ask(request);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function runBuiltin(owner: BuiltinOwner, thread: LiveThread, text: string): Promise<boolean> {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return false;
  const name = m[1]!;
  const arg = (m[2] ?? "").trim();
  const session = thread.session;

  if (name === "mcp" && !arg && session.extensionRunner.getCommand("mcp")) {
    await runMcpManager(thread);
    return true;
  }
  if (!NAMES.has(name)) return false;

  switch (name) {
    case "model":
      await model(thread, arg);
      break;
    case "thinking":
      await thinking(thread, arg);
      break;
    case "login":
      await login(thread, arg);
      break;
    case "logout":
      await logout(thread);
      break;
    case "settings":
      await settings(thread);
      break;
    case "new":
      await owner.newThread(thread);
      break;
    case "name": {
      const value = arg || (await input(thread, "Session name", { placeholder: session.sessionName ?? "" }));
      if (value?.trim()) {
        session.setSessionName(value.trim());
        thread.pushState();
      }
      break;
    }
    case "session":
      thread.notify(sessionInfo(session), "info");
      break;
    case "compact":
      if (session.isStreaming) {
        thread.notify("Wait for the current response to finish before compacting.", "warning");
        break;
      }
      await session.compact(arg || undefined);
      thread.pushState();
      thread.notify("Context compacted.", "info");
      break;
    case "reload":
      if (session.isStreaming) {
        thread.notify("Wait for the current response to finish before reloading.", "warning");
        break;
      }
      await session.reload();
      thread.pushCommands();
      thread.pushState();
      thread.notify("Reloaded extensions, skills, prompts, themes, and context files.", "info");
      break;
  }
  return true;
}

// ---------- /model, /thinking ----------

async function model(thread: LiveThread, arg: string): Promise<void> {
  const session = thread.session;
  const items = modelItems(session);
  if (items.length === 0) {
    thread.notify("No models available. Use /login to sign in to a provider.", "warning");
    return;
  }
  let value: string | undefined;
  if (arg) {
    const q = arg.toLowerCase();
    const exact = items.filter((i) => i.value.toLowerCase() === q || i.value.split("/").slice(1).join("/").toLowerCase() === q);
    const matches = exact.length ? exact : items.filter((i) => i.value.toLowerCase().includes(q));
    if (matches.length === 1) value = matches[0]!.value;
    else if (matches.length === 0) {
      thread.notify(`No model matches "${arg}".`, "warning");
      return;
    } else {
      value = await pick(thread, "Select model", matches, { search: true });
    }
  } else {
    const current = session.model ? `${session.model.provider}/${session.model.id}` : undefined;
    value = await pick(thread, "Select model", items, { search: true, selected: current });
  }
  if (!value) return;
  const slash = value.indexOf("/");
  const target = session.modelRuntime.getModel(value.slice(0, slash), value.slice(slash + 1));
  if (!target) {
    thread.notify(`Unknown model ${value}`, "error");
    return;
  }
  await session.setModel(target);
  thread.pushState();
}

async function thinking(thread: LiveThread, arg: string): Promise<void> {
  const session = thread.session;
  if (!session.supportsThinking()) {
    thread.notify("The current model does not support thinking levels.", "warning");
    return;
  }
  const levels = session.getAvailableThinkingLevels();
  const level =
    arg ||
    (await pick(
      thread,
      "Thinking level",
      levels.map((l) => ({ value: l, label: l })),
      { selected: session.thinkingLevel },
    ));
  if (!level) return;
  if (!levels.includes(level as never)) {
    thread.notify(`Unknown thinking level "${level}". Available: ${levels.join(", ")}`, "warning");
    return;
  }
  session.setThinkingLevel(level as never);
  thread.pushState();
}

// ---------- /login, /logout ----------

interface ProviderOption {
  id: string;
  name: string;
  authType: "oauth" | "api_key";
  ambient: boolean;
  status?: string;
}

function loginOptions(session: AgentSession): ProviderOption[] {
  const runtime = session.modelRuntime;
  const out: ProviderOption[] = [];
  for (const provider of runtime.getProviders()) {
    const auth = runtime.getProviderAuthStatus(provider.id);
    const status = auth.configured
      ? `${runtime.isUsingOAuth(provider.id) ? "account" : "API key"}${auth.label || auth.source ? `: ${auth.label ?? auth.source}` : ""}`
      : undefined;
    const methods = (provider as { auth?: { oauth?: unknown; apiKey?: { login?: unknown } } }).auth ?? {};
    if (methods.oauth) out.push({ id: provider.id, name: provider.name ?? provider.id, authType: "oauth", ambient: false, status });
    if (methods.apiKey) {
      out.push({ id: provider.id, name: provider.name ?? provider.id, authType: "api_key", ambient: !methods.apiKey.login, status });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function login(thread: LiveThread, arg: string): Promise<void> {
  const session = thread.session;
  let options = loginOptions(session);
  if (arg) {
    const q = arg.toLowerCase();
    const exact = options.filter((o) => o.id.toLowerCase() === q || o.name.toLowerCase() === q);
    options = exact.length ? exact : options.filter((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
    if (options.length === 0) {
      thread.notify(`No login provider matches "${arg}".`, "warning");
      return;
    }
  }
  const types = new Set(options.map((o) => o.authType));
  let authType: "oauth" | "api_key" | undefined = types.size === 1 ? [...types][0] : undefined;
  if (!authType) {
    const chosen = await pick(
      thread,
      "Select authentication method",
      [
        { value: "oauth", label: "Sign in with an account" },
        { value: "api_key", label: "Sign in with an API key" },
      ].filter((i) => types.has(i.value as "oauth" | "api_key")),
    );
    if (!chosen) return;
    authType = chosen as "oauth" | "api_key";
  }
  const candidates = options.filter((o) => o.authType === authType);
  let option = candidates.length === 1 ? candidates[0] : undefined;
  if (!option) {
    const id = await pick(
      thread,
      authType === "oauth" ? "Sign in with an account" : "Sign in with an API key",
      candidates.map((o) => ({ value: o.id, label: o.name, description: o.status ? `✓ ${o.status}` : o.id })),
      { search: true },
    );
    option = candidates.find((o) => o.id === id);
    if (!option) return;
  }
  if (option.ambient) {
    thread.notify(`${option.name} is configured outside pi (environment variables or config files).`, "info");
    return;
  }

  const previousModel = session.model;
  const controller = new AbortController();
  const label = option.authType === "oauth" ? `Logged in to ${option.name}` : `Saved API key for ${option.name}`;
  try {
    await session.modelRuntime.login(
      option.id,
      option.authType,
      {
        signal: controller.signal,
        prompt: async (p) => {
          let response: UIResponse | undefined;
          if (p.type === "select") {
            response = await askWithSignal(
              thread,
              {
                id: randomUUID(),
                method: "select",
                title: p.message,
                options: [],
                items: p.options.map((o) => ({ value: o.id, label: o.label, description: o.description })),
              },
              p.signal,
            );
          } else {
            response = await askWithSignal(
              thread,
              {
                id: randomUUID(),
                method: "input",
                title: `${option.name}`,
                message: p.message,
                placeholder: p.placeholder,
                secret: p.type === "secret",
              },
              p.signal,
            );
          }
          const value = valueOf(response);
          if (value === undefined) {
            controller.abort();
            throw new Error("Login cancelled");
          }
          return value;
        },
        notify: (event) => {
          switch (event.type) {
            case "auth_url":
              thread.notify(
                `**${option.name}:** [open the sign-in page](${event.url})${event.instructions ? `\n\n${event.instructions}` : ""}`,
                "info",
              );
              break;
            case "device_code":
              thread.notify(
                `**${option.name}:** open [${event.verificationUri}](${event.verificationUri}) and enter the code \`${event.userCode}\``,
                "info",
              );
              break;
            case "info": {
              const links = (event.links ?? []).map((l) => `[${l.label ?? l.url}](${l.url})`).join(" · ");
              thread.notify(links ? `${event.message}\n\n${links}` : event.message, "info");
              break;
            }
            case "progress":
              thread.notify(event.message, "info");
              break;
          }
        },
      },
      { getDeviceId: () => session.settingsManager.getOrCreateDeviceId() } as never,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Login cancelled" || controller.signal.aborted) {
      thread.notify("Login cancelled.", "info");
    } else {
      thread.notify(`Login to ${option.name} failed: ${message}`, "error");
    }
    return;
  }

  thread.notify(`${label}.`, "info");
  // Like pi: pick a model from the new provider when the session has none yet.
  if (!previousModel) {
    try {
      await session.modelRuntime.refresh({ providers: [option.id], signal: AbortSignal.timeout(15_000) } as never);
    } catch {
      // Cached catalog is fine.
    }
    const first = session.modelRuntime.getAvailableSnapshot().find((m) => m.provider === option.id);
    if (first) {
      await session.setModel(first);
      thread.notify(`Selected ${first.id}. Use /model to pick another.`, "info");
    } else {
      thread.notify("No models are available for that provider yet. Use /model to select one.", "warning");
    }
  } else {
    void session.modelRuntime.refresh({ providers: [option.id], signal: AbortSignal.timeout(15_000) } as never).catch(() => {});
  }
  thread.pushState();
}

async function logout(thread: LiveThread): Promise<void> {
  const runtime = thread.session.modelRuntime;
  const creds = await runtime.listCredentials({ signal: AbortSignal.timeout(15_000) });
  if (creds.length === 0) {
    thread.notify(
      "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
      "info",
    );
    return;
  }
  const id = await pick(
    thread,
    "Log out of",
    creds.map((c) => ({
      value: c.providerId,
      label: runtime.getProvider(c.providerId)?.name ?? c.providerId,
      description: c.type === "oauth" ? "account" : "API key",
    })),
  );
  if (!id) return;
  const cred = creds.find((c) => c.providerId === id);
  const name = runtime.getProvider(id)?.name ?? id;
  await runtime.logout(id, { signal: AbortSignal.timeout(15_000) });
  thread.notify(
    cred?.type === "oauth"
      ? `Logged out of ${name}`
      : `Removed stored API key for ${name}. Environment variables and models.json config are unchanged.`,
    "info",
  );
  thread.pushState();
}

// ---------- /settings ----------

const onOff = (v: boolean) => (v ? "on" : "off");

function settingItems(session: AgentSession): SettingItem[] {
  const sm = session.settingsManager;
  return [
    {
      id: "autoCompact",
      label: "Auto-compact",
      description: "Compact the context automatically when it fills up",
      value: onOff(session.autoCompactionEnabled),
      options: ["on", "off"],
    },
    {
      id: "steeringMode",
      label: "Steering mode",
      description: "How queued steering messages are delivered while the agent works",
      value: session.steeringMode,
      options: ["one-at-a-time", "all"],
    },
    {
      id: "followUpMode",
      label: "Follow-up mode",
      description: "How queued follow-up messages are delivered after the agent finishes",
      value: session.followUpMode,
      options: ["one-at-a-time", "all"],
    },
    {
      id: "thinkingLevel",
      label: "Default thinking level",
      description: "Thinking level for new sessions",
      value: sm.getDefaultThinkingLevel() ?? "medium",
      options: THINKING_LEVELS,
    },
    {
      id: "transport",
      label: "Transport",
      description: "How pi talks to providers that support more than one",
      value: sm.getTransport(),
      options: ["auto", "sse", "websocket", "websocket-cached"],
    },
    {
      id: "cacheWarming",
      label: "Cache warming",
      description: "Keep the provider's prompt cache warm",
      value: sm.getCacheWarmingMode(),
      options: ["off", "streaming", "idle"],
    },
    {
      id: "enableSkillCommands",
      label: "Skill commands",
      description: "Offer skills as /skill:name commands",
      value: onOff(sm.getEnableSkillCommands()),
      options: ["on", "off"],
    },
    {
      id: "defaultProjectTrust",
      label: "Default project trust",
      description: "Whether project extensions and settings load without asking",
      value: sm.getDefaultProjectTrust(),
      options: ["ask", "always", "never"],
    },
    {
      id: "enableInstallTelemetry",
      label: "Install telemetry",
      description: "Send an anonymous ping on install and update",
      value: onOff(sm.getEnableInstallTelemetry()),
      options: ["on", "off"],
    },
  ];
}

function applySetting(thread: LiveThread, id: string, value: string): void {
  const session = thread.session;
  const sm = session.settingsManager;
  const on = value === "on";
  switch (id) {
    case "autoCompact":
      session.setAutoCompactionEnabled(on);
      break;
    case "steeringMode":
      session.setSteeringMode(value as "all" | "one-at-a-time");
      break;
    case "followUpMode":
      session.setFollowUpMode(value as "all" | "one-at-a-time");
      break;
    case "thinkingLevel":
      sm.setDefaultThinkingLevel(value as never);
      break;
    case "transport":
      sm.setTransport(value as never);
      (session.agent as { transport?: unknown }).transport = value;
      break;
    case "cacheWarming":
      session.setCacheWarmingMode(value as never);
      break;
    case "enableSkillCommands":
      sm.setEnableSkillCommands(on);
      thread.pushCommands();
      break;
    case "defaultProjectTrust":
      sm.setDefaultProjectTrust(value as never);
      break;
    case "enableInstallTelemetry":
      sm.setEnableInstallTelemetry(on);
      break;
  }
}

async function settings(thread: LiveThread): Promise<void> {
  const id = randomUUID();
  const request = (): UIRequest => ({ id, method: "settings", title: "Settings", items: settingItems(thread.session) });
  await thread.ask(request(), (action) => {
    if (!("setting" in action)) return;
    try {
      applySetting(thread, action.setting, action.value);
    } catch (err) {
      thread.notify(err instanceof Error ? err.message : String(err), "error");
    }
    thread.updateDialog(request());
    thread.pushState();
  });
}

// ---------- /session ----------

function sessionInfo(session: AgentSession): string {
  const s = session.getSessionStats();
  const lines = [
    "**Session**",
    "",
    `- Name: ${session.sessionName ?? "(unnamed)"}`,
    `- ID: \`${s.sessionId}\``,
    `- File: \`${s.sessionFile ?? "not saved yet"}\``,
    `- Model: ${session.model ? `${session.model.provider}/${session.model.id}` : "none"}`,
    `- Messages: ${s.userMessages} user, ${s.assistantMessages} assistant, ${s.toolCalls} tool calls (${s.totalMessages} total)`,
    `- Tokens: ${s.tokens.input.toLocaleString()} in, ${s.tokens.output.toLocaleString()} out, ${s.tokens.cacheRead.toLocaleString()} cache read, ${s.tokens.cacheWrite.toLocaleString()} cache write`,
    `- Cost: $${s.cost.toFixed(4)}`,
  ];
  if (s.contextUsage) {
    const pct = s.contextUsage.percent;
    lines.push(`- Context: ${pct === null || pct === undefined ? "unknown" : `${Math.round(pct)}%`} of ${s.contextUsage.contextWindow.toLocaleString()}`);
  }
  return lines.join("\n");
}

// ---------- /mcp ----------

/**
 * The MCP extension shows its manager only in pi's TUI. Run its command with a context that says
 * "tui", so the manager comes up through ctx.ui.custom, which the web UI mirrors as a terminal panel.
 */
async function runMcpManager(thread: LiveThread): Promise<void> {
  const runner = thread.session.extensionRunner;
  const command = runner.getCommand("mcp");
  if (!command) return;
  const base = runner.createCommandContext();
  const ctx = Object.create(base, { mode: { value: "tui", enumerable: true } }) as ExtensionCommandContext;
  await command.handler("", ctx);
}
