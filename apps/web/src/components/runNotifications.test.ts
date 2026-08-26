import { describe, expect, it } from "vitest";

import type { WorkflowRun } from "@greenroom/schemas";

import {
  notifiableWorkflowRuns,
  runCompletionToast,
  settledRunIds,
  workflowRunLocation,
} from "./runNotificationsUtils";

function run(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    status: "completed",
    errorMessage: null,
    ...overrides,
  } as WorkflowRun;
}

describe("settledRunIds", () => {
  it("returns run ids that left the active set", () => {
    expect(settledRunIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("returns nothing when the active set only grew", () => {
    expect(settledRunIds(["a"], ["a", "b"])).toEqual([]);
    expect(settledRunIds([], ["a"])).toEqual([]);
  });
});

describe("notifiableWorkflowRuns", () => {
  it("excludes internal setup smoke runs", () => {
    const smoke = run({ id: "workflow_run_2", workflowKind: "setup_smoke" });
    const review = run({ id: "workflow_run_3" });

    expect(notifiableWorkflowRuns([smoke, review])).toEqual([review]);
  });
});

describe("workflowRunLocation", () => {
  it("maps every workflow kind to its owning surface", () => {
    expect(workflowRunLocation("builtin_review")).toEqual({
      kind: "drawer",
      section: "ai_review",
    });
    expect(workflowRunLocation("spotlight_plan")).toEqual({ kind: "drawer", section: "spotlight" });
    expect(workflowRunLocation("spotlight_membership")).toEqual({
      kind: "drawer",
      section: "spotlight",
    });
    expect(workflowRunLocation("spotlight_refine")).toEqual({
      kind: "drawer",
      section: "spotlight",
    });
    // Teaching runs report into the dedicated Teach page, not a
    // workspace drawer section.
    expect(workflowRunLocation("teaching_generate")).toEqual({ kind: "teach" });
    expect(workflowRunLocation("teaching_follow_up")).toEqual({ kind: "teach" });
    expect(workflowRunLocation("setup_smoke")).toBeNull();
  });
});

describe("runCompletionToast", () => {
  it("announces completion as success", () => {
    expect(runCompletionToast(run({ status: "completed" }))).toEqual({
      kind: "success",
      title: "AI review run completed",
      body: null,
      showDiagnosticsAction: false,
    });
  });

  it("announces awaiting_user as an approval prompt", () => {
    const toast = runCompletionToast(
      run({ status: "awaiting_user", workflowKind: "spotlight_plan" }),
    );

    expect(toast).toMatchObject({
      kind: "info",
      title: "Spotlight plan run is ready for review",
      showDiagnosticsAction: false,
    });
  });

  it("announces failure with the error message and a diagnostics action", () => {
    const toast = runCompletionToast(
      run({ status: "failed", errorMessage: "Harness bridge is unavailable." }),
    );

    expect(toast).toEqual({
      kind: "error",
      title: "AI review run failed",
      body: "Harness bridge is unavailable.",
      showDiagnosticsAction: true,
    });
  });

  it("stays silent for cancellations and still-active runs", () => {
    expect(runCompletionToast(run({ status: "cancelled" }))).toBeNull();
    expect(runCompletionToast(run({ status: "running" }))).toBeNull();
    expect(runCompletionToast(run({ status: "queued" }))).toBeNull();
  });
});
