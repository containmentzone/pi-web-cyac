import { useEffect, useMemo, useRef, useState } from "react";
import type { PickItem, UIRequest, UIResponse } from "../../../shared/protocol";
import { Button, Field, Panel } from "../cyac";
import { send } from "../socket";
import { keyToTerminal, renderAnsiLine } from "./ansi";
import { pad } from "./format";

function useCountdown(timeout?: number): string | undefined {
  const [left, setLeft] = useState(timeout);
  useEffect(() => {
    if (!timeout) return;
    const end = Date.now() + timeout;
    const t = setInterval(() => setLeft(Math.max(0, end - Date.now())), 250);
    return () => clearInterval(t);
  }, [timeout]);
  if (!timeout || left === undefined) return undefined;
  const s = Math.ceil(left / 1000);
  return `${pad(s / 60)}:${pad(s % 60)}`;
}

/** A long or searchable list: filter box, arrow keys, Enter. Like pi's model and provider pickers. */
function PickList({
  items,
  selected,
  disabled,
  onPick,
  onCancel,
}: {
  items: PickItem[];
  selected?: string;
  disabled: boolean;
  onPick: (value: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const words = q.split(/\s+/);
    return items.filter((i) => {
      const hay = `${i.label} ${i.value} ${i.description ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, query]);
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => i.value === selected)));
  const listRef = useRef<HTMLDivElement>(null);
  const firstQuery = useRef(true);
  useEffect(() => {
    // Start on the current item; typing a filter jumps to the first match.
    if (firstQuery.current) firstQuery.current = false;
    else setIndex(0);
  }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="pick">
      <Field
        label="Filter"
        code={`${filtered.length}/${items.length}`}
        value={query}
        autoFocus
        disabled={disabled}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(filtered.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const item = filtered[index];
            if (item) onPick(item.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="pick__list" role="listbox" ref={listRef}>
        {filtered.map((item, i) => (
          <div
            key={item.value}
            role="option"
            aria-selected={i === index}
            data-index={i}
            className={`pick__row${i === index ? " pick__row--active" : ""}${item.value === selected ? " pick__row--current" : ""}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => !disabled && onPick(item.value)}
          >
            <span className="pick__label">{item.label}</span>
            {item.description && <span className="pick__desc">{item.description}</span>}
            {item.value === selected && <span className="pick__mark">CURRENT</span>}
          </div>
        ))}
        {filtered.length === 0 && <div className="pick__empty">No matches</div>}
      </div>
      <div className="ui-card__actions">
        <Button variant="ghost" size="s" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** pi TUI component mirrored from the server. Keys typed here go back as terminal input. */
function Terminal({ threadId, request }: { threadId: string; request: Extract<UIRequest, { method: "terminal" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const keys = (data: string) => send({ type: "ui_action", threadId, id: request.id, action: { keys: data } });
  return (
    <div
      ref={ref}
      className="term"
      tabIndex={0}
      role="application"
      aria-label="Terminal panel"
      onKeyDown={(e) => {
        const data = keyToTerminal(e);
        if (data === undefined) return;
        e.preventDefault();
        keys(data);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text");
        if (text) keys(`\u001b[200~${text}\u001b[201~`);
      }}
    >
      {request.lines.map((line, i) => renderAnsiLine(line, i))}
    </div>
  );
}

/**
 * A dialog rendered inline in the thread: an extension's ctx.ui prompt, or one of pi's own
 * pickers (/model, /login, /settings). The server holds the pending request, so the card
 * reappears after a reload and the first answer from any tab wins.
 */
export function UICard({ threadId, request }: { threadId: string; request: UIRequest }) {
  const [text, setText] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
  const [sent, setSent] = useState(false);
  const countdown = useCountdown("timeout" in request ? request.timeout : undefined);

  const respond = (response: UIResponse) => {
    if (sent) return;
    setSent(true);
    send({ type: "ui_response", threadId, response });
  };
  const cancel = () => respond({ id: request.id, cancelled: true });

  const kind =
    request.method === "input" && request.secret ? "SECRET" : request.method.toUpperCase();
  const code = ["INPUT", kind, countdown].filter(Boolean).join(" / ");
  const live = request.method === "terminal" || request.method === "settings";

  return (
    <div className={`ui-card${request.method === "terminal" ? " ui-card--wide" : ""}`} role="group" aria-label={request.title || kind}>
      <Panel title={request.title || undefined} code={code} active>
        {"message" in request && request.message && request.method !== "confirm" && (
          <p className="ui-card__message">{request.message}</p>
        )}

        {request.method === "select" &&
          (() => {
            const items: PickItem[] = request.items ?? request.options.map((o) => ({ value: o, label: o }));
            if (request.search || items.length > 8) {
              return (
                <PickList
                  items={items}
                  selected={request.selected}
                  disabled={sent}
                  onPick={(value) => respond({ id: request.id, value })}
                  onCancel={cancel}
                />
              );
            }
            return (
              <div className="ui-card__options">
                {items.map((item, i) => (
                  <Button
                    key={item.value}
                    code={pad(i + 1)}
                    variant={item.value === request.selected ? "primary" : "secondary"}
                    disabled={sent}
                    title={item.description}
                    onClick={() => respond({ id: request.id, value: item.value })}
                  >
                    {item.label}
                  </Button>
                ))}
                <Button variant="ghost" disabled={sent} onClick={cancel}>
                  Cancel
                </Button>
              </div>
            );
          })()}

        {request.method === "confirm" && (
          <>
            {request.message && <p className="ui-card__message">{request.message}</p>}
            <div className="ui-card__actions">
              <Button disabled={sent} onClick={() => respond({ id: request.id, confirmed: true })}>
                Confirm
              </Button>
              <Button disabled={sent} onClick={() => respond({ id: request.id, confirmed: false })}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {(request.method === "input" || request.method === "editor") && (
          <form
            className="ui-card__form"
            onSubmit={(e) => {
              e.preventDefault();
              respond({ id: request.id, value: text });
            }}
          >
            <Field
              label={request.method === "editor" ? "Text" : request.method === "input" && request.secret ? "Secret" : "Value"}
              placeholder={request.method === "input" ? request.placeholder : undefined}
              type={request.method === "input" && request.secret ? "password" : undefined}
              autoComplete={request.method === "input" && request.secret ? "off" : undefined}
              multiline={request.method === "editor"}
              rows={request.method === "editor" ? 10 : undefined}
              value={text}
              autoFocus
              onChange={(e) => setText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                } else if (request.method === "editor" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  respond({ id: request.id, value: text });
                }
              }}
            />
            <div className="ui-card__actions">
              <Button type="submit" disabled={sent}>
                Submit
              </Button>
              <Button disabled={sent} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {request.method === "settings" && (
          <div className="settings">
            {request.items.map((item) => (
              <div className="settings__row" key={item.id}>
                <div className="settings__text">
                  <span className="settings__label">{item.label}</span>
                  {item.description && <span className="settings__desc">{item.description}</span>}
                </div>
                <div className="settings__options" role="radiogroup" aria-label={item.label}>
                  {item.options.map((opt) => (
                    <Button
                      key={opt}
                      size="s"
                      role="radio"
                      aria-checked={opt === item.value}
                      variant={opt === item.value ? "secondary" : "ghost"}
                      onClick={() =>
                        opt !== item.value &&
                        send({ type: "ui_action", threadId, id: request.id, action: { setting: item.id, value: opt } })
                      }
                    >
                      {opt}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {request.method === "terminal" && <Terminal threadId={threadId} request={request} />}

        {live && (
          <div className="ui-card__actions">
            <Button size="s" variant="ghost" disabled={sent} onClick={cancel}>
              {request.method === "settings" ? "Done" : "Close"}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
