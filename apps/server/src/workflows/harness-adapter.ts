import {
  greenroomHarnessSkillPackageVersion,
  harnessRunRequestSchema,
  type HarnessRunJob,
  type HarnessExecutionMetadata,
  type HarnessMcpServerConfig,
  type HarnessOutputCaptureMode,
  type HarnessRepositoryAccess,
  type HarnessRunProfile,
  type WorkflowExpectedOutputMode,
  type WorkflowKind,
  type WorkflowMcpCapability,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
} from "@greenroom/schemas";

import type { WorkflowEventSink, WorkflowRunMcpGrant } from "./types";

export interface BuildMcpFirstHarnessRunRequestInput {
  run: WorkflowRun;
  profile: HarnessRunProfile;
  cwd: string;
  schema: Record<string, unknown>;
  mcpServerUrl: string;
  mcpServerPath?: string;
  mcpGrant: WorkflowRunMcpGrant | null;
  promptId?: string;
  outputCapture?: HarnessOutputCaptureMode;
  repairAttemptNumber?: number;
  extraInstructions?: readonly string[];
  timeoutMs?: number;
  timeoutBudgetMs?: number;
}

export function buildMcpFirstHarnessRunRequest(input: BuildMcpFirstHarnessRunRequestInput) {
  const promptId = input.promptId ?? defaultPromptId(input.run.workflowKind);
  const timeoutBudgetMs =
    input.timeoutBudgetMs ?? positiveIntegerMetadata(input.run.metadata.timeoutBudgetMs);
  const outputMode = input.run.consentSummary.expectedOutputMode;
  const allowedTools = allowedToolsForRun(
    input.run.consentSummary.allowedMcpCapabilities,
    outputMode,
  );
  const mcp: HarnessMcpServerConfig = {
    serverUrl: input.mcpServerUrl,
    serverPath: input.mcpServerPath ?? "/mcp",
    tokenRef:
      input.mcpGrant?.id ??
      (typeof input.run.metadata.mcpGrantId === "string" ? input.run.metadata.mcpGrantId : null),
    ...(input.mcpGrant?.plaintextToken === undefined
      ? {}
      : { token: input.mcpGrant.plaintextToken }),
    allowedTools,
    allowedResources:
      input.run.consentSummary.expectedMcpResources.length === 0
        ? allowedResourcesForRun(input.run)
        : input.run.consentSummary.expectedMcpResources.map((resource) =>
            resource.replaceAll("{runId}", input.run.id),
          ),
  };

  return harnessRunRequestSchema.parse({
    workflow: harnessWorkflowForWorkflowKind(input.run.workflowKind),
    runId: input.run.id,
    profile: input.profile,
    cwd: input.cwd,
    prompt: buildMcpFirstHarnessPrompt({
      run: input.run,
      promptId,
      mcp,
      extraInstructions: input.extraInstructions ?? [],
    }),
    schema: input.schema,
    mcp,
    expectedSkillVersion: greenroomHarnessSkillPackageVersion,
    promptId,
    outputMode,
    outputCapture: input.outputCapture ?? "mcp_draft_tool_or_structured_stdout",
    repositoryAccess: harnessRepositoryAccessForRun(input.run, input.cwd),
    repairAttemptNumber:
      input.repairAttemptNumber ??
      (typeof input.run.metadata.repairAttemptCount === "number"
        ? input.run.metadata.repairAttemptCount
        : 0),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(timeoutBudgetMs === undefined ? {} : { timeoutBudgetMs }),
    metadata: {
      workflowKind: input.run.workflowKind,
      reviewDisplayId: input.run.reviewDisplayId,
      revisionId: input.run.revisionId,
      promptId,
      outputMode,
      mcpGrantId: mcp.tokenRef,
    },
  });
}

function harnessRepositoryAccessForRun(run: WorkflowRun, cwd: string): HarnessRepositoryAccess {
  const access = run.consentSummary.repositoryAccess;

  if (access.mode === "mcp_only") {
    return { mode: "mcp_only" };
  }

  if (
    access.revisionId === null ||
    access.baseSha === null ||
    access.headSha === null ||
    access.workspaceStrategy === null
  ) {
    throw new Error("Snapshot repository access is missing committed revision metadata");
  }

  return {
    mode: "snapshot_readonly",
    sourceRepositoryPath: cwd,
    revisionId: access.revisionId,
    baseSha: access.baseSha,
    headSha: access.headSha,
    workspaceStrategy: access.workspaceStrategy,
  };
}

export function buildMcpFirstHarnessPrompt(input: {
  run: WorkflowRun;
  promptId: string;
  mcp: Pick<
    HarnessMcpServerConfig,
    "serverUrl" | "serverPath" | "allowedTools" | "allowedResources"
  >;
  extraInstructions?: readonly string[];
}): string {
  const { run } = input;
  const changed = run.consentSummary.changedFiles;
  const files = changed.files.map(
    (file) =>
      `- ${file.path}${file.oldPath === null ? "" : ` (from ${file.oldPath})`}: ${file.status}, +${file.additions}/-${file.deletions}${file.isBinary ? ", binary" : ""}`,
  );
  const omittedLine =
    changed.omittedFileCount > 0
      ? [`- ${changed.omittedFileCount} additional file(s) omitted from the summary.`]
      : [];
  const draftTool = draftToolForOutputMode(run.consentSummary.expectedOutputMode);

  return [
    "You are running a Greenroom workflow.",
    `Prompt id: ${input.promptId}`,
    `Workflow run id: ${run.id}`,
    `Workflow kind: ${run.workflowKind}`,
    `Review: ${run.consentSummary.reviewDisplayId}`,
    `Revision: ${run.revisionId}`,
    `Expected output mode: ${run.consentSummary.expectedOutputMode}`,
    `Approved scope: ${run.consentSummary.scopeLabel}`,
    [
      "Changed-file summary:",
      `- files: ${changed.fileCount}`,
      `- additions: ${changed.additions}`,
      `- deletions: ${changed.deletions}`,
      `- binary files: ${changed.binaryFileCount}`,
      `- renames: ${changed.renameCount}`,
      ...files,
      ...omittedLine,
    ].join("\n"),
    [
      "MCP access:",
      `- endpoint: ${mcpUrl(input.mcp.serverUrl, input.mcp.serverPath)}`,
      "- use the run-scoped bearer token supplied by the harness MCP config or GREENROOM_MCP_TOKEN",
      `- allowed tools: ${input.mcp.allowedTools.join(", ") || "none"}`,
      `- allowed resources: ${input.mcp.allowedResources.join(", ") || "none"}`,
    ].join("\n"),
    repositoryAccessPromptBlock(run),
    [
      "Instructions:",
      "- Do not modify repository files or write repository-local state.",
      ...repositoryAccessInstructionLines(run),
      "- Report progress with greenroom_report_progress at natural boundaries such as each file, view, or section.",
      draftTool === null
        ? "- Return structured stdout JSON matching the supplied schema."
        : `- Submit the draft with ${draftTool}.`,
      "- If structured stdout is needed as fallback, print only JSON matching the supplied schema.",
      ...(input.extraInstructions ?? []),
    ].join("\n"),
  ].join("\n\n");
}

function repositoryAccessPromptBlock(run: WorkflowRun): string {
  const access = run.consentSummary.repositoryAccess;

  if (access.mode === "snapshot_readonly") {
    return [
      "Repository access:",
      "- mode: snapshot_readonly",
      "- the current working directory is a temporary archive snapshot at the approved head commit",
      `- approved revision: ${access.revisionId ?? run.revisionId}`,
      `- approved head SHA: ${access.headSha ?? "unknown"}`,
      `- workspace strategy: ${access.workspaceStrategy ?? "unknown"}`,
      "- filesystem read/search/list tools may be used for code navigation and understanding only",
      "- Greenroom MCP remains required for review metadata, anchors, existing threads, Spotlight views, progress, and draft submission",
    ].join("\n");
  }

  return [
    "Repository access:",
    "- mode: mcp_only",
    "- do not assume repository files are available on the filesystem",
    "- read changed files, anchors, review metadata, existing threads, and Spotlight context through Greenroom MCP",
  ].join("\n");
}

function repositoryAccessInstructionLines(run: WorkflowRun): string[] {
  if (run.consentSummary.repositoryAccess.mode === "snapshot_readonly") {
    return [
      "- Use filesystem reads/searches for code navigation when helpful, but keep Greenroom MCP authoritative for review contracts.",
      "- Do not create review comments directly; submit drafts through Greenroom MCP or the structured stdout fallback.",
    ];
  }

  return [
    "- Do not embed or request the full diff. Read context incrementally through MCP.",
    "- Use path-scoped file reads and searches for large reviews.",
  ];
}

// Surfaces a bridge-side timeout clamp (harness timeout above the API run
// budget) through the existing workflow run event mechanism.
export function recordHarnessTimeoutBudgetDiagnostics(input: {
  events: WorkflowEventSink;
  run: WorkflowRun;
  execution: HarnessExecutionMetadata;
}): void {
  if (!input.execution.timeoutClamped) {
    return;
  }

  input.events.record({
    runId: input.run.id,
    eventType: "harness_launch",
    summary: `Harness timeout exceeded the workflow budget and was clamped to ${input.execution.timeoutMs}ms by the bridge.`,
    metadata: {
      timeoutMs: input.execution.timeoutMs,
      timeoutBudgetMs: input.execution.timeoutBudgetMs,
      timeoutClamped: true,
    },
  });
}

export function recordHarnessExecutionMetadata(input: {
  readRun: () => WorkflowRun | null;
  updateRunMetadata: (run: WorkflowRun, metadata: WorkflowRedactedMetadata) => void;
  execution: HarnessExecutionMetadata;
}): void {
  const run = input.readRun();

  if (run === null) {
    return;
  }

  input.updateRunMetadata(run, {
    repositoryAccessMode: input.execution.repositoryAccessMode,
    repositoryAccessWorkspaceStrategy: input.execution.repositoryWorkspaceStrategy,
    workspaceSetupStatus: input.execution.workspaceSetupStatus,
    workspaceCleanupStatus: input.execution.workspaceCleanupStatus,
    workspaceErrorMessage: input.execution.workspaceErrorMessage,
    harnessRepositoryChanged: input.execution.repositoryChanged,
  });
}

export function createHarnessJobMetadataRecorder(input: {
  readRun: () => WorkflowRun | null;
  updateRunMetadata: (run: WorkflowRun, metadata: WorkflowRedactedMetadata) => void;
  throttleMs?: number;
  nowMs?: () => number;
}): (job: HarnessRunJob) => void {
  const throttleMs = input.throttleMs ?? 5_000;
  const nowMs = input.nowMs ?? (() => Date.now());
  let lastPersistedAt = 0;
  let lastJobId: string | null = null;
  let lastStatus: HarnessRunJob["status"] | null = null;
  let lastStartedAt: string | null = null;
  let lastFinishedAt: string | null = null;
  let lastCancelRequestedAt: string | null = null;

  return (job) => {
    const terminal = isTerminalHarnessJobStatus(job.status);
    const force =
      job.id !== lastJobId ||
      job.status !== lastStatus ||
      job.startedAt !== lastStartedAt ||
      job.finishedAt !== lastFinishedAt ||
      job.cancelRequestedAt !== lastCancelRequestedAt ||
      terminal;
    const now = nowMs();

    if (!force && now - lastPersistedAt < throttleMs) {
      return;
    }

    const run = input.readRun();

    if (run === null) {
      return;
    }

    input.updateRunMetadata(run, {
      bridgeJobId: job.id,
      bridgeJobStatus: job.status,
      bridgeSubmittedAt: job.submittedAt,
      bridgeStartedAt: job.startedAt,
      bridgeFinishedAt: job.finishedAt,
      bridgeHeartbeatAt: job.lastHeartbeatAt,
      bridgeHeartbeatIntervalMs: job.heartbeatIntervalMs,
      harnessProcessLastSeenAt: job.lastProcessSeenAt,
      bridgeCancelRequestedAt: job.cancelRequestedAt,
    });
    lastPersistedAt = now;
    lastJobId = job.id;
    lastStatus = job.status;
    lastStartedAt = job.startedAt;
    lastFinishedAt = job.finishedAt;
    lastCancelRequestedAt = job.cancelRequestedAt;
  };
}

function isTerminalHarnessJobStatus(status: HarnessRunJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function harnessWorkflowForWorkflowKind(kind: WorkflowKind) {
  switch (kind) {
    case "builtin_review":
      return "builtin_review";
    case "spotlight_plan":
      return "spotlight.plan";
    case "spotlight_refine":
      return "spotlight.refine";
    case "spotlight_membership":
      return "spotlight.generate";
    case "teaching_generate":
      return "teaching.generate";
    case "teaching_follow_up":
      return "teaching.follow_up";
    case "setup_smoke":
      return "setup_smoke";
  }
}

function defaultPromptId(kind: WorkflowKind): string {
  switch (kind) {
    case "builtin_review":
      return "greenroom_review_prompt";
    case "spotlight_plan":
      return "greenroom_spotlight_plan_prompt";
    case "spotlight_membership":
    case "spotlight_refine":
      return "greenroom_spotlight_membership_prompt";
    case "teaching_generate":
    case "teaching_follow_up":
      return "greenroom_teaching_prompt";
    case "setup_smoke":
      return "greenroom_setup_smoke_prompt";
  }
}

function allowedToolsForRun(
  capabilities: readonly WorkflowMcpCapability[],
  outputMode: WorkflowExpectedOutputMode,
): string[] {
  const tools = new Set<string>();

  tools.add("greenroom_report_progress");

  if (capabilities.includes("review:read")) {
    tools.add("greenroom_get_review");
    tools.add("greenroom_list_changed_files");
  }

  if (capabilities.includes("diff:read") || capabilities.includes("revision:read")) {
    tools.add("greenroom_read_diff_file");
    tools.add("greenroom_search_diff");
    tools.add("greenroom_get_anchor_registry");
  }

  if (capabilities.includes("threads:read")) {
    tools.add("greenroom_get_existing_threads");
  }

  if (capabilities.includes("spotlight:read")) {
    tools.add("greenroom_get_spotlight_views");
    tools.add("greenroom_get_view_diff");
  }

  if (capabilities.includes("draft:submit")) {
    const draftTool = draftToolForOutputMode(outputMode);

    if (draftTool !== null) {
      tools.add(draftTool);
    }
  }

  return [...tools];
}

function allowedResourcesForRun(run: WorkflowRun): string[] {
  const review = run.consentSummary.reviewDisplayId;

  return [
    "greenroom://concepts/review-model",
    "greenroom://concepts/anchors",
    `greenroom://reviews/${review}/manifest`,
    `greenroom://reviews/${review}/diff-summary`,
    `greenroom://reviews/${review}/files`,
    `greenroom://reviews/${review}/files/{path}`,
    `greenroom://reviews/${review}/anchors/{path}`,
    `greenroom://reviews/${review}/threads`,
    `greenroom://reviews/${review}/spotlight/views`,
    `greenroom://runs/${run.id}/instructions`,
    `greenroom://runs/${run.id}/output-schema`,
    `greenroom://runs/${run.id}/consent-scope`,
    `greenroom://runs/${run.id}/validation-errors`,
  ];
}

function draftToolForOutputMode(outputMode: WorkflowExpectedOutputMode): string | null {
  switch (outputMode) {
    case "builtin_review_findings":
      return "greenroom_submit_review_findings_draft";
    case "spotlight_outline":
      return "greenroom_submit_spotlight_outline_draft";
    case "spotlight_membership":
      return "greenroom_submit_spotlight_membership_draft";
    case "teaching_draft":
      return "greenroom_submit_teaching_draft";
    case "teaching_follow_up_answer":
      return null;
    case "setup_smoke_report":
      return null;
  }
}

function positiveIntegerMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mcpUrl(serverUrl: string, serverPath: string): string {
  const base = serverUrl.replace(/\/+$/u, "");
  const path = serverPath.startsWith("/") ? serverPath : `/${serverPath}`;

  return `${base}${path}`;
}
