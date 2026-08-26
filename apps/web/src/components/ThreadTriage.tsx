import { useState } from "react";
import {
  Ban,
  Check,
  CornerDownRight,
  ExternalLink,
  MessageSquareReply,
  RotateCcw,
} from "lucide-react";

import type {
  ThreadRef,
  ThreadSeverity,
  ThreadStatus,
  ThreadType,
  ThreadWithComments,
} from "@greenroom/schemas";

import { formatDateTime, pluralize } from "../utils";
import { CopyRefButton } from "./CopyRefButton";
import {
  filterThreads,
  severityLabel,
  sourceDisplayName,
  sourceKindLabel,
  statusLabel,
  threadAnchorLabel,
  threadDomId,
  threadFilterOptions,
  typeLabel,
  type ThreadFilter,
} from "./threadTriageUtils";

export interface ThreadComposerValues {
  body: string;
  type: ThreadType;
  severity: ThreadSeverity | null;
}

interface ThreadComposerProps {
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (values: ThreadComposerValues) => void | Promise<void>;
}

const threadTypes: ThreadType[] = ["question", "issue", "suggestion", "note"];
const threadSeverities: (ThreadSeverity | "none")[] = ["none", "blocking", "major", "minor", "nit"];

export function ThreadComposer({ isSubmitting, onCancel, onSubmit }: ThreadComposerProps) {
  const [body, setBody] = useState("");
  const [type, setType] = useState<ThreadType>("question");
  const [severity, setSeverity] = useState<ThreadSeverity | "none">("none");

  const trimmedBody = body.trim();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (trimmedBody.length === 0) {
      return;
    }

    await onSubmit({
      body: trimmedBody,
      type,
      severity: severity === "none" ? null : severity,
    });
    setBody("");
    setType("question");
    setSeverity("none");
  }

  return (
    <form
      className="space-y-3 rounded-md border border-accent/30 bg-surface p-3"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-muted">
          <span>Thread type</span>
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            onChange={(event) => setType(event.target.value as ThreadType)}
            value={type}
          >
            {threadTypes.map((threadType) => (
              <option key={threadType} value={threadType}>
                {typeLabel(threadType)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          <span>Severity</span>
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            onChange={(event) => setSeverity(event.target.value as ThreadSeverity | "none")}
            value={severity}
          >
            {threadSeverities.map((threadSeverity) => (
              <option key={threadSeverity} value={threadSeverity}>
                {threadSeverity === "none" ? "No severity" : severityLabel(threadSeverity)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted">
        <span>Comment</span>
        <textarea
          className="min-h-24 resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add review context"
          value={body}
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-medium text-muted hover:text-ink"
          disabled={isSubmitting}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="inline-flex h-8 items-center rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
          disabled={isSubmitting || trimmedBody.length === 0}
          type="submit"
        >
          Create thread
        </button>
      </div>
    </form>
  );
}

interface InlineThreadCardProps {
  isReplying: boolean;
  isSelected: boolean;
  isTransitioning: boolean;
  onReply: (shortRef: ThreadRef, body: string) => void | Promise<void>;
  onTransition: (shortRef: ThreadRef, status: ThreadStatus) => void | Promise<void>;
  thread: ThreadWithComments;
}

export function InlineThreadCard({
  isReplying,
  isSelected,
  isTransitioning,
  onReply,
  onTransition,
  thread,
}: InlineThreadCardProps) {
  const [replyBody, setReplyBody] = useState("");
  const trimmedReply = replyBody.trim();

  async function handleReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (trimmedReply.length === 0) {
      return;
    }

    await onReply(thread.shortRef, trimmedReply);
    setReplyBody("");
  }

  return (
    <article
      className={`min-w-0 rounded-md border bg-surface p-3 shadow-sm ${
        isSelected ? "border-accent ring-2 ring-accent/25" : "border-line"
      }`}
      id={threadDomId(thread.shortRef)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-accent-ink">
              {thread.shortRef}
            </span>
            <ThreadStatusPill status={thread.status} />
            <ThreadTypePill type={thread.type} />
            <ThreadSeverityPill severity={thread.severity} />
            {thread.outdated ? <Badge tone="warning">Outdated</Badge> : null}
          </div>
          <ThreadSourceBadge thread={thread} />
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyRefButton refValue={thread.shortRef} />
          {thread.status === "open" ? (
            <>
              <button
                aria-label={`Resolve ${thread.shortRef}`}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-success/30 px-2 text-xs font-medium text-success-ink hover:bg-success-soft"
                disabled={isTransitioning}
                onClick={() => void onTransition(thread.shortRef, "resolved")}
                type="button"
              >
                <Check aria-hidden="true" className="size-3.5" />
                Resolve
              </button>
              <button
                aria-label={`Dismiss ${thread.shortRef}`}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-warning/30 px-2 text-xs font-medium text-warning-ink hover:bg-warning-soft"
                disabled={isTransitioning}
                onClick={() => void onTransition(thread.shortRef, "dismissed")}
                type="button"
              >
                <Ban aria-hidden="true" className="size-3.5" />
                Dismiss
              </button>
            </>
          ) : (
            <button
              aria-label={`Reopen ${thread.shortRef}`}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-muted hover:bg-muted-surface hover:text-ink"
              disabled={isTransitioning}
              onClick={() => void onTransition(thread.shortRef, "open")}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reopen
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {thread.comments.map((comment) => (
          <div className="min-w-0 rounded-md bg-muted-surface px-3 py-2" key={comment.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="min-w-0 break-words font-medium text-ink">
                {comment.authorDisplayName}
              </span>
              <span>{sourceKindLabel(comment.authorKind)}</span>
              <span>{formatDateTime(comment.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{comment.body}</p>
          </div>
        ))}
      </div>

      <form className="mt-3 flex flex-col gap-2" onSubmit={handleReply}>
        <label className="sr-only" htmlFor={`reply-${thread.shortRef}`}>
          Reply to {thread.shortRef}
        </label>
        <textarea
          className="min-h-16 resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          id={`reply-${thread.shortRef}`}
          onChange={(event) => setReplyBody(event.target.value)}
          placeholder={`Reply to ${thread.shortRef}`}
          value={replyBody}
        />
        <div className="flex justify-end">
          <button
            aria-label={`Reply to ${thread.shortRef}`}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
            disabled={isReplying || trimmedReply.length === 0}
            type="submit"
          >
            <MessageSquareReply aria-hidden="true" className="size-4" />
            Reply
          </button>
        </div>
      </form>
    </article>
  );
}

interface ThreadPanelProps {
  activeFilters: ThreadFilter[];
  isLoading: boolean;
  onClearFilters: () => void;
  onNavigate: (thread: ThreadWithComments) => void;
  onToggleFilter: (filter: ThreadFilter) => void;
  selectedFilePath: string | null;
  selectedThreadRef: ThreadRef | null;
  threads: ThreadWithComments[];
}

export function ThreadPanel({
  activeFilters,
  isLoading,
  onClearFilters,
  onNavigate,
  onToggleFilter,
  selectedFilePath,
  selectedThreadRef,
  threads,
}: ThreadPanelProps) {
  const filteredThreads = filterThreads(threads, activeFilters, selectedFilePath);

  return (
    <section
      aria-labelledby="thread-panel-heading"
      className="w-full min-w-0 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium" id="thread-panel-heading">
            <MessageSquareReply aria-hidden="true" className="size-4 text-accent-ink" />
            Threads
          </div>
          <p className="mt-1 text-xs text-muted">
            {isLoading ? "Loading" : pluralize(threads.length, "thread")}
          </p>
        </div>
        {activeFilters.length === 0 ? null : (
          <button
            className="text-xs font-medium text-accent-ink hover:underline"
            onClick={onClearFilters}
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {threadFilterOptions.map((option) => {
          const active = activeFilters.includes(option.id);
          const disabled = option.id === "current-file-unresolved" && selectedFilePath === null;

          return (
            <button
              aria-pressed={active}
              className={`h-8 rounded-md border px-2 text-xs font-medium ${
                active
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-muted hover:bg-muted-surface hover:text-ink"
              } disabled:opacity-50`}
              disabled={disabled}
              key={option.id}
              onClick={() => onToggleFilter(option.id)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-4 space-y-3" role="list">
        {filteredThreads.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-muted-surface px-3 py-4 text-sm text-muted">
            {threads.length === 0 ? "No threads yet" : "No threads match these filters"}
          </p>
        ) : (
          filteredThreads.map((thread) => (
            <article
              aria-current={selectedThreadRef === thread.shortRef ? "true" : undefined}
              className={`rounded-md border p-3 ${
                selectedThreadRef === thread.shortRef
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface"
              }`}
              key={thread.shortRef}
              role="listitem"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-accent-ink">
                      {thread.shortRef}
                    </span>
                    <ThreadStatusPill status={thread.status} />
                    {thread.outdated ? <Badge tone="warning">Outdated</Badge> : null}
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-muted">
                    {threadAnchorLabel(thread)}
                  </p>
                  {thread.outdated ? (
                    <p className="mt-1 truncate font-mono text-xs text-warning-ink">
                      Original {thread.anchor.revisionId}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <CopyRefButton refValue={thread.shortRef} compact />
                  <button
                    aria-keyshortcuts="[ ]"
                    aria-label={`Go to ${thread.shortRef}`}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-line text-muted hover:bg-muted-surface hover:text-ink"
                    onClick={() => onNavigate(thread)}
                    title={`Go to ${thread.shortRef} ([/] navigates threads)`}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <ThreadTypePill type={thread.type} />
                <ThreadSeverityPill severity={thread.severity} />
              </div>
              <ThreadSourceBadge thread={thread} compact />
              <p className="mt-2 line-clamp-3 break-words text-sm text-ink">
                {thread.comments[0]?.body}
              </p>
              <p className="mt-2 flex items-center gap-1 text-xs text-muted">
                <CornerDownRight aria-hidden="true" className="size-3.5" />
                {pluralize(thread.comments.length, "comment")}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ThreadStatusPill({ status }: { status: ThreadStatus }) {
  const tone = status === "open" ? "success" : status === "resolved" ? "neutral" : "warning";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function ThreadTypePill({ type }: { type: ThreadType }) {
  return <Badge tone="accent">{typeLabel(type)}</Badge>;
}

function ThreadSeverityPill({ severity }: { severity: ThreadSeverity | null }) {
  if (severity === null) {
    return null;
  }

  return (
    <Badge tone={severity === "blocking" || severity === "major" ? "danger" : "neutral"}>
      {severityLabel(severity)}
    </Badge>
  );
}

function ThreadSourceBadge({
  compact = false,
  thread,
}: {
  compact?: boolean;
  thread: ThreadWithComments;
}) {
  return (
    <p
      className={`${compact ? "mt-2" : ""} flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted`}
    >
      <Badge tone={sourceTone(thread.source.kind)}>{sourceKindLabel(thread.source.kind)}</Badge>
      <span className="min-w-0 max-w-full truncate">{sourceDisplayName(thread.source)}</span>
    </p>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "accent" | "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badgeClassName(tone)}`}
    >
      {children}
    </span>
  );
}

function badgeClassName(tone: "accent" | "danger" | "neutral" | "success" | "warning"): string {
  switch (tone) {
    case "accent":
      return "border-accent/30 bg-accent-soft text-accent-ink";
    case "danger":
      return "border-danger/30 bg-danger-soft text-danger-ink";
    case "success":
      return "border-success/30 bg-success-soft text-success-ink";
    case "warning":
      return "border-warning/30 bg-warning-soft text-warning-ink";
    default:
      return "border-line bg-muted-surface text-muted";
  }
}

function sourceTone(
  kind: ThreadWithComments["source"]["kind"],
): "accent" | "danger" | "neutral" | "success" | "warning" {
  switch (kind) {
    case "mcp_client":
      return "accent";
    case "external_agent":
      return "warning";
    case "teaching":
      return "success";
    case "builtin_reviewer":
      return "danger";
    default:
      return "neutral";
  }
}
