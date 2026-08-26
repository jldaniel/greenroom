import { describe, expect, it } from "vitest";

import type { WorkflowRun, WorkflowRunId } from "@greenroom/schemas";

import { workflowRunQueuePosition } from "./workflowRunUtils";

function queuedRun(id: string, queuedAt: string | null, status: WorkflowRun["status"] = "queued") {
  return {
    id: id as WorkflowRunId,
    status,
    queuedAt,
    createdAt: "2026-06-28T11:00:00.000Z",
  } as WorkflowRun;
}

describe("workflowRunQueuePosition", () => {
  const runs = [
    queuedRun("workflow_run_b", "2026-06-28T12:05:00.000Z"),
    queuedRun("workflow_run_a", "2026-06-28T12:00:00.000Z"),
    queuedRun("workflow_run_c", null),
    queuedRun("workflow_run_done", "2026-06-28T11:00:00.000Z", "completed"),
  ];

  it("returns the 1-based position ordered by queue time", () => {
    expect(workflowRunQueuePosition(runs, "workflow_run_a" as WorkflowRunId)).toBe(2);
    expect(workflowRunQueuePosition(runs, "workflow_run_b" as WorkflowRunId)).toBe(3);
  });

  it("falls back to createdAt when queuedAt is missing", () => {
    expect(workflowRunQueuePosition(runs, "workflow_run_c" as WorkflowRunId)).toBe(1);
  });

  it("ignores runs that are not queued", () => {
    expect(workflowRunQueuePosition(runs, "workflow_run_done" as WorkflowRunId)).toBeNull();
  });

  it("returns null for unknown or missing run ids", () => {
    expect(workflowRunQueuePosition(runs, null)).toBeNull();
    expect(workflowRunQueuePosition(runs, "workflow_run_x" as WorkflowRunId)).toBeNull();
  });
});
