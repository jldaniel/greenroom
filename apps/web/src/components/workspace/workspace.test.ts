import { describe, expect, it } from "vitest";

import type { WorkflowRun } from "@greenroom/schemas";

import {
  workspaceShortcutActionForKey,
  workspaceShortcutBindings,
  workspaceShortcutReference,
} from "./workspaceShortcuts";
import {
  buildWorkspaceStatus,
  claimCompletedSpotlightWorkflowRefresh,
  defaultWorkspaceDrawerState,
  parseWorkspaceDrawerState,
  resumableBuiltinReviewRunId,
  resumableSpotlightRunId,
  resumableWorkflowRun,
  spotlightViewSelectionIsStale,
} from "./workspaceUtils";

describe("parseWorkspaceDrawerState", () => {
  it("defaults to an open Threads drawer", () => {
    expect(defaultWorkspaceDrawerState).toEqual({ open: true, section: "threads" });
    expect(parseWorkspaceDrawerState(null)).toEqual(defaultWorkspaceDrawerState);
  });

  it("round-trips a valid persisted state", () => {
    expect(
      parseWorkspaceDrawerState(JSON.stringify({ open: false, section: "spotlight" })),
    ).toEqual({ open: false, section: "spotlight" });
  });

  it("falls back on malformed JSON", () => {
    expect(parseWorkspaceDrawerState("{not json")).toEqual(defaultWorkspaceDrawerState);
    expect(parseWorkspaceDrawerState("42")).toEqual(defaultWorkspaceDrawerState);
  });

  it("falls back on unknown sections or wrong shapes", () => {
    expect(parseWorkspaceDrawerState(JSON.stringify({ open: true, section: "diff" }))).toEqual(
      defaultWorkspaceDrawerState,
    );
    expect(parseWorkspaceDrawerState(JSON.stringify({ open: "yes", section: "threads" }))).toEqual(
      defaultWorkspaceDrawerState,
    );
  });

  it("degrades an unknown persisted section to the default", () => {
    // A stored section that is not a current drawer section (for example a
    // hand-edited or stale value) must not break the workspace.
    expect(parseWorkspaceDrawerState(JSON.stringify({ open: true, section: "teach" }))).toEqual(
      defaultWorkspaceDrawerState,
    );
  });
});

describe("workspaceShortcuts", () => {
  it("keeps the overlay reference and the key bindings in sync", () => {
    // The `?` overlay must document exactly the shortcuts the hook handles:
    // every bound action appears in the reference and vice versa.
    const boundActions = new Set(Object.values(workspaceShortcutBindings));
    const documentedActions = workspaceShortcutReference.flatMap((group) =>
      group.items.map((item) => item.action),
    );

    expect(new Set(documentedActions)).toEqual(boundActions);
    // No action is documented twice.
    expect(documentedActions.length).toBe(new Set(documentedActions).size);
  });

  it("resolves keys case-insensitively and rejects unbound keys", () => {
    expect(workspaceShortcutActionForKey("J")).toBe("next_file");
    expect(workspaceShortcutActionForKey("Escape")).toBe("clear_composer");
    expect(workspaceShortcutActionForKey("?")).toBe("show_shortcuts");
    expect(workspaceShortcutActionForKey("x")).toBeNull();
  });
});

describe("buildWorkspaceStatus", () => {
  const base = {
    isLoading: false,
    isRefreshing: false,
    isSavingThread: false,
    sectionLabel: "Threads",
    selectedFilePath: "src/index.ts",
    visibleThreadCount: 2,
  };

  it("prioritizes loading, refreshing, then saving", () => {
    expect(buildWorkspaceStatus({ ...base, isLoading: true })).toBe("Loading review workspace");
    expect(buildWorkspaceStatus({ ...base, isRefreshing: true })).toBe("Refreshing review");
    expect(buildWorkspaceStatus({ ...base, isSavingThread: true })).toBe("Saving thread changes");
  });

  it("describes the active section, file, and thread count", () => {
    expect(buildWorkspaceStatus(base)).toBe("Threads. src/index.ts. 2 visible threads.");
    expect(buildWorkspaceStatus({ ...base, selectedFilePath: null })).toBe(
      "Threads. No file selected. 2 visible threads.",
    );
  });
});

describe("spotlightViewSelectionIsStale", () => {
  it("flags selected view refs that no longer exist after views refresh", () => {
    expect(
      spotlightViewSelectionIsStale({ kind: "view", viewRef: "SV-1" }, [{ displayRef: "SV-2" }]),
    ).toBe(true);
    expect(
      spotlightViewSelectionIsStale({ kind: "view", viewRef: "SV-2" }, [{ displayRef: "SV-2" }]),
    ).toBe(false);
  });

  it("keeps coverage and empty selection active states from being treated as stale views", () => {
    expect(spotlightViewSelectionIsStale({ kind: "coverage" }, [])).toBe(false);
    expect(spotlightViewSelectionIsStale(null, [])).toBe(false);
  });
});

describe("claimCompletedSpotlightWorkflowRefresh", () => {
  it("claims a completed workflow exactly once", () => {
    const refreshed = new Set<string>();

    expect(
      claimCompletedSpotlightWorkflowRefresh(
        { id: "workflow_run_1", status: "completed" },
        refreshed,
      ),
    ).toBe(true);
    expect(
      claimCompletedSpotlightWorkflowRefresh(
        { id: "workflow_run_1", status: "completed" },
        refreshed,
      ),
    ).toBe(false);
    expect([...refreshed]).toEqual(["workflow_run_1"]);
  });

  it("does not claim active or missing workflow runs", () => {
    const refreshed = new Set<string>();

    expect(claimCompletedSpotlightWorkflowRefresh(null, refreshed)).toBe(false);
    expect(
      claimCompletedSpotlightWorkflowRefresh(
        { id: "workflow_run_1", status: "running" },
        refreshed,
      ),
    ).toBe(false);
    expect(refreshed.size).toBe(0);
  });
});

function workflowRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    status: "running",
    updatedAt: "2026-07-01T10:00:00.000Z",
    metadata: {},
    ...overrides,
  } as WorkflowRun;
}

describe("resumableWorkflowRun", () => {
  it("picks the most recently updated non-terminal run of a matching kind", () => {
    const older = workflowRun({ id: "workflow_run_old", updatedAt: "2026-07-01T09:00:00.000Z" });
    const newer = workflowRun({
      id: "workflow_run_new",
      status: "queued",
      updatedAt: "2026-07-01T11:00:00.000Z",
    });

    expect(resumableWorkflowRun([older, newer], ["builtin_review"])).toBe(newer);
    expect(resumableWorkflowRun([newer, older], ["builtin_review"])).toBe(newer);
  });

  it("never resurrects terminal runs", () => {
    const runs = [
      workflowRun({ id: "workflow_run_done", status: "completed" }),
      workflowRun({ id: "workflow_run_failed", status: "failed" }),
      workflowRun({ id: "workflow_run_cancelled", status: "cancelled" }),
    ];

    expect(resumableWorkflowRun(runs, ["builtin_review"])).toBeNull();
  });

  it("resumes pending_consent, awaiting_user, and repairing runs", () => {
    for (const status of ["pending_consent", "awaiting_user", "repairing", "queued"] as const) {
      expect(resumableWorkflowRun([workflowRun({ status })], ["builtin_review"])?.status).toBe(
        status,
      );
    }
  });

  it("ignores runs of other workflow kinds", () => {
    const spotlight = workflowRun({ workflowKind: "spotlight_plan" });

    expect(resumableWorkflowRun([spotlight], ["builtin_review"])).toBeNull();
    expect(resumableWorkflowRun([spotlight], ["spotlight_plan"])).toBe(spotlight);
  });

  it("breaks updatedAt ties deterministically by run id", () => {
    const a = workflowRun({ id: "workflow_run_a" });
    const b = workflowRun({ id: "workflow_run_b" });

    expect(resumableWorkflowRun([a, b], ["builtin_review"])).toBe(b);
    expect(resumableWorkflowRun([b, a], ["builtin_review"])).toBe(b);
  });
});

describe("resumableBuiltinReviewRunId", () => {
  it("seeds the active built-in review run id from the workflow-run list", () => {
    const runs = [
      workflowRun({ id: "workflow_run_done", status: "completed" }),
      workflowRun({ id: "workflow_run_active", status: "running" }),
      workflowRun({ id: "workflow_run_other", workflowKind: "spotlight_plan" }),
    ];

    expect(resumableBuiltinReviewRunId(runs)).toBe("workflow_run_active");
  });

  it("returns null when the review has no resumable built-in review run", () => {
    expect(resumableBuiltinReviewRunId([])).toBeNull();
    expect(
      resumableBuiltinReviewRunId([workflowRun({ id: "workflow_run_done", status: "failed" })]),
    ).toBeNull();
  });
});

describe("resumableSpotlightRunId", () => {
  it("seeds the linked spotlight run id from spotlight workflow runs", () => {
    const runs = [
      workflowRun({
        id: "workflow_run_plan",
        workflowKind: "spotlight_plan",
        status: "pending_consent",
        metadata: { spotlightRunId: "spotlight_run_1" },
      }),
    ];

    expect(resumableSpotlightRunId(runs)).toBe("spotlight_run_1");
  });

  it("prefers the most recently updated non-terminal spotlight run across kinds", () => {
    const runs = [
      workflowRun({
        id: "workflow_run_plan",
        workflowKind: "spotlight_plan",
        status: "completed",
        updatedAt: "2026-07-01T12:00:00.000Z",
        metadata: { spotlightRunId: "spotlight_run_done" },
      }),
      workflowRun({
        id: "workflow_run_membership",
        workflowKind: "spotlight_membership",
        status: "running",
        updatedAt: "2026-07-01T11:00:00.000Z",
        metadata: { spotlightRunId: "spotlight_run_active" },
      }),
      workflowRun({
        id: "workflow_run_refine",
        workflowKind: "spotlight_refine",
        status: "queued",
        updatedAt: "2026-07-01T10:00:00.000Z",
        metadata: { spotlightRunId: "spotlight_run_older" },
      }),
    ];

    expect(resumableSpotlightRunId(runs)).toBe("spotlight_run_active");
  });

  it("skips runs without a well-formed spotlight link and non-spotlight kinds", () => {
    const runs = [
      workflowRun({ id: "workflow_run_review", workflowKind: "builtin_review" }),
      workflowRun({
        id: "workflow_run_unlinked",
        workflowKind: "spotlight_plan",
        metadata: {},
      }),
      workflowRun({
        id: "workflow_run_malformed",
        workflowKind: "spotlight_plan",
        metadata: { spotlightRunId: "not-a-spotlight-id" },
      }),
    ];

    expect(resumableSpotlightRunId(runs)).toBeNull();
  });
});
