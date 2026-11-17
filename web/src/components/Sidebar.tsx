import { useState } from "react";
import type { ThreadSummary } from "../../../shared/protocol";
import { Badge, Button, Field } from "../cyac";
import { send } from "../socket";
import { useStore } from "../store";
import { ago, basename, pad } from "./format";

function ThreadRow({ t, index, active }: { t: ThreadSummary; index: number; active: boolean }) {
  return (
    <li>
      <a
        href={`#/t/${encodeURIComponent(t.id)}`}
        className={`thread-row${active ? " thread-row--active" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        <span className="thread-row__top">
          <span className="thread-row__index">{pad(index + 1)}</span>
          <span className="thread-row__title">{t.title}</span>
        </span>
        <span className="thread-row__meta">
          <span className="thread-row__cwd" title={t.cwd}>
            {basename(t.cwd) || "/"}
          </span>
          <span className="thread-row__spacer" />
          {t.needsInput ? (
            <Badge tone="caution" dot>
              Needs input
            </Badge>
          ) : t.busy ? (
            <Badge tone="accent" dot>
              Running
            </Badge>
          ) : (
            <span className="thread-row__ago">{ago(t.modified)}</span>
          )}
        </span>
      </a>
    </li>
  );
}

export function Sidebar({ onPicked }: { onPicked?: () => void }) {
  const threads = useStore((s) => s.threads);
  const loaded = useStore((s) => s.threadsLoaded);
  const current = useStore((s) => s.current);
  const defaultCwd = useStore((s) => s.defaultCwd);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const visible = threads.filter((t) => (showArchived ? t.archived : !t.archived));
  const archivedCount = threads.filter((t) => t.archived).length;

  const create = () => {
    send({ type: "create_thread", cwd: cwd.trim() || defaultCwd });
    setCreating(false);
    setCwd("");
    onPicked?.();
  };

  return (
    <nav className="sidebar" aria-label="Threads">
      <header className="sidebar__head">
        <span className="wordmark">CyAc</span>
        <span className="sidebar__code">PI / AGENT</span>
      </header>

      <div className="sidebar__new">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field
              label="Working dir"
              code="CWD"
              placeholder={defaultCwd}
              value={cwd}
              autoFocus
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              hint="Absolute path on the server. Empty uses the default."
            />
            <div className="sidebar__new-actions">
              <Button type="submit" size="s">
                Start
              </Button>
              <Button variant="ghost" size="s" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="s" code="+" onClick={() => setCreating(true)}>
            New thread
          </Button>
        )}
      </div>

      <div className="sidebar__label">
        <span>{showArchived ? "Archived" : "Threads"}</span>
        <span>{pad(visible.length)}</span>
      </div>

      <ul className="thread-list" onClick={() => onPicked?.()}>
        {visible.map((t, i) => (
          <ThreadRow key={t.id} t={t} index={i} active={t.id === current} />
        ))}
        {loaded && visible.length === 0 && (
          <li className="thread-list__empty">{showArchived ? "No archived threads." : "No threads yet. Start one above."}</li>
        )}
      </ul>

      {(archivedCount > 0 || showArchived) && (
        <div className="sidebar__foot">
          <Button variant="ghost" size="s" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Back to threads" : `Archived ${pad(archivedCount)}`}
          </Button>
        </div>
      )}
    </nav>
  );
}

