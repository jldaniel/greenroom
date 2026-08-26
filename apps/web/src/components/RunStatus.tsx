import { Activity, FileCode2, LoaderCircle, RefreshCw, Terminal, XCircle } from "lucide-react";

import type { HarnessStreamEvent, WorkflowRun, WorkflowRunEvent } from "@greenroom/schemas";

import { useWorkflowRunDiagnostics, useWorkflowRunHarnessEvents } from "../api/hooks";
import {
  isWorkflowRunTerminal,
  WorkflowEventTimeline,
  WorkflowRepairStatusNote,
  WorkflowStatusPill,
} from "./WorkflowPanels";

export interface RunStatusAction {
  isPending: boolean;
  onAction: () => void;
}

/**
 * Shared workflow run status: the one component every workflow
 * surface (AI Review, Spotlight, the Teach page) renders for an active or
 * settled run.
 * It shows the status pill with the current step (phase), the queue position
 * while queued, cancel/retry actions, repair-attempt progress, and
 * failure diagnostics including the one-action fingerprint recovery.
 * The raw event timeline sits behind a collapsed Details disclosure.
 */
export function RunStatus({
  cancel,
  emptyEventsLabel = "No workflow events yet.",
  events = [],
  isLoadingEvents = false,
  isRecoveringFingerprint = false,
  onRecoverFingerprint,
  queuePosition = null,
  retry,
  run,
}: {
  cancel?: RunStatusAction;
  emptyEventsLabel?: string;
  events?: readonly WorkflowRunEvent[];
  isLoadingEvents?: boolean;
  isRecoveringFingerprint?: boolean;
  onRecoverFingerprint?: () => void;
  queuePosition?: number | null;
  retry?: RunStatusAction;
  run: WorkflowRun | null;
}) {
  const runId = run?.id ?? null;
  const diagnostics = useWorkflowRunDiagnostics(
    run !== null && run.status === "failed" ? run.id : null,
  );
  const harnessEvents = useWorkflowRunHarnessEvents(
    runId,
    runId !== null,
    run !== null && !isWorkflowRunTerminal(run.status),
  );

  if (run === null) {
    return null;
  }

  const canCancel = cancel !== undefined && !isWorkflowRunTerminal(run.status);
  const canRetry = retry !== undefined && (run.status === "failed" || run.status === "cancelled");
  const failure = diagnostics.data ?? null;
  const activity = liveActivityFromRun(run);
  const bridgeLiveness = bridgeLivenessFromRun(run);
  const repositoryWorkspace = repositoryWorkspaceFromRun(run);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WorkflowStatusPill phase={run.phase} status={run.status} />
        {run.status === "queued" && queuePosition !== null ? (
          <span className="inline-flex items-center rounded-md border border-line bg-muted-surface px-2 py-1 text-xs font-medium text-muted">
            Queue position {queuePosition}
          </span>
        ) : null}
      </div>

      <WorkflowRepairStatusNote run={run} />

      {activity === null ? null : <RunActivityLine activity={activity} />}
      {bridgeLiveness === null ? null : <RunBridgeLivenessLine liveness={bridgeLiveness} />}
      {repositoryWorkspace === null ? null : (
        <RunRepositoryWorkspaceLine workspace={repositoryWorkspace} />
      )}

      {run.errorMessage === null ? null : (
        <p className="break-words rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger-ink">
          {run.errorMessage}
        </p>
      )}

      {failure === null || failure.failureCategory === null ? null : (
        <div className="min-w-0 break-words rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger-ink">
          <p className="min-w-0">
            <span className="font-semibold uppercase tracking-wide">
              {failure.failureCategory.replaceAll("_", " ")}
            </span>{" "}
            — {failure.summary}
          </p>
          {failure.failureCategory === "fingerprint_changed" &&
          onRecoverFingerprint !== undefined ? (
            <button
              className="mt-2 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-muted-surface disabled:opacity-60"
              disabled={isRecoveringFingerprint}
              onClick={onRecoverFingerprint}
              type="button"
            >
              {isRecoveringFingerprint ? (
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-3.5" />
              )}
              Refresh review and retry
            </button>
          ) : null}
          {failure.failingStep === null &&
          failure.exitCode === null &&
          failure.stderrTail === null ? null : (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">Failure details</summary>
              <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {failure.failingStep === null ? null : (
                  <>
                    <dt>Step</dt>
                    <dd className="break-all font-mono">
                      {failure.failingStep.stepId ?? failure.failingStep.phase ?? "unknown"}
                    </dd>
                  </>
                )}
                {failure.exitCode === null ? null : (
                  <>
                    <dt>Exit code</dt>
                    <dd className="font-mono">{failure.exitCode}</dd>
                  </>
                )}
                {failure.stderrTail === null ? null : (
                  <>
                    <dt>Stderr</dt>
                    <dd>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
                        {failure.stderrTail}
                      </pre>
                    </dd>
                  </>
                )}
              </dl>
            </details>
          )}
          {failure.transcripts.length === 0 ? null : (
            <a
              className="mt-2 inline-flex text-xs font-medium text-danger-ink underline underline-offset-2"
              href={failure.transcriptsUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open partial transcript
            </a>
          )}
        </div>
      )}

      {canCancel || canRetry ? (
        <div className="flex flex-wrap gap-2">
          {canCancel ? (
            <button
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
              disabled={cancel.isPending}
              onClick={cancel.onAction}
              type="button"
            >
              {cancel.isPending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <XCircle aria-hidden="true" className="size-4" />
              )}
              Cancel
            </button>
          ) : null}
          {canRetry ? (
            <button
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
              disabled={retry.isPending}
              onClick={retry.onAction}
              type="button"
            >
              {retry.isPending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-4" />
              )}
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <details className="rounded-lg border border-line bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
          Details
        </summary>
        <div className="mt-2">
          <WorkflowEventTimeline
            emptyLabel={emptyEventsLabel}
            events={events}
            isLoading={isLoadingEvents}
          />
          <HarnessEventTimeline
            events={harnessEvents.data?.events ?? []}
            isLoading={harnessEvents.isFetching}
          />
        </div>
      </details>
    </div>
  );
}

interface RunActivity {
  summary: string;
  ageLabel: string;
  completedUnits: number | null;
  totalUnits: number | null;
  phase: string | null;
}

export interface RunBridgeLiveness {
  jobId: string;
  status: string;
  heartbeatAgeLabel: string | null;
  processAgeLabel: string | null;
  cancelRequested: boolean;
}

export interface RunRepositoryWorkspace {
  accessMode: string;
  readScopeLabel: string | null;
  revisionId: string | null;
  baseSha: string | null;
  headSha: string | null;
  workspaceStrategy: string | null;
  workspaceSetupStatus: string | null;
  workspaceCleanupStatus: string | null;
  workspaceErrorMessage: string | null;
}

function RunActivityLine({ activity }: { activity: RunActivity }) {
  const hasProgress =
    activity.completedUnits !== null && activity.totalUnits !== null && activity.totalUnits > 0;
  const progress = hasProgress
    ? Math.max(0, Math.min(100, (activity.completedUnits! / activity.totalUnits!) * 100))
    : 0;

  return (
    <div className="rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <Activity aria-hidden="true" className="size-3.5 shrink-0 text-accent-ink" />
        <span className="min-w-0 flex-1 truncate text-ink">{activity.summary}</span>
        <span className="shrink-0">{activity.ageLabel}</span>
      </div>
      {hasProgress ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate">{activity.phase ?? "Progress"}</span>
            <span className="shrink-0 font-mono">
              {activity.completedUnits}/{activity.totalUnits}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-line">
            <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RunRepositoryWorkspaceLine({ workspace }: { workspace: RunRepositoryWorkspace }) {
  const details = repositoryWorkspaceDetails(workspace);

  return (
    <div className="rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-accent-ink" />
        <span className="min-w-0 flex-1 truncate text-ink">
          {workspace.accessMode === "snapshot_readonly"
            ? "Repository snapshot access"
            : "MCP-only repository access"}
        </span>
        {workspace.headSha === null ? null : (
          <span className="shrink-0 font-mono">{shortSha(workspace.headSha)}</span>
        )}
      </div>
      {details.length === 0 ? null : (
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
          {details.map((detail) => (
            <span className="min-w-0 break-all" key={detail}>
              {detail}
            </span>
          ))}
        </div>
      )}
      {workspace.workspaceErrorMessage === null ? null : (
        <p className="mt-2 break-words text-danger-ink">{workspace.workspaceErrorMessage}</p>
      )}
    </div>
  );
}

function RunBridgeLivenessLine({ liveness }: { liveness: RunBridgeLiveness }) {
  return (
    <div className="rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <Terminal aria-hidden="true" className="size-3.5 shrink-0 text-accent-ink" />
        <span className="min-w-0 flex-1 truncate text-ink">
          Bridge job {liveness.status.replaceAll("_", " ")}
        </span>
        <span className="shrink-0 font-mono">{shortJobId(liveness.jobId)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {liveness.heartbeatAgeLabel === null ? null : (
          <span>Heartbeat {liveness.heartbeatAgeLabel} ago</span>
        )}
        {liveness.processAgeLabel === null ? null : (
          <span>Process seen {liveness.processAgeLabel} ago</span>
        )}
        {liveness.cancelRequested ? <span>Cancel requested</span> : null}
      </div>
    </div>
  );
}

function HarnessEventTimeline({
  events,
  isLoading,
}: {
  events: readonly HarnessStreamEvent[];
  isLoading: boolean;
}) {
  const shown = events.slice(-100);

  return (
    <section className="mt-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal aria-hidden="true" className="size-4 text-accent-ink" />
          Harness events
        </div>
        {isLoading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-md border border-line bg-muted-surface px-3 py-2 text-xs text-muted">
          No harness events yet.
        </p>
      ) : (
        <ol className="mt-3 max-h-96 space-y-2 overflow-auto">
          {shown.map((event) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-line bg-muted-surface px-3 py-2"
              key={event.sequence}
            >
              <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-md border border-line bg-surface text-xs font-medium text-muted">
                {event.sequence}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted">
                    {event.kind.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-ink">{event.summary}</p>
                {event.text === null || event.text.length === 0 ? null : (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-surface p-2 font-mono text-xs text-muted">
                    {event.text}
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function bridgeLivenessFromRun(
  run: Pick<WorkflowRun, "metadata">,
  nowMs = Date.now(),
): RunBridgeLiveness | null {
  const jobId = stringMetadata(run.metadata, "bridgeJobId");
  const status = stringMetadata(run.metadata, "bridgeJobStatus");

  if (jobId === null || status === null) {
    return null;
  }

  const heartbeatAt = stringMetadata(run.metadata, "bridgeHeartbeatAt");
  const processSeenAt = stringMetadata(run.metadata, "harnessProcessLastSeenAt");

  return {
    jobId,
    status,
    heartbeatAgeLabel: heartbeatAt === null ? null : formatAge(nowMs - Date.parse(heartbeatAt)),
    processAgeLabel: processSeenAt === null ? null : formatAge(nowMs - Date.parse(processSeenAt)),
    cancelRequested: stringMetadata(run.metadata, "bridgeCancelRequestedAt") !== null,
  };
}

export function repositoryWorkspaceFromRun(
  run: Pick<WorkflowRun, "metadata">,
): RunRepositoryWorkspace | null {
  const accessMode = stringMetadata(run.metadata, "repositoryAccessMode");

  if (accessMode === null) {
    return null;
  }

  return {
    accessMode,
    readScopeLabel: stringMetadata(run.metadata, "repositoryAccessReadScopeLabel"),
    revisionId: stringMetadata(run.metadata, "repositoryAccessRevisionId"),
    baseSha: stringMetadata(run.metadata, "repositoryAccessBaseSha"),
    headSha: stringMetadata(run.metadata, "repositoryAccessHeadSha"),
    workspaceStrategy:
      stringMetadata(run.metadata, "repositoryAccessWorkspaceStrategy") ??
      stringMetadata(run.metadata, "repositoryWorkspaceStrategy"),
    workspaceSetupStatus: stringMetadata(run.metadata, "workspaceSetupStatus"),
    workspaceCleanupStatus: stringMetadata(run.metadata, "workspaceCleanupStatus"),
    workspaceErrorMessage: stringMetadata(run.metadata, "workspaceErrorMessage"),
  };
}

function liveActivityFromRun(run: WorkflowRun): RunActivity | null {
  const summary = stringMetadata(run.metadata, "lastActivitySummary");
  const at = stringMetadata(run.metadata, "lastActivityAt");

  if (summary === null || at === null) {
    return null;
  }

  return {
    summary,
    ageLabel: `${formatAge(Date.now() - Date.parse(at))} ago`,
    completedUnits: numberMetadata(run.metadata, "progressCompletedUnits"),
    totalUnits: numberMetadata(run.metadata, "progressTotalUnits"),
    phase: stringMetadata(run.metadata, "progressPhase"),
  };
}

function shortJobId(jobId: string): string {
  return jobId.length <= 18 ? jobId : `...${jobId.slice(-12)}`;
}

function repositoryWorkspaceDetails(workspace: RunRepositoryWorkspace): string[] {
  const details: string[] = [];

  if (workspace.readScopeLabel !== null) {
    details.push(workspace.readScopeLabel);
  }

  if (workspace.workspaceStrategy !== null) {
    details.push(`Workspace ${formatMetadataValue(workspace.workspaceStrategy)}`);
  } else if (workspace.accessMode === "mcp_only") {
    details.push("No filesystem workspace");
  }

  if (workspace.revisionId !== null) {
    details.push(`Revision ${workspace.revisionId}`);
  }

  if (
    workspace.workspaceSetupStatus !== null &&
    workspace.workspaceSetupStatus !== "not_required"
  ) {
    details.push(`Setup ${formatMetadataValue(workspace.workspaceSetupStatus)}`);
  }

  if (
    workspace.workspaceCleanupStatus !== null &&
    workspace.workspaceCleanupStatus !== "not_required"
  ) {
    details.push(`Cleanup ${formatMetadataValue(workspace.workspaceCleanupStatus)}`);
  }

  return details;
}

function formatMetadataValue(value: string): string {
  return value.replaceAll("_", " ");
}

function shortSha(sha: string): string {
  return sha.length <= 12 ? sha : sha.slice(0, 12);
}

function stringMetadata(metadata: WorkflowRun["metadata"], key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberMetadata(metadata: WorkflowRun["metadata"], key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.floor(minutes / 60)}h`;
}
