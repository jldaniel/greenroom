import type { SpotlightRunStatus, WorkflowRun } from "@greenroom/schemas";

export type SpotlightStepId = "scope" | "plan" | "views";

export type SpotlightStepStatus = "complete" | "active" | "upcoming";

export interface SpotlightStep {
  id: SpotlightStepId;
  label: string;
  status: SpotlightStepStatus;
}

const stepDefinitions: readonly { id: SpotlightStepId; label: string }[] = [
  { id: "scope", label: "Scope" },
  { id: "plan", label: "Plan" },
  { id: "views", label: "Views" },
];

/**
 * Maps a Spotlight run onto the plan-approval flow's three steps:
 * Scope (context consent), Plan (outline drafting and approval), and Views
 * (generation). The linked workflow run's status participates because a
 * two-step profile can hold the durable workflow in pending_consent while the
 * Spotlight run record has already been created. Returns null for settled
 * runs — the stepper only renders while a run is in flight.
 */
export function spotlightActiveStep(
  runStatus: SpotlightRunStatus,
  workflowRunStatus: WorkflowRun["status"] | null,
): SpotlightStepId | null {
  if (runStatus === "completed" || runStatus === "failed") {
    return null;
  }

  if (runStatus === "pending_consent" || workflowRunStatus === "pending_consent") {
    return "scope";
  }

  if (
    runStatus === "queued" ||
    runStatus === "planning" ||
    runStatus === "awaiting_plan_approval"
  ) {
    return "plan";
  }

  return "views";
}

/**
 * The three stepper entries with complete/active/upcoming states derived from
 * the active step, or null when no stepper should render.
 */
export function spotlightRunSteps(
  runStatus: SpotlightRunStatus,
  workflowRunStatus: WorkflowRun["status"] | null,
): SpotlightStep[] | null {
  const activeStep = spotlightActiveStep(runStatus, workflowRunStatus);

  if (activeStep === null) {
    return null;
  }

  const activeIndex = stepDefinitions.findIndex((step) => step.id === activeStep);

  return stepDefinitions.map((step, index) => ({
    ...step,
    status: index < activeIndex ? "complete" : index === activeIndex ? "active" : "upcoming",
  }));
}
