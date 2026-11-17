import { useEffect, useState } from "react";
import type { UIRequest, UIResponse } from "../../../shared/protocol";
import { Button, Field, Panel } from "../cyac";
import { send } from "../socket";
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

/**
 * An extension's ctx.ui dialog, rendered inline in the thread. The server holds the pending
 * request, so the card reappears after a reload and the first answer from any tab wins.
 */
export function UICard({ threadId, request }: { threadId: string; request: UIRequest }) {
  const [text, setText] = useState(
    request.method === "editor" ? (request.prefill ?? "") : "",
  );
  const [sent, setSent] = useState(false);
  const countdown = useCountdown("timeout" in request ? request.timeout : undefined);

  const respond = (response: UIResponse) => {
    if (sent) return;
    setSent(true);
    send({ type: "ui_response", threadId, response });
  };
  const cancel = () => respond({ id: request.id, cancelled: true });

  const code = ["INPUT", request.method.toUpperCase(), countdown].filter(Boolean).join(" / ");

  return (
    <div className="ui-card" role="group" aria-label={request.title}>
      <Panel title={request.title} code={code} active>
        {request.method === "select" && (
          <div className="ui-card__options">
            {request.options.map((opt, i) => (
              <Button key={opt} code={pad(i + 1)} disabled={sent} onClick={() => respond({ id: request.id, value: opt })}>
                {opt}
              </Button>
            ))}
            <Button variant="ghost" disabled={sent} onClick={cancel}>
              Cancel
            </Button>
          </div>
        )}

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
              label={request.method === "editor" ? "Text" : "Value"}
              placeholder={request.method === "input" ? request.placeholder : undefined}
              multiline={request.method === "editor"}
              rows={request.method === "editor" ? 10 : undefined}
              value={text}
              autoFocus
              onChange={(e) => setText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (request.method === "editor" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
      </Panel>
    </div>
  );
}
