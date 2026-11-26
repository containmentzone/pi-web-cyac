import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreadSummary, Widget } from "../../../shared/protocol";
import { Button, Composer, Loader, Menu, Metric, Panel, StatusBar } from "../cyac";
import { send } from "../socket";
import { type ThreadView as View, toggleTerminal, useStore } from "../store";
import { tildify, tokens } from "./format";
import { usePalette } from "./Palette";
import { TerminalPanel } from "./TerminalPanel";
import { Transcript } from "./Transcript";

function Widgets({ widgets, placement }: { widgets: Record<string, Widget>; placement: Widget["placement"] }) {
  const entries = Object.entries(widgets).filter(([, w]) => w.placement === placement);
  if (!entries.length) return null;
  return (
    <div className="widgets">
      {entries.map(([key, w]) => (
        <Panel key={key} code={key.toUpperCase()}>
          <pre className="widget-lines">{w.lines.join("\n")}</pre>
        </Panel>
      ))}
    </div>
  );
}

function Header({ thread, view }: { thread?: ThreadSummary; view: View }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const threadId = useStore((s) => s.current)!;
  const home = useStore((s) => s.home);
  const title = view.state.extTitle || view.state.title || thread?.title || "Thread";
  const archived = !!thread?.archived;
  const terminalEnabled = useStore((s) => s.terminalEnabled);
  const terminalOpen = useStore((s) => !!s.terminalOpen[threadId]);

  return (
    <header className="thread-head">
      {renaming ? (
        <form
          className="thread-head__rename"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) send({ type: "rename", threadId, name: name.trim() });
            setRenaming(false);
          }}
        >
          <input
            className="thread-head__input"
            aria-label="Thread name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
          />
          <Button size="s" type="submit">
            Save
          </Button>
        </form>
      ) : (
        <h1 className="thread-head__title" title={title}>
          {title}
        </h1>
      )}
      <span className="thread-head__cwd" title={thread?.cwd}>
        {thread ? tildify(thread.cwd, home) : ""}
      </span>
      <span className="thread-head__actions">
        {terminalEnabled && (
          <Button
            size="s"
            variant={terminalOpen ? "secondary" : "ghost"}
            code="TTY"
            aria-pressed={terminalOpen}
            title="Terminal in this thread's folder (Ctrl+`)"
            onClick={() => toggleTerminal(threadId)}
          >
            Terminal
          </Button>
        )}
        <Menu
          size="s"
          variant="ghost"
          align="right"
          label="Thread"
          items={[
            { value: "rename", label: "Rename" },
            { value: "archive", label: archived ? "Unarchive" : "Archive" },
          ]}
          onSelect={(v) => {
            if (v === "rename") {
              setName(thread?.name ?? title);
              setRenaming(true);
            } else if (v === "archive") {
              send({ type: "archive", threadId, archived: !archived });
            }
          }}
        />
      </span>
    </header>
  );
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function ThreadView({ threadId }: { threadId: string }) {
  const view = useStore((s) => s.views[threadId]);
  const thread = useStore((s) => s.threads.find((t) => t.id === threadId));
  const models = useStore((s) => s.models);
  const home = useStore((s) => s.home);
  const [draft, setDraft] = useState("");
  const scrollRef = useStickToBottom(view);
  const terminalEnabled = useStore((s) => s.terminalEnabled);
  const terminalOpen = useStore((s) => !!s.terminalOpen[threadId]);

  // Ctrl+` shows and hides the terminal, as in most editors.
  useEffect(() => {
    if (!terminalEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "`") {
        e.preventDefault();
        toggleTerminal(threadId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [threadId, terminalEnabled]);
  const busyNow = !!view?.state.busy;
  const locked = !!view?.lease.held && !view.lease.mine;

  // One tab types at a time: typing claims the thread's composer lease (renewed at most every 5s),
  // clearing the text gives it back, and sending or leaving the thread releases it on the server.
  const lastClaim = useRef(0);
  const setDraftAndLease = (text: string) => {
    setDraft(text);
    if (!text) {
      if (view?.lease.mine) send({ type: "compose", threadId, typing: false });
      lastClaim.current = 0;
    } else if (!view?.lease.mine || Date.now() - lastClaim.current > 5_000) {
      send({ type: "compose", threadId, typing: true });
      lastClaim.current = Date.now();
    }
  };
  const submit = (text: string) => {
    if (!text.trim() || locked) return;
    lastClaim.current = 0;
    send({ type: "prompt", threadId, text, behavior: busyNow ? "steer" : undefined });
    setDraft("");
  };
  const palette = usePalette({ threadId, draft, setDraft: setDraftAndLease, commands: view?.commands ?? [], submit });

  // Drafts are per thread; extensions can also set the editor text (ctx.ui.setEditorText).
  useEffect(() => setDraft(""), [threadId]);
  const editorSeq = view?.editorText?.seq;
  useEffect(() => {
    if (view?.editorText) setDraft(view.editorText.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSeq]);

  if (!view) {
    return (
      <main className="thread thread--loading">
        <Loader label="Opening session" />
      </main>
    );
  }

  const { state } = view;
  const busy = state.busy;
  const model = state.model;
  const queued = state.queue.steering.length + state.queue.followUp.length;

  const modelItems = models.map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name || m.id, code: m.provider }));
  const modelValue = model ? `${model.provider}/${model.id}` : undefined;
  if (model && !modelItems.some((i) => i.value === modelValue)) {
    modelItems.unshift({ value: modelValue!, label: model.name || model.id, code: model.provider });
  }

  const left = [
    <Metric key="model" label="Model" value={model ? model.id : "NONE"} tone={model ? undefined : "alert"} />,
    <Metric
      key="ctx"
      label="Ctx"
      value={state.stats.contextPercent !== null ? `${Math.round(state.stats.contextPercent)}%` : "--"}
      percent={state.stats.contextPercent ?? undefined}
      tone={state.stats.contextPercent !== null && state.stats.contextPercent > 85 ? "caution" : undefined}
    />,
    <Metric key="tok" label="Tok" value={tokens(state.stats.tokens)} />,
    <Metric key="cost" label="Cost" value={`$${state.stats.cost.toFixed(3)}`} />,
    ...(queued ? [<Metric key="queue" label="Queued" value={String(queued)} tone="caution" />] : []),
    ...Object.entries(view.statuses).map(([key, text]) => <Metric key={`st-${key}`} label={key} value={text} />),
  ];

  const right = [
    ...(state.thinkingLevels.length
      ? [
          <Menu
            key="think"
            size="xs"
            variant="ghost"
            placement="top"
            align="right"
            code="THINK"
            value={state.thinkingLevel}
            items={state.thinkingLevels.map((l) => ({ value: l, label: l }))}
            onSelect={(level) => send({ type: "set_thinking", threadId, level })}
          />,
        ]
      : []),
  ];

  // CyAc's Composer swaps Send for Stop while busy. Once there is text, show Send again
  // (it steers the running agent) and keep Stop next to it.
  const showStop = busy && !draft.trim();

  return (
    <main className="thread">
      <Header thread={thread} view={view} />
      <div className="thread__scroll" ref={scrollRef}>
        <Transcript
          threadId={threadId}
          messages={view.messages}
          streamingIndex={view.streamingIndex}
          toolRuns={view.toolRuns}
          notices={view.notices}
          pendingUi={view.pendingUi}
          busy={busy}
        />
        {view.messages.length === 0 && !busy && view.notices.length === 0 && view.pendingUi.length === 0 && (
          <div className="empty">
            <span className="empty__caption">[READY]</span>
            <span className="empty__sub">{thread ? tildify(thread.cwd, home) : ""}</span>
          </div>
        )}
      </div>
      {terminalEnabled && terminalOpen && <TerminalPanel threadId={threadId} />}
      <div className="thread__bottom">
        <Widgets widgets={view.widgets} placement="aboveEditor" />
        <div className="composer-wrap" onKeyDownCapture={palette.onKeyDownCapture}>
          {palette.element}
        <Composer
          value={draft}
          onChange={setDraftAndLease}
          onSubmit={submit}
          disabled={locked}
          busy={showStop}
          onStop={() => send({ type: "abort", threadId })}
          submitLabel={busy ? "Steer" : "Send"}
          placeholder={
            locked ? "Someone is typing in another tab." : busy ? "Steer the running agent, or Stop" : "Message pi. Type / for commands."
          }
          tools={
            <>
              {modelItems.length > 0 && (
                <Menu
                  size="s"
                  variant="ghost"
                  placement="top"
                  value={modelValue}
                  label={model ? undefined : "Model"}
                  items={modelItems}
                  onSelect={(v) => {
                    const [provider, ...rest] = v.split("/");
                    send({ type: "set_model", threadId, provider: provider!, modelId: rest.join("/") });
                  }}
                />
              )}
              {busy && !showStop && (
                <Button size="s" variant="ghost" onClick={() => send({ type: "abort", threadId })}>
                  Stop
                </Button>
              )}
            </>
          }
        />
        </div>
        <Widgets widgets={view.widgets} placement="belowEditor" />
        <StatusBar left={left} right={right} label="Session status" />
      </div>
    </main>
  );
}
