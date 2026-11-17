import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { CommandInfo, PickItem } from "../shared/protocol.js";

/**
 * pi's interactive-only commands that the web UI implements itself (see builtins.ts). Names and
 * help text follow pi's own list (core/slash-commands.ts).
 */
export const WEB_BUILTINS: CommandInfo[] = [
  { name: "settings", description: "Open settings menu", source: "builtin" },
  { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>", source: "builtin" },
  { name: "thinking", description: "Set thinking level", argumentHint: "<level>", source: "builtin" },
  { name: "login", description: "Configure provider authentication", argumentHint: "<provider>", source: "builtin" },
  { name: "logout", description: "Remove provider authentication", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
  { name: "name", description: "Set session display name", argumentHint: "<name>", source: "builtin" },
  { name: "session", description: "Show session info and stats", source: "builtin" },
  { name: "compact", description: "Manually compact the session context", argumentHint: "<instructions>", source: "builtin" },
  { name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files", source: "builtin" },
];

const BUILTIN_NAMES = new Set(WEB_BUILTINS.map((c) => c.name));

/** Same sources and order as pi's command menu: built-ins, templates, extension commands, skills. */
export function listCommands(session: AgentSession): CommandInfo[] {
  const out: CommandInfo[] = [...WEB_BUILTINS];
  const seen = new Set(BUILTIN_NAMES);
  const add = (c: CommandInfo) => {
    if (seen.has(c.name)) return;
    seen.add(c.name);
    out.push(c);
  };
  try {
    for (const t of session.promptTemplates) {
      add({ name: t.name, description: t.description, argumentHint: (t as { argumentHint?: string }).argumentHint, source: "prompt" });
    }
  } catch {
    // Resources may be mid-reload.
  }
  try {
    for (const c of session.extensionRunner.getRegisteredCommands()) {
      add({ name: c.invocationName, description: c.description, source: "extension" });
    }
  } catch {
    // No extension runner yet.
  }
  try {
    for (const skill of session.resourceLoader.getSkills().skills) {
      add({ name: `skill:${skill.name}`, description: skill.description, source: "skill" });
    }
  } catch {
    // No skills.
  }
  return out;
}

function fuzzy(items: PickItem[], prefix: string): PickItem[] {
  const q = prefix.trim().toLowerCase();
  if (!q) return items;
  const scored = items
    .map((item) => {
      const hay = `${item.value} ${item.label} ${item.description ?? ""}`.toLowerCase();
      const at = hay.indexOf(q);
      if (at >= 0) return { item, score: at };
      // Subsequence match as a fallback, like pi's fuzzy filter.
      let i = 0;
      for (const ch of hay) if (ch === q[i]) i++;
      return i === q.length ? { item, score: 1000 } : undefined;
    })
    .filter((x): x is { item: PickItem; score: number } => !!x);
  return scored.sort((a, b) => a.score - b.score).map((x) => x.item);
}

export function modelItems(session: AgentSession): PickItem[] {
  const scoped = session.scopedModels.map((s) => s.model);
  const models = scoped.length ? scoped : session.modelRuntime.getAvailableSnapshot();
  return models.map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name || m.id, description: m.provider }));
}

/** Argument completions for "/name prefix", like pi's editor autocomplete. */
export async function completeArgs(session: AgentSession, text: string): Promise<PickItem[]> {
  const m = /^\/(\S+)\s(.*)$/s.exec(text);
  if (!m) return [];
  const [, name, prefix] = m as unknown as [string, string, string];
  switch (name) {
    case "model":
      return fuzzy(modelItems(session), prefix).slice(0, 50);
    case "thinking":
      return fuzzy(
        session.getAvailableThinkingLevels().map((l) => ({ value: l, label: l })),
        prefix,
      );
    case "login":
      return fuzzy(
        session.modelRuntime.getProviders().map((p) => ({ value: p.id, label: p.id, description: p.name })),
        prefix,
      ).slice(0, 50);
  }
  if (BUILTIN_NAMES.has(name)) return [];
  const command = session.extensionRunner.getCommand(name);
  if (!command?.getArgumentCompletions) return [];
  try {
    const items = (await command.getArgumentCompletions(prefix)) ?? [];
    return items.slice(0, 50).map((i) => ({ value: i.value, label: i.label ?? i.value, description: i.description }));
  } catch {
    return [];
  }
}
