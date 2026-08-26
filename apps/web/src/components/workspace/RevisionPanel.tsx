import { PanelRight, RefreshCw } from "lucide-react";

import type { RevisionId, RevisionSnapshot } from "@greenroom/schemas";

import { compactSha, formatDateTime } from "../../utils";
import { revisionOptionLabel, revisionOriginLabel } from "./revisionLabels";

/**
 * Revision snapshot selector and refresh affordance. Lives at the bottom of
 * the workspace drawer so revision selection stays reachable from every
 * section; the R shortcut refreshes regardless of drawer state. Selector
 * options use human labels ("Rev 3 · 2h ago · worktree change").
 */
export function RevisionPanel({
  currentRevisionId,
  isRefreshing,
  onRefresh,
  onSelectRevision,
  revision,
  revisions,
  selectedRevisionIsCurrent,
}: {
  currentRevisionId: RevisionId | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSelectRevision: (revisionId: RevisionId) => void;
  revision: RevisionSnapshot | undefined;
  revisions: readonly RevisionSnapshot[] | undefined;
  selectedRevisionIsCurrent: boolean;
}) {
  const nowMs = Date.now();

  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <PanelRight aria-hidden="true" className="size-4 text-accent-ink" />
          Revision
        </div>
        <button
          aria-keyshortcuts="R"
          aria-label="Refresh review"
          className="inline-flex size-8 items-center justify-center rounded-md border border-line text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
          disabled={isRefreshing}
          onClick={onRefresh}
          title="Refresh review (R)"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <label className="mt-3 grid min-w-0 gap-1 text-xs font-medium text-muted">
        <span>Snapshot</span>
        <select
          className="h-9 min-w-0 max-w-full truncate rounded-md border border-line bg-surface px-2 text-sm text-ink"
          onChange={(event) => onSelectRevision(event.target.value as RevisionId)}
          value={revision?.id ?? currentRevisionId ?? ""}
        >
          {revisions?.map((candidate, index) => (
            <option key={candidate.id} value={candidate.id}>
              {revisionOptionLabel({
                isCurrent: candidate.id === currentRevisionId,
                isLatest: index === 0,
                nowMs,
                revision: candidate,
                revisionNumber: revisions.length - index,
              })}
            </option>
          ))}
        </select>
      </label>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted">
        <dt>ID</dt>
        <dd className="truncate font-mono text-ink">{revision?.id ?? "None"}</dd>
        <dt>Origin</dt>
        <dd className="text-ink">
          {revision === undefined ? "None" : revisionOriginLabel(revision)}
        </dd>
        <dt>State</dt>
        <dd className="text-ink">{selectedRevisionIsCurrent ? "Current" : "Historical"}</dd>
        <dt>Created</dt>
        <dd className="text-ink">{formatDateTime(revision?.createdAt)}</dd>
        <dt>Worktree</dt>
        <dd className="truncate font-mono text-ink">
          {revision?.worktreeFingerprint === null || revision?.worktreeFingerprint === undefined
            ? "None"
            : compactSha(revision.worktreeFingerprint.headSha)}
        </dd>
      </dl>
    </section>
  );
}
