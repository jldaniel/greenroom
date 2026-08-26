import {
  Bot,
  CheckCircle2,
  CircleDot,
  FileCode2,
  ListChecks,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import {
  workflowDefaultRepositoryAccessSummary,
  workflowRunRepairProgressFromMetadata,
  type ThreadRef,
  type WorkflowBuiltinReviewDraftOutput,
  type WorkflowConsentSummary,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowRunPhase,
  type WorkflowRunStatus,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";

import { formatDateTime } from "../utils";

export function WorkflowProfileHarnessBadge({
  consent,
}: {
  consent: WorkflowConsentSummary | null;
}) {
  if (consent === null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-muted-surface px-2 py-1 font-medium text-muted">
        <Bot aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{consent.profile.name}</span>
      </span>
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-muted-surface px-2 py-1 font-medium text-muted">
        <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">
          {consent.selectedHarness} / {consent.profile.model}
        </span>
      </span>
    </div>
  );
}

export function WorkflowStatusPill({
  phase,
  status,
}: {
  phase?: WorkflowRunPhase | null;
  status: WorkflowRunStatus;
}) {
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed" || status === "cancelled"
        ? TriangleAlert
        : isWorkflowRunActive(status)
          ? LoaderCircle
          : CircleDot;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${workflowStatusClassName(
        status,
      )}`}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 ${isWorkflowRunActive(status) ? "animate-spin" : ""}`}
      />
      {workflowStatusLabel(status)}
      {phase === undefined || phase === null || phase === status ? null : (
        <span className="text-current opacity-70">({phase.replaceAll("_", " ")})</span>
      )}
    </span>
  );
}

/**
 * "Repair attempt N of M" note. Rendered next to the run status pill
 * whenever the orchestrator has recorded repair progress in the run metadata;
 * the issue codes that triggered each repair sit in a collapsed details list.
 */
export function WorkflowRepairStatusNote({
  run,
}: {
  run: Pick<WorkflowRun, "metadata" | "status">;
}) {
  const progress = workflowRunRepairProgressFromMetadata(run.metadata);

  if (progress === null) {
    return null;
  }

  const label = isWorkflowRunTerminal(run.status)
    ? `Repair attempts used: ${progress.attemptNumber} of ${progress.maxAttempts}`
    : `Repairing output — attempt ${progress.attemptNumber} of ${progress.maxAttempts}`;

  return (
    <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
      <div className="flex items-center gap-1.5 font-medium">
        <Wrench aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </div>
      {progress.attempts.length === 0 ? null : (
        <details className="mt-1">
          <summary className="cursor-pointer">Issue codes</summary>
          <ul className="mt-1 space-y-0.5">
            {progress.attempts.map((attempt) => (
              <li className="break-all font-mono" key={attempt.attemptNumber}>
                Attempt {attempt.attemptNumber}:{" "}
                {attempt.issueCodes.length === 0 ? "none recorded" : attempt.issueCodes.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function WorkflowConsentSummaryPanel({
  compact = false,
  consent,
}: {
  compact?: boolean;
  consent: WorkflowConsentSummary;
}) {
  const changedFiles = consent.changedFiles;
  // Runs persisted before repository access summaries existed reach the client
  // without the schema default, so fall back rather than crash the panel.
  const repositoryAccess = consent.repositoryAccess ?? workflowDefaultRepositoryAccessSummary;
  const shownResources = compact
    ? consent.expectedMcpResources.slice(0, 4)
    : consent.expectedMcpResources;
  const omittedResourceCount = consent.expectedMcpResources.length - shownResources.length;

  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck aria-hidden="true" className="size-4 text-accent-ink" />
            Allowed inspection
          </div>
          <p className="mt-1 break-words text-xs text-muted">{consent.scopeLabel}</p>
        </div>
        <WorkflowProfileHarnessBadge consent={consent} />
      </div>

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted">
        <dt>Review</dt>
        <dd className="truncate text-ink">{consent.reviewDisplayId}</dd>
        <dt>Revision</dt>
        <dd className="truncate font-mono text-ink">{consent.revisionId}</dd>
        <dt>Files</dt>
        <dd className="text-ink">
          {changedFiles.fileCount} files, {changedFiles.additions} additions,{" "}
          {changedFiles.deletions} deletions
          {changedFiles.omittedFileCount > 0 ? `, ${changedFiles.omittedFileCount} omitted` : ""}
        </dd>
        <dt>Output</dt>
        <dd className="text-ink">{consent.expectedOutputMode.replaceAll("_", " ")}</dd>
        <dt>Repository</dt>
        <dd className="text-ink">
          {repositoryAccess.readScopeLabel}
          {repositoryAccess.mode === "snapshot_readonly" ? (
            <span className="block truncate font-mono text-muted">
              {repositoryAccess.headSha}
              {repositoryAccess.workspaceStrategy === null
                ? ""
                : ` / ${repositoryAccess.workspaceStrategy.replaceAll("_", " ")}`}
            </span>
          ) : null}
        </dd>
        <dt>Gate</dt>
        <dd className="text-ink">
          {consent.threadCreationGate === null
            ? "No thread creation gate"
            : consent.threadCreationGate.mode.replaceAll("_", " ")}
        </dd>
      </dl>

      {consent.threadCreationGate === null ? null : (
        <p className="mt-2 break-words rounded-md border border-line bg-muted-surface px-2 py-1.5 text-xs text-muted">
          {consent.threadCreationGate.reason}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {consent.allowedMcpCapabilities.map((capability) => (
            <span
              className="max-w-full break-all rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink"
              key={capability}
            >
              {capability}
            </span>
          ))}
        </div>

        {shownResources.length === 0 ? null : (
          <details className="rounded-md border border-line bg-muted-surface px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted">
              MCP resources ({consent.expectedMcpResources.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {shownResources.map((resource) => (
                <li className="break-all font-mono text-ink" key={resource}>
                  {resource}
                </li>
              ))}
            </ul>
            {omittedResourceCount > 0 ? (
              <p className="mt-2 text-muted">{omittedResourceCount} more resources hidden.</p>
            ) : null}
          </details>
        )}
      </div>

      {compact || changedFiles.files.length === 0 ? null : (
        <details className="mt-3 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted">
            Changed file manifest ({changedFiles.files.length})
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {changedFiles.files.map((file) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" key={file.path}>
                <span className="truncate font-mono text-ink">{file.path}</span>
                <span className="text-muted">
                  +{file.additions} -{file.deletions}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function WorkflowEventTimeline({
  emptyLabel = "No workflow events yet.",
  events,
  isLoading = false,
}: {
  emptyLabel?: string;
  events: readonly WorkflowRunEvent[];
  isLoading?: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListChecks aria-hidden="true" className="size-4 text-accent-ink" />
          Workflow events
        </div>
        {isLoading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {events.map((event) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-line bg-muted-surface px-3 py-2"
              key={event.id}
            >
              <span
                className={`mt-0.5 inline-flex size-6 items-center justify-center rounded-md border text-xs font-medium ${workflowEventSeverityClassName(
                  event.severity,
                )}`}
              >
                {event.sequenceNumber}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted">
                    {event.eventType.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(event.timestamp)}</span>
                </div>
                <p className="mt-1 break-words text-sm text-ink">{event.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function WorkflowValidationIssueList({
  issues,
}: {
  issues: readonly WorkflowValidationIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }

  const hasError = issues.some((issue) => issue.severity === "error");

  return (
    <section
      className={`rounded-lg border p-3 ${
        hasError ? "border-danger/30 bg-danger-soft" : "border-warning/30 bg-warning-soft"
      }`}
    >
      <div
        className={`flex items-center gap-2 text-sm font-medium ${
          hasError ? "text-danger-ink" : "text-warning-ink"
        }`}
      >
        <TriangleAlert aria-hidden="true" className="size-4" />
        Validation issues
      </div>
      <ul className="mt-3 space-y-2">
        {issues.map((issue, index) => (
          <li className="rounded-md border border-line/60 bg-surface/70 px-3 py-2" key={index}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-line bg-muted-surface px-2 py-0.5 text-xs font-medium text-muted">
                {issue.severity}
              </span>
              <span className="max-w-full break-all font-mono text-xs text-muted">
                {issue.code}
              </span>
              {issue.path.length === 0 ? null : (
                <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted">
                  {issue.path.join(".")}
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-sm text-ink">{issue.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkflowDraftFindingsPanel({
  canApprove = false,
  createdThreadRefs = [],
  draft,
  isApproving = false,
  onApproveAll,
}: {
  canApprove?: boolean;
  createdThreadRefs?: readonly ThreadRef[];
  draft: WorkflowBuiltinReviewDraftOutput;
  isApproving?: boolean;
  onApproveAll?: () => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileCode2 aria-hidden="true" className="size-4 text-accent-ink" />
            Draft findings
          </div>
          <p className="mt-1 text-xs text-muted">
            {draft.findings.length} findings, {draft.nonFindings.length} non-findings
          </p>
        </div>
        {onApproveAll === undefined ? null : (
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-surface disabled:opacity-60"
            disabled={!canApprove || isApproving}
            onClick={onApproveAll}
            type="button"
          >
            {isApproving ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 aria-hidden="true" className="size-4" />
            )}
            Approve all
          </button>
        )}
      </div>

      <p className="mt-3 break-words rounded-md border border-line bg-muted-surface px-3 py-2 text-sm">
        {draft.summary}
      </p>

      {createdThreadRefs.length === 0 ? null : (
        <p className="mt-3 break-all text-xs text-success-ink">
          Created threads: {createdThreadRefs.join(", ")}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {draft.findings.map((finding) => (
          <article className="rounded-md border border-line bg-muted-surface p-3" key={finding.id}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-ink">{finding.title}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">
                  {finding.anchorKey}
                  {finding.anchorKeys === undefined || finding.anchorKeys.length <= 1
                    ? ""
                    : ` +${finding.anchorKeys.length - 1} anchors`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {finding.type}
                </span>
                <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {finding.severity ?? "no severity"}
                </span>
                <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {Math.round(finding.confidence * 100)}%
                </span>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{finding.body}</p>
          </article>
        ))}
      </div>

      {draft.nonFindings.length === 0 ? null : (
        <details className="mt-3 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted">Non-findings</summary>
          <ul className="mt-2 list-inside list-disc space-y-1 text-ink">
            {draft.nonFindings.map((item, index) => (
              <li className="break-words" key={`${item}-${index}`}>
                {item}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isWorkflowRunActive(status: WorkflowRunStatus): boolean {
  return status === "queued" || status === "running" || status === "repairing";
}

function workflowStatusLabel(status: WorkflowRunStatus): string {
  return status.replaceAll("_", " ");
}

function workflowStatusClassName(status: WorkflowRunStatus): string {
  if (status === "completed") {
    return "border-success/30 bg-success-soft text-success-ink";
  }

  if (status === "failed" || status === "cancelled") {
    return "border-danger/30 bg-danger-soft text-danger-ink";
  }

  if (status === "awaiting_user" || status === "pending_consent") {
    return "border-warning/30 bg-warning-soft text-warning-ink";
  }

  return "border-line bg-muted-surface text-muted";
}

function workflowEventSeverityClassName(severity: WorkflowRunEvent["severity"]): string {
  switch (severity) {
    case "error":
      return "border-danger/30 bg-danger-soft text-danger-ink";
    case "warning":
      return "border-warning/30 bg-warning-soft text-warning-ink";
    case "debug":
      return "border-line bg-surface text-muted";
    case "info":
      return "border-accent/30 bg-accent-soft text-accent-ink";
  }
}
