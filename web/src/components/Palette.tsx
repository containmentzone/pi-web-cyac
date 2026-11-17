import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CommandInfo, PickItem } from "../../../shared/protocol";
import { send } from "../socket";
import { awaitCompletions } from "../store";

/** Commands that take an argument, so picking one leaves the cursor after "/name ". */
const TAKES_ARGS = new Set(["model", "thinking", "login", "name", "compact"]);

interface Row {
  key: string;
  label: string;
  hint?: string;
  description?: string;
  source?: CommandInfo["source"];
  apply: () => string;
}

function filterCommands(commands: CommandInfo[], q: string): CommandInfo[] {
  const query = q.toLowerCase();
  if (!query) return commands;
  const scored: { c: CommandInfo; score: number }[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(query)) scored.push({ c, score: 0 });
    else if (name.includes(query)) scored.push({ c, score: 1 });
    else if (query.length >= 3 && (c.description ?? "").toLowerCase().includes(query)) scored.push({ c, score: 2 });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.c);
}

/**
 * pi's slash-command autocomplete: typing "/" lists commands with their help text, and after
 * "/name " the server's argument completions (models, providers, extension completions).
 */
export function usePalette(opts: {
  threadId: string;
  draft: string;
  setDraft: (text: string) => void;
  commands: CommandInfo[];
  submit: (text: string) => void;
}) {
  const { threadId, draft, setDraft, commands, submit } = opts;
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [args, setArgs] = useState<{ text: string; items: PickItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const cmdMatch = /^\/(\S*)$/.exec(draft);
  const argMatch = /^\/(\S+)\s(.*)$/s.exec(draft);

  // Ask the server for argument completions, debounced.
  useEffect(() => {
    if (!argMatch || draft.includes("\n")) {
      setArgs(null);
      return;
    }
    const known = commands.some((c) => c.name === argMatch[1]);
    if (!known) {
      setArgs(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const { reqId, result } = awaitCompletions();
      send({ type: "complete", threadId, text: draft, reqId });
      void result.then((items) => {
        if (live) setArgs({ text: draft, items });
      });
    }, 80);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, threadId, commands]);

  const rows: Row[] = useMemo(() => {
    if (cmdMatch) {
      return filterCommands(commands, cmdMatch[1]!).map((c) => ({
        key: `c:${c.name}`,
        label: `/${c.name}`,
        hint: c.argumentHint,
        description: c.description,
        source: c.source,
        apply: () => `/${c.name}${c.argumentHint || TAKES_ARGS.has(c.name) || c.source !== "builtin" ? " " : ""}`,
      }));
    }
    if (argMatch && args && args.text === draft) {
      const name = argMatch[1]!;
      return args.items.map((item) => ({
        key: `a:${item.value}`,
        label: item.label,
        description: item.description && item.description !== item.label ? item.description : undefined,
        hint: item.label !== item.value ? item.value : undefined,
        apply: () => `/${name} ${item.value}`,
      }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, commands, args]);

  const open = rows.length > 0 && dismissed !== draft;

  useEffect(() => setIndex(0), [rows.length, cmdMatch?.[1], argMatch?.[1]]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (row: Row, run: boolean) => {
    const next = row.apply();
    const trimmed = next.trimEnd();
    // Enter runs a command as is (its picker opens) or a finished argument; a partial argument
    // such as "login " only completes.
    if (run && (row.key.startsWith("c:") || !next.endsWith(" "))) {
      submit(trimmed);
      return;
    }
    setDraft(next);
    // A finished argument (no trailing space) closes the list until the text changes again.
    if (!next.endsWith(" ")) setDismissed(next);
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (!open || e.nativeEvent.isComposing) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        stop();
        setIndex((i) => (i + 1) % rows.length);
        return;
      case "ArrowUp":
        stop();
        setIndex((i) => (i - 1 + rows.length) % rows.length);
        return;
      case "Tab":
        stop();
        choose(rows[index]!, false);
        return;
      case "Enter":
        if (e.shiftKey) return;
        stop();
        choose(rows[index]!, true);
        return;
      case "Escape":
        stop();
        setDismissed(draft);
        return;
    }
  };

  const element = open ? (
    <div className="palette" role="listbox" aria-label="Commands" ref={listRef}>
      {rows.slice(0, 200).map((row, i) => (
        <div
          key={row.key}
          role="option"
          aria-selected={i === index}
          data-index={i}
          className={`palette__row${i === index ? " palette__row--active" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            choose(row, false);
          }}
        >
          <span className="palette__name">{row.label}</span>
          {row.hint && <span className="palette__hint">{row.hint}</span>}
          {row.description && <span className="palette__desc">{row.description}</span>}
          {row.source && row.source !== "builtin" && <span className="palette__src">{row.source}</span>}
        </div>
      ))}
      <div className="palette__keys">↑↓ select · Tab complete · Enter run · Esc close</div>
    </div>
  ) : null;

  return { onKeyDownCapture, element };
}
