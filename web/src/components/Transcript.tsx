import { Fragment, memo, type ReactNode } from "react";
import type { ContentBlock, Notice, PiMessage, UIRequest } from "../../../shared/protocol";
import { Badge, Message, Thinking, ToolCall } from "../cyac";
import type { ToolRunView } from "../store";
import { clock, seconds } from "./format";
import { Markdown } from "./Markdown";
import { UICard } from "./UICard";

interface Group {
  kind: "user" | "assistant" | "other";
  start: number;
  end: number;
  messages: PiMessage[];
}

/** Collapse each assistant turn (assistant messages plus their tool results) into one block. */
function groupMessages(messages: PiMessage[]): Group[] {
  const groups: Group[] = [];
  messages.forEach((m, i) => {
    if (m.role === "system") return;
    const kind = m.role === "user" ? "user" : m.role === "assistant" || m.role === "toolResult" ? "assistant" : "other";
    const last = groups[groups.length - 1];
    if (kind === "assistant" && last?.kind === "assistant") {
      last.messages.push(m);
      last.end = i;
    } else {
      groups.push({ kind, start: i, end: i, messages: [m] });
    }
  });
  return groups;
}

function textContent(m: PiMessage): string {
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

function resultText(result: unknown): unknown {
  if (result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content)) {
    const blocks = (result as { content: ContentBlock[] }).content;
    return blocks.map((b) => (b.type === "text" ? b.text : b.type === "image" ? `[image ${b.mimeType}]` : "")).join("\n");
  }
  return result;
}

function summarize(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "command", "pattern", "query", "url"]) {
    if (typeof a[key] === "string") return (a[key] as string).split("\n")[0];
  }
  const first = Object.values(a).find((v) => typeof v === "string");
  return typeof first === "string" ? first.split("\n")[0] : undefined;
}

function partialArgs(text?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function AssistantTurn({
  group,
  results,
  toolRuns,
  streaming,
}: {
  group: Group;
  results: Map<string, PiMessage>;
  toolRuns: Record<string, ToolRunView>;
  streaming: boolean;
}) {
  const assistants = group.messages.filter((m) => m.role === "assistant");
  const first = assistants[0];
  const last = assistants[assistants.length - 1];
  const model = last?.model;
  const body: ReactNode[] = [];

  assistants.forEach((m, mi) => {
    const blocks = Array.isArray(m.content) ? m.content : [];
    const isLive = streaming && m === last;
    blocks.forEach((block, bi) => {
      const key = `${mi}-${bi}`;
      if (block.type === "text") {
        if (block.text.trim()) body.push(<Markdown key={key} text={block.text} />);
      } else if (block.type === "thinking") {
        if (block.redacted && !block.thinking) return;
        const live = isLive && bi === blocks.length - 1;
        body.push(
          <Thinking key={key} streaming={live}>
            <div className="thinking-text">{block.thinking}</div>
          </Thinking>,
        );
      } else if (block.type === "toolCall") {
        const result = results.get(block.id);
        const run = toolRuns[block.id];
        const status = result ? (result.isError ? "error" : "ok") : run ? run.status : isLive ? "running" : "running";
        const args = Object.keys(block.arguments ?? {}).length
          ? block.arguments
          : (run?.args ?? partialArgs((block as { argsText?: string }).argsText));
        const output = result ? resultText(result) : run?.result !== undefined ? resultText(run.result) : run?.partial !== undefined ? resultText(run.partial) : undefined;
        body.push(
          <ToolCall
            key={key}
            name={block.name}
            summary={summarize(args)}
            status={status}
            duration={seconds(run?.durationMs)}
            input={args}
            output={output}
          />,
        );
      }
    });
    if (m.stopReason === "error" && m.errorMessage) {
      body.push(
        <p key={`${mi}-err`} className="turn-error">
          <Badge tone="alert" /> {m.errorMessage}
        </p>,
      );
    } else if (m.stopReason === "aborted") {
      body.push(
        <p key={`${mi}-abort`} className="turn-note">
          <Badge tone="caution">STOPPED</Badge>
        </p>,
      );
    }
  });

  if (body.length === 0 && streaming) {
    body.push(
      <Thinking key="wait" streaming>
        {null}
      </Thinking>,
    );
  }

  return (
    <Message role="assistant" name="pi" time={clock(first?.timestamp)} meta={model}>
      {body}
    </Message>
  );
}

function OtherMessage({ m }: { m: PiMessage }) {
  switch (m.role) {
    case "bashExecution":
      return (
        <ToolCall
          name="!bash"
          summary={m.command}
          status={m.exitCode === 0 ? "ok" : "error"}
          input={m.command}
          output={m.output}
        />
      );
    case "compactionSummary":
      return (
        <div className="divider-note">
          <span>CONTEXT COMPACTED</span>
          <Thinking>
            <Markdown text={m.summary ?? ""} />
          </Thinking>
        </div>
      );
    case "branchSummary":
      return (
        <div className="divider-note">
          <span>BRANCH SUMMARY</span>
          <Thinking>
            <Markdown text={m.summary ?? ""} />
          </Thinking>
        </div>
      );
    case "custom":
      if (m.display === false) return null;
      return (
        <Message role="assistant" name={m.customType ?? "extension"} time={clock(m.timestamp)}>
          <Markdown text={textContent(m)} />
        </Message>
      );
    default:
      return null;
  }
}

function NoticeLine({ notice }: { notice: Notice }) {
  const tone = notice.level === "error" ? "alert" : notice.level === "warning" ? "caution" : "info";
  return (
    <div className={`notice notice--${notice.level}`} role={notice.level === "error" ? "alert" : "status"}>
      <Badge tone={tone} />
      <div className="notice__body">
        <Markdown text={notice.message} />
      </div>
    </div>
  );
}

export const Transcript = memo(function Transcript({
  threadId,
  messages,
  streamingIndex,
  toolRuns,
  notices,
  pendingUi,
  busy,
}: {
  threadId: string;
  messages: PiMessage[];
  streamingIndex: number | null;
  toolRuns: Record<string, ToolRunView>;
  notices: Notice[];
  pendingUi: UIRequest[];
  busy: boolean;
}) {
  const results = new Map<string, PiMessage>();
  for (const m of messages) if (m.role === "toolResult" && m.toolCallId) results.set(m.toolCallId, m);
  const groups = groupMessages(messages);
  const lastGroup = groups[groups.length - 1];
  const waiting = busy && lastGroup?.kind !== "assistant" && streamingIndex === null;

  // Each notice renders after the last group that starts at or before the message count it saw.
  const byGroup = new Map<number, Notice[]>();
  const leading: Notice[] = [];
  for (const n of notices) {
    let gi = -1;
    for (let i = 0; i < groups.length; i++) if (groups[i]!.start <= n.after - 1) gi = i;
    if (gi < 0) leading.push(n);
    else byGroup.set(gi, [...(byGroup.get(gi) ?? []), n]);
  }

  return (
    <div className="transcript">
      {leading.map((n) => (
        <NoticeLine key={n.id} notice={n} />
      ))}
      {groups.map((g, gi) => {
        const after = byGroup.get(gi) ?? [];
        const isStreaming = streamingIndex !== null && streamingIndex >= g.start && streamingIndex <= g.end;
        return (
          <Fragment key={`${g.kind}-${g.start}`}>
            {g.kind === "user" ? (
              <Message role="user" name="You" time={clock(g.messages[0]?.timestamp)}>
                {/* What you typed, verbatim: Markdown would join single newlines and eat pasted layout. */}
                <div className="user-text">{textContent(g.messages[0]!)}</div>
              </Message>
            ) : g.kind === "assistant" ? (
              <AssistantTurn
                group={g}
                results={results}
                toolRuns={toolRuns}
                streaming={isStreaming || (busy && gi === groups.length - 1)}
              />
            ) : (
              <OtherMessage m={g.messages[0]!} />
            )}
            {after.map((n) => (
              <NoticeLine key={n.id} notice={n} />
            ))}
          </Fragment>
        );
      })}
      {waiting && (
        <Message role="assistant" name="pi">
          <Thinking streaming>{null}</Thinking>
        </Message>
      )}
      {pendingUi.map((req) => (
        <UICard key={req.id} threadId={threadId} request={req} />
      ))}
    </div>
  );
});
