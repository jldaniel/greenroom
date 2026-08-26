import { useState, type FormEvent } from "react";
import { MessagesSquare, Send } from "lucide-react";

import { formatDateTime } from "../../utils";
import type { FollowUpEntry } from "./followUpConversation";

/**
 * Chat-style follow-up Q&A for the Teach page: user question
 * bubbles and answer bubbles in order, the ask input pinned at the bottom,
 * a pending bubble while a follow-up runs, and failures inline in the
 * conversation with a retry affordance.
 */
export function FollowUpThread({
  entries,
  isAsking,
  onAsk,
}: {
  entries: readonly FollowUpEntry[];
  isAsking: boolean;
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();

    if (trimmed.length === 0 || isAsking) {
      return;
    }

    onAsk(trimmed);
    setQuestion("");
  }

  return (
    <section
      aria-label="Follow-up conversation"
      className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessagesSquare aria-hidden="true" className="size-4 text-accent-ink" />
        Follow-up Q&amp;A
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-muted-surface px-3 py-2 text-sm text-muted">
          Ask a question about this change; answers stay within the approved teaching scope.
        </p>
      ) : (
        <ol className="mt-3 space-y-3" data-testid="follow-up-conversation">
          {entries.map((entry) => (
            <ConversationExchange
              entry={entry}
              isAsking={isAsking}
              key={entry.key}
              onRetry={() => onAsk(entry.question)}
            />
          ))}
        </ol>
      )}

      <form className="mt-4 space-y-2" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-xs font-medium text-muted">
          <span>Follow-up</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            placeholder="Ask about this change"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={question.trim().length === 0 || isAsking}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface disabled:opacity-50"
        >
          <Send aria-hidden="true" className="size-4" />
          Ask
        </button>
      </form>
    </section>
  );
}

function ConversationExchange({
  entry,
  isAsking,
  onRetry,
}: {
  entry: FollowUpEntry;
  isAsking: boolean;
  onRetry: () => void;
}) {
  return (
    <li className="min-w-0 space-y-2">
      <div className="ml-auto min-w-0 w-fit max-w-[85%]">
        <p className="whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-ink px-3 py-2 text-sm text-surface">
          {entry.question}
        </p>
      </div>
      {entry.status === "pending" ? (
        <p
          aria-live="polite"
          className="mr-auto w-fit max-w-[85%] animate-pulse rounded-lg rounded-bl-sm border border-line bg-muted-surface px-3 py-2 text-sm text-muted"
        >
          Answering within the approved teaching scope...
        </p>
      ) : entry.status === "failed" ? (
        <div
          className="mr-auto min-w-0 w-fit max-w-[85%] break-words rounded-lg rounded-bl-sm border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger-ink"
          role="alert"
        >
          <p>Follow-up failed: {entry.errorMessage ?? "the provider did not answer."}</p>
          <button
            type="button"
            disabled={isAsking}
            onClick={onRetry}
            className="mt-2 inline-flex h-7 items-center justify-center rounded-md border border-danger/25 bg-surface px-2 text-xs font-medium text-ink hover:bg-muted-surface disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="mr-auto min-w-0 w-fit max-w-[85%]">
          <p className="whitespace-pre-wrap break-words rounded-lg rounded-bl-sm border border-line bg-muted-surface px-3 py-2 text-sm">
            {entry.answer}
          </p>
          {entry.createdAt === null ? null : (
            <p className="mt-1 px-1 text-[11px] text-muted">{formatDateTime(entry.createdAt)}</p>
          )}
        </div>
      )}
    </li>
  );
}
