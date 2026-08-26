import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";

import type { WorkflowRun, WorkflowRunId } from "@greenroom/schemas";

import { greenroomApi } from "../api/client";
import { useActiveWorkflowRuns } from "../api/hooks";
import {
  notifiableWorkflowRuns,
  runCompletionToast,
  settledRunIds,
  workflowRunKindLabel,
  workflowRunLocation,
} from "./runNotificationsUtils";
import { useToasts } from "./Toast";
import { writeWorkspaceDrawerState } from "./workspace/workspaceUtils";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Jumps to the surface that owns a run: the dedicated Teach page for teaching
 * runs, or the review workspace with the drawer section the run
 * reports into pre-selected (the workspace reads the persisted drawer state
 * on mount, so a failed run's diagnostics are visible on arrival).
 */
function openWorkflowRunLocation(navigate: Navigate, run: WorkflowRun): void {
  const location = workflowRunLocation(run.workflowKind);
  const reviewDisplayId = run.reviewDisplayId;

  if (location?.kind === "teach") {
    void navigate({ to: "/reviews/$reviewId/teach", params: { reviewId: reviewDisplayId } });
    return;
  }

  if (location !== null) {
    writeWorkspaceDrawerState({ open: true, section: location.section });
  }

  void navigate({ to: "/reviews/$reviewId", params: { reviewId: reviewDisplayId } });
}

/**
 * Compact cross-page run indicator for the app header: visible
 * while any AI run is queued or executing, with a dropdown that navigates to
 * the run's review and drawer section.
 */
export function HeaderRunIndicator() {
  const activeRuns = useActiveWorkflowRuns();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const runs = notifiableWorkflowRuns(activeRuns.data ?? []);

  useEffect(() => {
    if (runs.length === 0) {
      setOpen(false);
    }
  }, [runs.length]);

  if (runs.length === 0) {
    return null;
  }

  return (
    <div className="relative" data-testid="header-run-indicator">
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="relative z-40 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent-ink" />
        {runs.length === 1 ? "1 active run" : `${runs.length} active runs`}
      </button>
      {open ? (
        <>
          <button
            aria-hidden="true"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            tabIndex={-1}
            type="button"
          />
          <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
            {runs.map((run) => (
              <button
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted-surface"
                key={run.id}
                onClick={() => {
                  setOpen(false);
                  openWorkflowRunLocation(navigate, run);
                }}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">
                    {workflowRunKindLabel(run.workflowKind)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {headerRunActivityLabel(run)}
                  </span>
                </span>
                <span className="rounded-md border border-line bg-muted-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {run.status.replaceAll("_", " ")}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function headerRunActivityLabel(run: WorkflowRun): string {
  const completed = numberMetadata(run, "progressCompletedUnits");
  const total = numberMetadata(run, "progressTotalUnits");

  if (completed !== null && total !== null && total > 0) {
    return `${completed}/${total} units`;
  }

  const summary = stringMetadata(run, "lastActivitySummary");
  const at = stringMetadata(run, "lastActivityAt");

  if (summary !== null && at !== null) {
    return `${summary} (${formatAge(Date.now() - Date.parse(at))} ago)`;
  }

  return run.phase.replaceAll("_", " ");
}

function stringMetadata(run: WorkflowRun, key: string): string | null {
  const value = run.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberMetadata(run: WorkflowRun, key: string): number | null {
  const value = run.metadata[key];
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

/**
 * Fires a toast when a run leaves the active set: success on
 * completion, info when a draft awaits approval, and a failure toast whose
 * action opens the run's workspace section where RunStatus surfaces the
 * `GET /api/workflow-runs/:runId/diagnostics` result. Runs that start and
 * finish between two polls (e.g. one-click runs that settle within the
 * blocking consent request) are not announced — the initiating surface
 * already shows their outcome.
 */
export function RunCompletionToasts() {
  const pushToast = useToasts();
  const activeRuns = useActiveWorkflowRuns();
  const navigate = useNavigate();
  const previousActiveIdsRef = useRef<readonly string[] | null>(null);
  const notifiedRunIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (activeRuns.data === undefined) {
      return;
    }

    const currentIds = notifiableWorkflowRuns(activeRuns.data).map((run) => run.id);
    const previousIds = previousActiveIdsRef.current;
    previousActiveIdsRef.current = currentIds;

    if (previousIds === null) {
      return;
    }

    const notified = notifiedRunIdsRef.current;

    for (const runId of settledRunIds(previousIds, currentIds)) {
      if (notified.has(runId)) {
        continue;
      }

      notified.add(runId);
      void greenroomApi
        .readWorkflowRun(runId as WorkflowRunId)
        .then((run) => {
          const toast = runCompletionToast(run);

          if (toast === null) {
            // Cancelled, or still active (poll jitter): allow a later
            // disappearance from the active set to re-evaluate the run.
            notified.delete(runId);
            return;
          }

          pushToast({
            kind: toast.kind,
            title: toast.title,
            body: toast.body,
            action: {
              label: toast.showDiagnosticsAction ? "View diagnostics" : "Open review",
              onAction: () => openWorkflowRunLocation(navigate, run),
            },
          });
        })
        .catch(() => {
          notified.delete(runId);
        });
    }
  }, [activeRuns.data, navigate, pushToast]);

  return null;
}
