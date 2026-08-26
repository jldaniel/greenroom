import { describe, expect, it } from "vitest";

import {
  harnessExecutionMetadataSchema,
  workflowRunSchema,
  type WorkflowRun,
  type WorkflowRunEventCreateInput,
} from "@greenroom/schemas";

import {
  buildMcpFirstHarnessRunRequest,
  createHarnessJobMetadataRecorder,
  harnessWorkflowForWorkflowKind,
  recordHarnessExecutionMetadata,
  recordHarnessTimeoutBudgetDiagnostics,
} from "./harness-adapter";

const timestamp = "2026-06-25T12:00:00.000Z";

describe("MCP-first harness adapter", () => {
  it("maps every workflow kind to its bridge workflow contract", () => {
    expect(
      [
        "builtin_review",
        "spotlight_plan",
        "spotlight_refine",
        "spotlight_membership",
        "teaching_generate",
        "teaching_follow_up",
        "setup_smoke",
      ].map((kind) =>
        harnessWorkflowForWorkflowKind(
          kind as Parameters<typeof harnessWorkflowForWorkflowKind>[0],
        ),
      ),
    ).toEqual([
      "builtin_review",
      "spotlight.plan",
      "spotlight.refine",
      "spotlight.generate",
      "teaching.generate",
      "teaching.follow_up",
      "setup_smoke",
    ]);
  });

  it("builds a compact prompt and run-scoped MCP request without embedding full diff content", () => {
    const runToken = "grt_test_adapter_run_token_123456789";
    const run = workflowRun({
      metadata: {
        largeInlineDiffThatMustNotAppear: "@@ -1,2 +1,2 @@\n- return 41;\n+ return 42;",
      },
    });

    const request = buildMcpFirstHarnessRunRequest({
      run,
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
        harnessKind: "claude-code",
        reasoningLevel: null,
      },
      cwd: "/work/greenroom",
      schema: { type: "object", additionalProperties: true },
      mcpServerUrl: "http://127.0.0.1:49332",
      mcpGrant: {
        id: "token_1",
        scopes: ["read"],
        plaintextToken: runToken,
      },
    });

    expect(request).toMatchObject({
      workflow: "builtin_review",
      runId: "workflow_run_1",
      mcp: {
        serverUrl: "http://127.0.0.1:49332",
        serverPath: "/mcp",
        tokenRef: "token_1",
        token: runToken,
        allowedTools: expect.arrayContaining([
          "greenroom_read_diff_file",
          "greenroom_submit_review_findings_draft",
        ]),
      },
      outputMode: "builtin_review_findings",
      outputCapture: "mcp_draft_tool_or_structured_stdout",
      repositoryAccess: { mode: "mcp_only" },
      expectedSkillVersion: "1.0.0",
      promptId: "greenroom_review_prompt",
    });
    expect(request.prompt).toContain("Workflow run id: workflow_run_1");
    expect(request.prompt).toContain("Expected output mode: builtin_review_findings");
    expect(request.prompt).toContain("greenroom_submit_review_findings_draft");
    expect(request.prompt).toContain("- mode: mcp_only");
    expect(request.prompt).toContain("do not assume repository files are available");
    expect(request.prompt).toContain("src/index.ts");
    expect(request.prompt).not.toContain("return 42");
    expect(request.prompt).not.toContain("@@ -1,2 +1,2 @@");
    expect(request.prompt).not.toContain(runToken);
    expect(JSON.stringify(request.metadata)).not.toContain(runToken);
  });

  it("describes snapshot repository access without replacing MCP authority", () => {
    const baseRun = workflowRun();
    const run = workflowRun({
      consentSummary: {
        ...baseRun.consentSummary,
        repositoryAccess: {
          mode: "snapshot_readonly",
          readScopeLabel: "Tracked repository files at the approved commit may be read.",
          revisionId: "revision_1",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          workspaceStrategy: "git_archive",
        },
      },
    });

    const request = buildMcpFirstHarnessRunRequest({
      run,
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
        harnessKind: "claude-code",
        reasoningLevel: null,
      },
      cwd: "/work/greenroom",
      schema: { type: "object", additionalProperties: true },
      mcpServerUrl: "http://127.0.0.1:49332",
      mcpGrant: null,
    });

    expect(request.prompt).toContain("- mode: snapshot_readonly");
    expect(request.repositoryAccess).toEqual({
      mode: "snapshot_readonly",
      sourceRepositoryPath: "/work/greenroom",
      revisionId: "revision_1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      workspaceStrategy: "git_archive",
    });
    expect(request.prompt).toContain("temporary archive snapshot");
    expect(request.prompt).toContain(`approved head SHA: ${"b".repeat(40)}`);
    expect(request.prompt).toContain("Greenroom MCP remains required");
    expect(request.prompt).toContain("Do not create review comments directly");
  });

  it("passes the orchestrator timeout budget from run metadata to the bridge request", () => {
    const run = workflowRun({ metadata: { timeoutBudgetMs: 120_000 } });

    const request = buildMcpFirstHarnessRunRequest({
      run,
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
        harnessKind: "claude-code",
        reasoningLevel: null,
      },
      cwd: "/work/greenroom",
      schema: { type: "object", additionalProperties: true },
      mcpServerUrl: "http://127.0.0.1:49332",
      mcpGrant: null,
      timeoutMs: 300_000,
    });

    expect(request.timeoutBudgetMs).toBe(120_000);
    expect(request.timeoutMs).toBe(300_000);
  });

  it("records a run diagnostic event only when the bridge clamped the harness timeout", () => {
    const recorded: WorkflowRunEventCreateInput[] = [];
    const events = {
      record(input: WorkflowRunEventCreateInput) {
        recorded.push(input);
        return null;
      },
    };
    const run = workflowRun();
    const clampedExecution = harnessExecutionMetadataSchema.parse({
      command: "claude",
      exitCode: null,
      durationMs: 1200,
      timeoutMs: 1000,
      timeoutBudgetMs: 1000,
      timeoutClamped: true,
      timedOut: true,
    });
    const unclampedExecution = harnessExecutionMetadataSchema.parse({
      command: "claude",
      exitCode: 0,
      durationMs: 1200,
      timeoutMs: 180_000,
    });

    recordHarnessTimeoutBudgetDiagnostics({ events, run, execution: unclampedExecution });
    expect(recorded).toHaveLength(0);

    recordHarnessTimeoutBudgetDiagnostics({ events, run, execution: clampedExecution });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      runId: run.id,
      eventType: "harness_launch",
      metadata: {
        timeoutMs: 1000,
        timeoutBudgetMs: 1000,
        timeoutClamped: true,
      },
    });
  });

  it("records coarse bridge job metadata for workflow runs", () => {
    const run = workflowRun();
    const updates: Array<{ run: WorkflowRun; metadata: Record<string, unknown> }> = [];
    const record = createHarnessJobMetadataRecorder({
      readRun: () => run,
      updateRunMetadata(latest, metadata) {
        updates.push({ run: latest, metadata });
      },
      nowMs: () => 1_000,
    });

    record({
      id: "harness_job_1",
      runId: run.id,
      workflow: "builtin_review",
      status: "running",
      streaming: "structured",
      submittedAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      lastHeartbeatAt: timestamp,
      lastProcessSeenAt: timestamp,
      heartbeatIntervalMs: 5000,
      cancelRequestedAt: null,
      lastEventSequence: 0,
      result: null,
      errorMessage: null,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      run: { id: run.id },
      metadata: {
        bridgeJobId: "harness_job_1",
        bridgeJobStatus: "running",
        bridgeHeartbeatAt: timestamp,
        harnessProcessLastSeenAt: timestamp,
      },
    });
  });

  it("records redacted harness execution repository and cleanup metadata", () => {
    const run = workflowRun();
    const updates: Array<{ run: WorkflowRun; metadata: Record<string, unknown> }> = [];
    const execution = harnessExecutionMetadataSchema.parse({
      command: "claude",
      exitCode: 0,
      durationMs: 1200,
      repositoryAccessMode: "snapshot_readonly",
      repositoryWorkspaceStrategy: "git_archive",
      workspaceSetupStatus: "succeeded",
      workspaceCleanupStatus: "failed",
      workspaceErrorMessage: "Workspace cleanup failed",
      repositoryChanged: false,
    });

    recordHarnessExecutionMetadata({
      readRun: () => run,
      updateRunMetadata(latest, metadata) {
        updates.push({ run: latest, metadata });
      },
      execution,
    });

    expect(updates).toEqual([
      {
        run,
        metadata: {
          repositoryAccessMode: "snapshot_readonly",
          repositoryAccessWorkspaceStrategy: "git_archive",
          workspaceSetupStatus: "succeeded",
          workspaceCleanupStatus: "failed",
          workspaceErrorMessage: "Workspace cleanup failed",
          harnessRepositoryChanged: false,
        },
      },
    ]);
    expect(JSON.stringify(updates[0]?.metadata)).not.toContain("claude");
  });
});

function workflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return workflowRunSchema.parse({
    id: "workflow_run_1",
    workflowKind: "builtin_review",
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    profileId: "profile_1",
    harnessKind: "claude-code",
    status: "running",
    phase: "launching_harness",
    consentSummary: {
      workflowKind: "builtin_review",
      selectedHarness: "claude-code",
      profile: {
        id: "profile_1",
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
      },
      reviewDisplayId: "GR-1",
      revisionId: "revision_1",
      scopeLabel: "Full review",
      changedFiles: {
        fileCount: 120,
        additions: 2400,
        deletions: 300,
        binaryFileCount: 0,
        renameCount: 0,
        files: [
          {
            path: "src/index.ts",
            oldPath: null,
            status: "modified",
            additions: 12,
            deletions: 2,
            isBinary: false,
          },
        ],
        omittedFileCount: 119,
      },
      allowedMcpCapabilities: [
        "review:read",
        "revision:read",
        "diff:read",
        "threads:read",
        "spotlight:read",
        "draft:submit",
      ],
      expectedOutputMode: "builtin_review_findings",
      tracingStatus: "disabled",
    },
    approvedScope: {
      label: "Full review",
      revisionId: "revision_1",
      filePaths: ["src/index.ts"],
      changedFiles: {
        fileCount: 120,
        additions: 2400,
        deletions: 300,
        binaryFileCount: 0,
        renameCount: 0,
        files: [
          {
            path: "src/index.ts",
            oldPath: null,
            status: "modified",
            additions: 12,
            deletions: 2,
            isBinary: false,
          },
        ],
        omittedFileCount: 119,
      },
      metadata: {},
    },
    draftOutput: null,
    finalOutput: null,
    validationIssues: [],
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    queuedAt: timestamp,
    startedAt: timestamp,
    finishedAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: {},
    ...overrides,
  });
}
