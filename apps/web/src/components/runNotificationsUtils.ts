import type { WorkflowKind, WorkflowRun } from "@greenroom/schemas";

import type { WorkspaceDrawerSection } from "./workspace/workspaceTypes";

export interface RunToastContent {
  kind: "success" | "error" | "info";
  title: string;
  body: string | null;
  showDiagnosticsAction: boolean;
}

const workflowKindLabels: Record<WorkflowKind, string> = {
  builtin_review: "AI review",
  spotlight_plan: "Spotlight plan",
  spotlight_membership: "Spotlight views",
  spotlight_refine: "Spotlight refinement",
  teaching_generate: "Teaching",
  teaching_follow_up: "Teaching follow-up",
  setup_smoke: "Setup smoke",
};

export function workflowRunKindLabel(kind: WorkflowKind): string {
  return workflowKindLabels[kind];
}

/**
 * Runs the header indicator and completion toasts care about. Setup smoke
 * runs are internal connectivity checks whose results render inline in the
 * Settings harness panel, so they are excluded from cross-page notifications.
 */
export function notifiableWorkflowRuns(runs: readonly WorkflowRun[]): WorkflowRun[] {
  return runs.filter((run) => run.workflowKind !== "setup_smoke");
}

/**
 * Where a run reports into, used when a header indicator entry or toast
 * action navigates to the run's review: a workspace drawer section, or the
 * dedicated Teach page for teaching runs.
 */
export type WorkflowRunLocation =
  | { kind: "drawer"; section: WorkspaceDrawerSection }
  | { kind: "teach" };

export function workflowRunLocation(kind: WorkflowKind): WorkflowRunLocation | null {
  switch (kind) {
    case "builtin_review":
      return { kind: "drawer", section: "ai_review" };
    case "spotlight_plan":
    case "spotlight_membership":
    case "spotlight_refine":
      return { kind: "drawer", section: "spotlight" };
    case "teaching_generate":
    case "teaching_follow_up":
      return { kind: "teach" };
    case "setup_smoke":
      return null;
  }
}

/**
 * Run ids that left the active (queued/running/repairing) set between two
 * polls — each one settled somewhere and is a toast candidate.
 */
export function settledRunIds(
  previousActiveIds: readonly string[],
  currentActiveIds: readonly string[],
): string[] {
  const current = new Set(currentActiveIds);

  return previousActiveIds.filter((runId) => !current.has(runId));
}

/**
 * Toast content for a run that just left the active set, or null when no
 * toast should fire: cancellations are user-initiated, and a run that is
 * somehow still active (poll jitter) must not be announced as settled.
 */
export function runCompletionToast(run: WorkflowRun): RunToastContent | null {
  const label = workflowRunKindLabel(run.workflowKind);

  switch (run.status) {
    case "completed":
      return {
        kind: "success",
        title: `${label} run completed`,
        body: null,
        showDiagnosticsAction: false,
      };
    case "awaiting_user":
      return {
        kind: "info",
        title: `${label} run is ready for review`,
        body: "Draft output is validated and awaits your approval.",
        showDiagnosticsAction: false,
      };
    case "failed":
      return {
        kind: "error",
        title: `${label} run failed`,
        body: run.errorMessage,
        showDiagnosticsAction: true,
      };
    default:
      return null;
  }
}
