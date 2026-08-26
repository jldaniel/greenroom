import type { TeachingRunResult } from "@greenroom/schemas";

import { formatDateTime } from "../../utils";
import { consentScopeLabel } from "./teachingSessionUtils";

/**
 * Consent-summary fallback for teaching runs whose workflow-run consent
 * record is not (yet) available: derives the same scope/size facts from the
 * teaching context pack itself.
 */
export function TeachingConsentSummary({ run }: { run: TeachingRunResult }) {
  const hunkCount = run.context.files.reduce((total, file) => total + file.hunks.length, 0);
  const regionCount = run.context.spotlightRegions.length;
  const omittedRegionCount = run.context.omittedRegions.reduce(
    (total, region) => total + region.anchorCount,
    0,
  );

  return (
    <div className="rounded-lg border border-line bg-muted-surface p-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted">
        <dt>Status</dt>
        <dd className="text-ink">{run.status}</dd>
        <dt>Scope</dt>
        <dd className="truncate text-ink">{consentScopeLabel(run)}</dd>
        {run.context.scope.kind === "spotlight_view" ? (
          <>
            <dt>Health</dt>
            <dd className="text-ink">{run.context.scope.health}</dd>
          </>
        ) : null}
        <dt>Revision</dt>
        <dd className="truncate font-mono text-ink">{run.context.revision.id}</dd>
        <dt>Files</dt>
        <dd className="text-ink">
          {run.context.files.length} files, {hunkCount} hunks
          {run.context.scope.kind === "spotlight_view" ? `, ${regionCount} regions` : ""}
        </dd>
        <dt>Size</dt>
        <dd className="text-ink">~{run.context.approximateTokenCount} tokens</dd>
        <dt>Created</dt>
        <dd className="text-ink">{formatDateTime(run.createdAt)}</dd>
      </dl>
      {run.context.omittedFiles.length === 0 ? null : (
        <p className="mt-2 text-xs text-warning-ink">
          Omitted {run.context.omittedFiles.length} files from the context limit.
        </p>
      )}
      {omittedRegionCount === 0 ? null : (
        <p className="mt-2 text-xs text-warning-ink">
          Omitted {omittedRegionCount} View region anchors from the context limit.
        </p>
      )}
    </div>
  );
}
