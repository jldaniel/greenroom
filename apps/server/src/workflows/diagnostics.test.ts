import { describe, expect, it } from "vitest";

import {
  workflowRunEventSchema,
  workflowRunSchema,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";

import { workflowRunTranscriptSchema, type WorkflowRunTranscript } from "../storage/transcripts";
import { deriveWorkflowRunDiagnostics } from "./diagnostics";

const fixedNow = "2026-06-25T12:00:00.000Z";

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return workflowRunSchema.parse({
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_1",
    harnessKind: "claude-code",
    status: "failed",
    phase: "failed",
    consentSummary: {
      workflowKind: "builtin_review",
      selectedHarness: "claude-code",
      profile: {
        id: "profile_1",
        name: "Reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
      },
      reviewDisplayId: "GR-1",
      revisionId: "revision_1",
      scopeLabel: "1 changed file",
      changedFiles: {
        fileCount: 1,
        additions: 1,
        deletions: 0,
        binaryFileCount: 0,
        renameCount: 0,
        files: [],
        omittedFileCount: 0,
      },
      expectedOutputMode: "builtin_review_findings",
    },
    approvedScope: null,
    draftOutput: null,
    finalOutput: null,
    validationIssues: [],
    errorMessage: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    queuedAt: fixedNow,
    startedAt: fixedNow,
    finishedAt: fixedNow,
    completedAt: null,
    cancelledAt: null,
    metadata: {},
    ...overrides,
  });
}

let eventSequence = 0;

function buildEvent(overrides: Partial<WorkflowRunEvent> = {}): WorkflowRunEvent {
  eventSequence += 1;

  return workflowRunEventSchema.parse({
    id: `workflow_event_${eventSequence}`,
    runId: "workflow_run_1",
    reviewDisplayId: "GR-1",
    sequenceNumber: eventSequence,
    eventType: "lifecycle",
    summary: "Workflow event.",
    severity: "info",
    timestamp: fixedNow,
    metadata: {},
    ...overrides,
  });
}

function buildTranscript(overrides: Partial<WorkflowRunTranscript> = {}): WorkflowRunTranscript {
  return workflowRunTranscriptSchema.parse({
    id: "workflow_transcript_1",
    runId: "workflow_run_1",
    profileId: "profile_1",
    workflowKind: "builtin_review",
    attempt: 0,
    status: "failed",
    exitCode: 1,
    prompt: "Review the approved diff scope.",
    output: null,
    stderr: "",
    redacted: true,
    truncated: false,
    promptBytes: 31,
    outputBytes: 0,
    stderrBytes: 0,
    totalBytes: 31,
    createdAt: fixedNow,
    ...overrides,
  });
}

function blockingIssue(code: string): WorkflowValidationIssue {
  return {
    code,
    message: `Issue ${code}.`,
    severity: "error",
    path: [],
    recoverable: true,
    metadata: {},
  };
}

describe("deriveWorkflowRunDiagnostics", () => {
  it("returns a null failure category for successful runs", () => {
    const run = buildRun({
      status: "completed",
      phase: "completed",
      completedAt: fixedNow,
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [buildEvent({ eventType: "persistence", summary: "Workflow run completed." })],
      transcripts: [buildTranscript({ status: "completed", exitCode: 0 })],
      currentRevisionId: "revision_1",
    });

    expect(diagnostics).toMatchObject({
      runId: run.id,
      status: "completed",
      failureCategory: null,
      summary: "Workflow run completed successfully.",
      errorMessage: null,
      failingStep: null,
      exitCode: 0,
      stderrTail: null,
      validationIssues: [],
      repairAttempts: [],
      fingerprint: {
        changed: false,
        consentedRevisionId: "revision_1",
        currentRevisionId: "revision_1",
      },
      timeoutMs: null,
      transcriptsUrl: `/api/workflow-runs/${run.id}/transcripts`,
    });
    expect(diagnostics.transcripts).toHaveLength(1);
    expect(diagnostics.transcripts[0]).not.toHaveProperty("stderr");
  });

  it("classifies orchestrator timeout budget failures as timeout", () => {
    const run = buildRun({
      errorMessage:
        "Workflow timed out after 600000ms during step builtin-review.launch-harness while in phase launching_harness. Check workflow events for the current step.",
      metadata: { currentStepId: "builtin-review.launch-harness", timeoutBudgetMs: 600000 },
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "harness_launch",
          summary: "Step started: Launch MCP-first built-in review harness.",
          metadata: {
            stepId: "builtin-review.launch-harness",
            phase: "launching_harness",
            status: "running",
          },
        }),
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
          metadata: {
            timeoutMs: 600000,
            currentStepId: "builtin-review.launch-harness",
            phase: "launching_harness",
          },
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("timeout");
    expect(diagnostics.timeoutMs).toBe(600000);
    expect(diagnostics.timeoutBudgetMs).toBe(600000);
    expect(diagnostics.failingStep).toEqual({
      stepId: "builtin-review.launch-harness",
      phase: "launching_harness",
    });
    expect(diagnostics.summary).toContain("timeout budget of 600000ms");
  });

  it("classifies bridge-side harness timeouts as timeout", () => {
    const run = buildRun({
      errorMessage:
        "Harness command timed out after 180000ms; command=claude -p [prompt]; exitCode=null; durationMs=180500; timeoutMs=180000; timeoutBudgetMs=600000; timeoutClamped=false; timedOut=true; repositoryChanged=false",
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("timeout");
    expect(diagnostics.timeoutMs).toBe(180000);
    expect(diagnostics.fingerprint.changed).toBe(false);
  });

  it("classifies bridge process liveness loss separately from bridge availability", () => {
    const run = buildRun({
      errorMessage: "Harness bridge run finished without a result. Last process seen 120000ms ago.",
      metadata: {
        bridgeJobId: "harness_job_1",
        bridgeJobStatus: "running",
        harnessProcessLastSeenAt: "2026-06-25T12:00:00.000Z",
      },
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("process_lost");
    expect(diagnostics.summary).toContain("stopped reporting liveness");
  });

  it("classifies workspace setup failures and includes redacted repository access metadata", () => {
    const run = buildRun({
      errorMessage:
        "Workspace setup failed: repository snapshot access is disabled or unsupported by this bridge. token=grt_test_secret_value",
      metadata: {
        repositoryAccessMode: "snapshot_readonly",
        repositoryAccessReadScopeLabel:
          "Tracked repository files at the approved commit may be read.",
        repositoryAccessRevisionId: "revision_1",
        repositoryAccessBaseSha: "a".repeat(40),
        repositoryAccessHeadSha: "b".repeat(40),
        repositoryAccessWorkspaceStrategy: "git_archive",
        workspaceSetupStatus: "failed",
        workspaceCleanupStatus: "not_required",
        workspaceErrorMessage:
          "Workspace setup failed at /Users/example/private/repo; token=grt_test_secret_value",
      },
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("workspace_setup_failed");
    expect(diagnostics.summary).toContain("could not prepare");
    expect(diagnostics.repositoryAccess).toEqual({
      mode: "snapshot_readonly",
      readScopeLabel: "Tracked repository files at the approved commit may be read.",
      revisionId: "revision_1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      workspaceStrategy: "git_archive",
      workspaceSetupStatus: "failed",
      workspaceCleanupStatus: "not_required",
      workspaceErrorMessage:
        "Workspace setup failed at /Users/example/private/repo; token=[redacted]",
    });
  });

  it("classifies workspace cleanup failures as diagnostics warnings", () => {
    const run = buildRun({
      errorMessage:
        "Harness command exited with status 1; workspaceCleanupStatus=failed; workspace cleanup failed",
      metadata: {
        repositoryAccessMode: "snapshot_readonly",
        repositoryAccessWorkspaceStrategy: "git_archive",
        workspaceSetupStatus: "succeeded",
        workspaceCleanupStatus: "failed",
        workspaceErrorMessage: "Workspace cleanup failed",
      },
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("workspace_cleanup_failed");
    expect(diagnostics.summary).toContain("cleanup");
    expect(diagnostics.repositoryAccess).toMatchObject({
      workspaceStrategy: "git_archive",
      workspaceSetupStatus: "succeeded",
      workspaceCleanupStatus: "failed",
    });
  });

  it("classifies repository fingerprint changes as fingerprint_changed", () => {
    const run = buildRun({
      errorMessage:
        "Harness modified repository state; output was discarded; command=claude -p [prompt]; exitCode=0; durationMs=42000; timeoutMs=600000; timeoutBudgetMs=600000; timeoutClamped=false; timedOut=false; repositoryChanged=true",
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
        }),
      ],
      transcripts: [buildTranscript({ exitCode: 0, stderr: "warning: dirty worktree" })],
      currentRevisionId: "revision_2",
    });

    expect(diagnostics.failureCategory).toBe("fingerprint_changed");
    expect(diagnostics.fingerprint).toEqual({
      changed: true,
      consentedRevisionId: "revision_1",
      currentRevisionId: "revision_2",
    });
    expect(diagnostics.summary).toContain("revision_1");
    expect(diagnostics.summary).toContain("revision_2");
    expect(diagnostics.exitCode).toBe(0);
    expect(diagnostics.stderrTail).toBe("warning: dirty worktree");
  });

  it("classifies unreachable or unconfigured bridges as bridge_down", () => {
    const unavailable = deriveWorkflowRunDiagnostics({
      run: buildRun({
        errorMessage:
          "Harness bridge is unavailable. Configure GREENROOM_HARNESS_BASE_URL and GREENROOM_HARNESS_TOKEN, then check GET /api/harness/status.",
      }),
      events: [],
      transcripts: [],
    });
    const refused = deriveWorkflowRunDiagnostics({
      run: buildRun({ errorMessage: "fetch failed: connect ECONNREFUSED 127.0.0.1:8787" }),
      events: [],
      transcripts: [],
    });

    expect(unavailable.failureCategory).toBe("bridge_down");
    expect(refused.failureCategory).toBe("bridge_down");
    expect(unavailable.summary).toContain("harness bridge");
  });

  it("classifies unknown anchor rejections as unknown_anchor ahead of invalid_output", () => {
    const run = buildRun({
      errorMessage: "Workflow draft failed validation after 1 repair attempt.",
      validationIssues: [
        blockingIssue("unknown-anchor-key"),
        blockingIssue("unexpected-draft-kind"),
      ],
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
          metadata: { issueCodes: ["unknown-anchor-key", "unexpected-draft-kind"] },
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("unknown_anchor");
    expect(diagnostics.validationIssues.map((issue) => issue.code)).toEqual([
      "unknown-anchor-key",
      "unexpected-draft-kind",
    ]);
  });

  it("classifies validator rejections as invalid_output with first-class repair attempts", () => {
    const run = buildRun({
      errorMessage: "Workflow draft failed validation after 1 repair attempt.",
      validationIssues: [blockingIssue("unexpected-draft-kind")],
      metadata: { repairAttemptCount: 1, maxRepairAttempts: 2 },
    });
    const diagnostics = deriveWorkflowRunDiagnostics({
      run,
      events: [
        buildEvent({
          eventType: "repair_attempt",
          severity: "warning",
          summary: "Repair context generated for attempt 1 of 2.",
          metadata: {
            attemptNumber: 1,
            maxRepairAttempts: 2,
            issueCodes: ["unexpected-draft-kind"],
          },
        }),
        buildEvent({
          eventType: "failure",
          severity: "error",
          summary: run.errorMessage ?? "failed",
          metadata: { issueCodes: ["unexpected-draft-kind"] },
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("invalid_output");
    expect(diagnostics.repairAttempts).toEqual([
      {
        attemptNumber: 1,
        issueCodes: ["unexpected-draft-kind"],
        timestamp: fixedNow,
      },
    ]);
    expect(diagnostics.maxRepairAttempts).toBe(2);
  });

  it("derives maxRepairAttempts from repair events when run metadata lacks it", () => {
    const diagnostics = deriveWorkflowRunDiagnostics({
      run: buildRun({ errorMessage: "Workflow draft failed validation after 1 repair attempt." }),
      events: [
        buildEvent({
          eventType: "repair_attempt",
          severity: "warning",
          summary: "Repair context generated for attempt 1 of 2.",
          metadata: { attemptNumber: 1, maxRepairAttempts: 2, issueCodes: ["unknown-anchor-key"] },
        }),
      ],
      transcripts: [],
    });

    expect(diagnostics.maxRepairAttempts).toBe(2);
    expect(diagnostics.repairAttempts).toEqual([
      { attemptNumber: 1, issueCodes: ["unknown-anchor-key"], timestamp: fixedNow },
    ]);
  });

  it("works without transcripts and parses the exit code from the failure record", () => {
    const run = buildRun({
      errorMessage:
        "Harness run failed; command=claude -p [prompt]; exitCode=3; durationMs=1200; timeoutMs=180000; timeoutBudgetMs=null; timeoutClamped=false; timedOut=false; repositoryChanged=false",
    });
    const diagnostics = deriveWorkflowRunDiagnostics({ run, events: [], transcripts: [] });

    expect(diagnostics.transcripts).toEqual([]);
    expect(diagnostics.stderrTail).toBeNull();
    expect(diagnostics.exitCode).toBe(3);
    expect(diagnostics.failureCategory).toBe("unknown");
    expect(diagnostics.summary).toBe(run.errorMessage);
  });

  it("falls back to unknown when no failure signal matches", () => {
    const diagnostics = deriveWorkflowRunDiagnostics({
      run: buildRun({ errorMessage: null }),
      events: [],
      transcripts: [],
    });

    expect(diagnostics.failureCategory).toBe("unknown");
    expect(diagnostics.summary).toBe("Workflow run failed for an unrecognized reason.");
  });

  it("returns only the tail of a long stderr stream from the latest transcript", () => {
    const stderrLines = Array.from({ length: 60 }, (_value, index) => `line-${index + 1}`);
    const diagnostics = deriveWorkflowRunDiagnostics({
      run: buildRun({ errorMessage: "Harness command exited with status 1" }),
      events: [],
      transcripts: [
        buildTranscript({ id: "workflow_transcript_1", attempt: 0, stderr: "older attempt" }),
        buildTranscript({
          id: "workflow_transcript_2",
          attempt: 1,
          exitCode: 1,
          stderr: stderrLines.join("\n"),
        }),
      ],
    });

    const tailLines = diagnostics.stderrTail?.split("\n") ?? [];
    expect(tailLines).toHaveLength(40);
    expect(tailLines[0]).toBe("line-21");
    expect(tailLines.at(-1)).toBe("line-60");
    expect(diagnostics.exitCode).toBe(1);
  });
});
