import * as z from "zod";

import { absolutePathSchema, gitShaSchema } from "./primitives";
import {
  profileIdSchema,
  profileWorkflowTypeSchema,
  providerKindSchema,
  type Profile,
  type ProfileCreateInput,
  type ProfileWorkflowType,
} from "./profiles";
import { revisionIdSchema } from "./reviews";
import { workflowExpectedOutputModeSchema } from "./workflows";

export const harnessRuntimeModeSchema = z.enum(["disabled", "bridge", "sidecar", "in_process"]);
export const harnessRepositoryAccessModeSchema = z.enum(["mcp_only", "snapshot_readonly"]);
export const harnessRepositoryWorkspaceStrategySchema = z.enum(["git_archive", "git_worktree"]);

export const harnessModelCatalogSourceSchema = z.enum(["live", "built_in", "fallback"]);

export const harnessModelReasoningLevelSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(160),
  })
  .strict();

export const harnessModelCatalogModelSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(240),
    isDefault: z.boolean(),
    reasoningLevels: z.array(harnessModelReasoningLevelSchema).max(20),
  })
  .strict();

export const harnessModelCatalogSchema = z
  .object({
    kind: z.string().trim().min(1).max(160),
    source: harnessModelCatalogSourceSchema,
    refreshedAt: z.string().datetime(),
    diagnostics: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    models: z.array(harnessModelCatalogModelSchema).min(1).max(500),
  })
  .strict();

export const harnessMcpOnlyRepositoryAccessSchema = z
  .object({
    mode: z.literal("mcp_only"),
  })
  .strict();

export const harnessSnapshotReadonlyRepositoryAccessSchema = z
  .object({
    mode: z.literal("snapshot_readonly"),
    sourceRepositoryPath: absolutePathSchema,
    revisionId: revisionIdSchema,
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    workspaceStrategy: harnessRepositoryWorkspaceStrategySchema.default("git_archive"),
  })
  .strict();

export const harnessRepositoryAccessSchema = z
  .discriminatedUnion("mode", [
    harnessMcpOnlyRepositoryAccessSchema,
    harnessSnapshotReadonlyRepositoryAccessSchema,
  ])
  .default({ mode: "mcp_only" });

export const harnessProfileSettingsSchema = z
  .object({
    kind: z.string().trim().min(1),
    reasoningLevel: z.string().trim().min(1).max(160).optional(),
    idleTimeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    repositoryAccessMode: harnessRepositoryAccessModeSchema.default("mcp_only"),
    workspaceStrategy: harnessRepositoryWorkspaceStrategySchema.default("git_archive"),
  })
  .passthrough();

export const greenroomHarnessSkillPackageName = "greenroom";
export const greenroomHarnessSkillPackageVersion = "1.0.0";
export const greenroomHarnessMcpSmokeResource = "greenroom://setup/smoke";

export const harnessSkillModeSchema = z.enum(["managed_package", "inline_prompt"]);
export const harnessMcpExpectationSchema = z.enum(["required", "optional", "not_supported"]);
export const harnessSmokeTestModeSchema = z.enum(["mcp_resource", "bridge_run", "none"]);
export const harnessCliInstallStatusSchema = z.enum([
  "installed",
  "missing",
  "unsupported",
  "unknown",
]);
export const harnessSkillPackageStatusSchema = z.enum([
  "current",
  "missing",
  "outdated",
  "unsupported",
  "unknown",
]);
export const harnessMcpSetupStatusSchema = z.enum([
  "configured",
  "not_configured",
  "unknown",
  "unsupported",
]);
export const harnessSetupSmokeStatusSchema = z.enum(["passed", "failed"]);

export const harnessCliDescriptorSchema = z
  .object({
    commands: z.array(z.string().trim().min(1)).min(1),
    versionArgs: z.array(z.string().trim().min(1)).default(["--version"]),
    minimumVersion: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

export const harnessSkillSupportDescriptorSchema = z
  .object({
    mode: harnessSkillModeSchema,
    packageName: z.string().trim().min(1).nullable(),
    expectedVersion: z.string().trim().min(1).nullable(),
  })
  .strict();

export const harnessMcpExpectationDescriptorSchema = z
  .object({
    expectation: harnessMcpExpectationSchema,
    smokeResource: z.string().trim().min(1).nullable(),
    notes: z.string().trim().min(1).max(1000),
  })
  .strict();

export const harnessSmokeTestSupportDescriptorSchema = z
  .object({
    supported: z.boolean(),
    mode: harnessSmokeTestModeSchema,
    workflowKind: z.literal("setup_smoke").nullable(),
  })
  .strict();

export const harnessKindDescriptorSchema = z
  .object({
    kind: z.string().trim().min(1),
    label: z.string().trim().min(1),
    defaultModel: z.string().trim().min(1),
    defaultModelDisplay: z.string().trim().min(1),
    defaultTimeoutMs: z.number().int().min(1000).max(86_400_000),
    defaultIdleTimeoutMs: z.number().int().min(1000).max(86_400_000).default(300_000),
    supportsStructuredOutput: z.boolean(),
    supportsStreaming: z.boolean().default(false),
    supportedWorkflows: z.array(profileWorkflowTypeSchema),
    cli: harnessCliDescriptorSchema,
    skillSupport: harnessSkillSupportDescriptorSchema,
    mcp: harnessMcpExpectationDescriptorSchema,
    smokeTest: harnessSmokeTestSupportDescriptorSchema,
  })
  .strict();

export const claudeCodeHarnessKindDescriptor = harnessKindDescriptorSchema.parse({
  kind: "claude-code",
  label: "Claude Code",
  defaultModel: "claude-code",
  defaultModelDisplay: "Claude Code default",
  defaultTimeoutMs: 3_600_000,
  defaultIdleTimeoutMs: 300_000,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  supportedWorkflows: ["teaching", "spotlight", "builtin_review"],
  cli: {
    commands: ["claude"],
    versionArgs: ["--version"],
    minimumVersion: null,
  },
  skillSupport: {
    mode: "managed_package",
    packageName: greenroomHarnessSkillPackageName,
    expectedVersion: greenroomHarnessSkillPackageVersion,
  },
  mcp: {
    expectation: "required",
    smokeResource: greenroomHarnessMcpSmokeResource,
    notes:
      "Greenroom workflows expect Claude Code to read Greenroom MCP resources through per-run MCP config and run-scoped credentials.",
  },
  smokeTest: {
    supported: true,
    mode: "bridge_run",
    workflowKind: "setup_smoke",
  },
});

export const codexHarnessKindDescriptor = harnessKindDescriptorSchema.parse({
  kind: "codex",
  label: "Codex",
  defaultModel: "codex",
  defaultModelDisplay: "Codex CLI default",
  defaultTimeoutMs: 3_600_000,
  defaultIdleTimeoutMs: 300_000,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  supportedWorkflows: ["teaching", "spotlight", "builtin_review"],
  cli: {
    commands: ["codex"],
    versionArgs: ["--version"],
    minimumVersion: null,
  },
  skillSupport: {
    mode: "managed_package",
    packageName: greenroomHarnessSkillPackageName,
    expectedVersion: greenroomHarnessSkillPackageVersion,
  },
  mcp: {
    expectation: "required",
    smokeResource: greenroomHarnessMcpSmokeResource,
    notes:
      "Greenroom can detect Codex and install the skill package now; workflow execution waits for MCP-first orchestration.",
  },
  smokeTest: {
    supported: true,
    mode: "bridge_run",
    workflowKind: "setup_smoke",
  },
});

/**
 * Pi fallback harness: an API-key-driven coding agent
 * CLI that Greenroom can install and manage host-side for users without a
 * Claude Code or Codex subscription. The npm package and version are pinned
 * here so the managed install, detection, and docs all agree on one source.
 */
export const piNpmPackageName = "@mariozechner/pi-coding-agent";
export const piNpmPinnedVersion = "0.73.1";

export const piHarnessKindDescriptor = harnessKindDescriptorSchema.parse({
  kind: "pi",
  label: "Pi",
  defaultModel: "pi",
  defaultModelDisplay: "Pi provider default",
  defaultTimeoutMs: 3_600_000,
  defaultIdleTimeoutMs: 300_000,
  supportsStructuredOutput: true,
  supportsStreaming: false,
  supportedWorkflows: ["teaching", "spotlight", "builtin_review"],
  cli: {
    commands: ["pi"],
    versionArgs: ["--version"],
    minimumVersion: null,
  },
  skillSupport: {
    mode: "inline_prompt",
    packageName: null,
    expectedVersion: null,
  },
  mcp: {
    expectation: "not_supported",
    smokeResource: null,
    notes:
      "Pi has no MCP client; Greenroom passes the prompt over stdin and reads the schema-bound draft from structured stdout.",
  },
  smokeTest: {
    supported: true,
    mode: "bridge_run",
    workflowKind: "setup_smoke",
  },
});

export const knownHarnessKindDescriptors: readonly HarnessKindDescriptor[] = Object.freeze([
  claudeCodeHarnessKindDescriptor,
  codexHarnessKindDescriptor,
  piHarnessKindDescriptor,
]);

export function listKnownHarnessKindDescriptors(): HarnessKindDescriptor[] {
  return knownHarnessKindDescriptors.map(cloneHarnessKindDescriptor);
}

export function getHarnessKindDescriptor(kind: string): HarnessKindDescriptor | null {
  const descriptor = knownHarnessKindDescriptors.find((candidate) => candidate.kind === kind);
  return descriptor === undefined ? null : cloneHarnessKindDescriptor(descriptor);
}

export function harnessKindFromProfile(
  profile: Pick<Profile, "provider" | "model" | "modelSettings">,
): string | null {
  if (profile.provider !== "harness") {
    return null;
  }

  const settings = harnessProfileSettingsSchema.safeParse(profile.modelSettings.harness);

  if (settings.success) {
    return settings.data.kind;
  }

  return profile.model;
}

export function harnessIdleTimeoutMsFromProfile(
  profile: Pick<Profile, "provider" | "modelSettings">,
): number | undefined {
  if (profile.provider !== "harness") {
    return undefined;
  }

  const settings = harnessProfileSettingsSchema.safeParse(profile.modelSettings.harness);
  return settings.success ? settings.data.idleTimeoutMs : undefined;
}

export function harnessRepositoryAccessModeFromProfile(
  profile: Pick<Profile, "provider" | "modelSettings">,
): HarnessRepositoryAccessMode {
  if (profile.provider !== "harness") {
    return "mcp_only";
  }

  const settings = harnessProfileSettingsSchema.safeParse(profile.modelSettings.harness);
  return settings.success ? settings.data.repositoryAccessMode : "mcp_only";
}

export function harnessRepositoryWorkspaceStrategyFromProfile(
  profile: Pick<Profile, "provider" | "modelSettings">,
): HarnessRepositoryWorkspaceStrategy {
  if (profile.provider !== "harness") {
    return "git_archive";
  }

  const settings = harnessProfileSettingsSchema.safeParse(profile.modelSettings.harness);
  return settings.success ? settings.data.workspaceStrategy : "git_archive";
}

export function buildHarnessModelSettings(kind: string): Record<string, unknown> {
  const descriptor = getHarnessKindDescriptor(kind);

  return {
    harness: {
      kind,
      idleTimeoutMs: descriptor?.defaultIdleTimeoutMs ?? 300_000,
      repositoryAccessMode: "mcp_only",
      workspaceStrategy: "git_archive",
    },
  };
}

export function createHarnessProfileDefaultInput(input: {
  workflowType: Extract<ProfileWorkflowType, "teaching" | "spotlight" | "builtin_review">;
  kind: string;
  name: string;
  description?: string | null;
  systemPrompt?: string | null;
  contextPreferences?: Record<string, unknown>;
}): ProfileCreateInput {
  const descriptor = getHarnessKindDescriptor(input.kind);

  return {
    name: input.name,
    workflowType: input.workflowType,
    provider: "harness",
    model: descriptor?.defaultModel ?? input.kind,
    description: input.description ?? null,
    systemPrompt: input.systemPrompt ?? null,
    modelSettings: buildHarnessModelSettings(input.kind),
    allowedTools: [],
    contextPreferences: input.contextPreferences ?? {},
    privacy: {
      persistTranscript: true,
    },
  };
}

export const harnessWorkflowSchema = z.enum([
  "teaching.generate",
  "teaching.follow_up",
  "spotlight.plan",
  "spotlight.refine",
  "spotlight.generate",
  "builtin_review",
  "setup_smoke",
]);

export const harnessRunStatusSchema = z.enum(["completed", "failed"]);
export const harnessOutputCaptureModeSchema = z.enum([
  "structured_stdout",
  "mcp_draft_tool",
  "mcp_draft_tool_or_structured_stdout",
]);

export const harnessRunProfileSchema = z
  .object({
    id: profileIdSchema,
    name: z.string().trim().min(1).max(160),
    workflowType: profileWorkflowTypeSchema,
    provider: providerKindSchema,
    model: z.string().trim().min(1).max(160),
    harnessKind: z.string().trim().min(1).max(160).nullable().default(null),
    reasoningLevel: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict();

export const harnessMcpServerConfigSchema = z
  .object({
    serverUrl: z.string().trim().min(1).max(2000),
    serverPath: z.string().trim().min(1).max(240).default("/mcp"),
    tokenRef: z.string().trim().min(1).max(200).nullable().default(null),
    token: z.string().trim().min(1).max(8000).optional(),
    allowedTools: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
    allowedResources: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  })
  .strict();

export const harnessRunRequestSchema = z
  .object({
    workflow: harnessWorkflowSchema,
    runId: z.string().trim().min(1).max(200),
    profile: harnessRunProfileSchema,
    cwd: z.string().trim().min(1),
    prompt: z.string().trim().min(1).max(4_000_000),
    schema: z.record(z.string(), z.unknown()),
    mcp: harnessMcpServerConfigSchema.nullable().default(null),
    expectedSkillVersion: z.string().trim().min(1).max(100).nullable().default(null),
    promptId: z.string().trim().min(1).max(200).nullable().default(null),
    outputMode: workflowExpectedOutputModeSchema.nullable().default(null),
    outputCapture: harnessOutputCaptureModeSchema.default("structured_stdout"),
    repairAttemptNumber: z.number().int().min(0).max(20).default(0),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    timeoutBudgetMs: z.number().int().min(1000).max(86_400_000).optional(),
    repositoryAccess: harnessRepositoryAccessSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const harnessStreamEventKindSchema = z.enum([
  "run_started",
  "assistant_text",
  "tool_call",
  "tool_result",
  "stderr_line",
  "result",
  "exit",
]);

export const harnessStreamingCapabilitySchema = z.enum(["structured", "line", "none"]);

export const harnessStreamEventSchema = z
  .object({
    sequence: z.number().int().min(1),
    timestamp: z.string().trim().min(1),
    kind: harnessStreamEventKindSchema,
    summary: z.string().trim().min(1).max(2000),
    text: z.string().max(65_000).nullable().default(null),
    name: z.string().trim().min(1).max(240).nullable().default(null),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const harnessExecutionMetadataSchema = z
  .object({
    command: z.string().trim().min(1),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().min(0),
    stderrTail: z.string().max(65_000).default(""),
    timeoutMs: z.number().int().min(0).nullable().default(null),
    timeoutBudgetMs: z.number().int().min(0).nullable().default(null),
    timeoutClamped: z.boolean().default(false),
    timedOut: z.boolean().default(false),
    repositoryAccessMode: harnessRepositoryAccessModeSchema.default("mcp_only"),
    repositoryWorkspaceStrategy: harnessRepositoryWorkspaceStrategySchema.nullable().default(null),
    workspaceSetupStatus: z.enum(["not_required", "succeeded", "failed"]).default("not_required"),
    workspaceCleanupStatus: z.enum(["not_required", "succeeded", "failed"]).default("not_required"),
    workspaceErrorMessage: z.string().trim().min(1).max(4000).nullable().default(null),
    repositoryChanged: z.boolean().default(false),
    repositoryFingerprintBefore: z.string().nullable().default(null),
    repositoryFingerprintAfter: z.string().nullable().default(null),
    outputCapture: harnessOutputCaptureModeSchema.default("structured_stdout"),
  })
  .strict();

export const harnessRunResponseSchema = z
  .object({
    workflow: harnessWorkflowSchema,
    runId: z.string().trim().min(1).max(200),
    status: harnessRunStatusSchema,
    output: z.unknown().optional(),
    message: z.string().trim().min(1).max(4000).optional(),
    execution: harnessExecutionMetadataSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "completed" &&
      value.output === undefined &&
      value.execution.outputCapture === "structured_stdout"
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed harness runs require output",
        path: ["output"],
      });
    }

    if (value.status === "failed" && value.message === undefined) {
      context.addIssue({
        code: "custom",
        message: "Failed harness runs require a message",
        path: ["message"],
      });
    }
  });

export const harnessRunJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const harnessRunJobSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    runId: z.string().trim().min(1).max(200),
    workflow: harnessWorkflowSchema,
    status: harnessRunJobStatusSchema,
    streaming: harnessStreamingCapabilitySchema,
    submittedAt: z.string().trim().min(1),
    startedAt: z.string().trim().min(1).nullable(),
    finishedAt: z.string().trim().min(1).nullable(),
    lastHeartbeatAt: z.string().trim().min(1).nullable().default(null),
    lastProcessSeenAt: z.string().trim().min(1).nullable().default(null),
    heartbeatIntervalMs: z.number().int().min(100).max(3_600_000).nullable().default(null),
    cancelRequestedAt: z.string().trim().min(1).nullable().default(null),
    lastEventSequence: z.number().int().min(0),
    result: harnessRunResponseSchema.nullable().default(null),
    errorMessage: z.string().trim().min(1).max(4000).nullable().default(null),
  })
  .strict();

export const harnessRunJobCreateResponseSchema = z
  .object({
    job: harnessRunJobSchema,
  })
  .strict();

export const harnessRunJobEventsResponseSchema = z
  .object({
    events: z.array(harnessStreamEventSchema),
    nextCursor: z.number().int().min(0),
    terminal: z.boolean(),
  })
  .strict();

export const harnessBridgeAvailableKindSchema = z
  .object({
    kind: z.string().trim().min(1),
    label: z.string().trim().min(1),
    commandConfigured: z.boolean(),
  })
  .strict();

export const harnessBridgeCapabilitySchema = z.enum([
  "run_jobs",
  "heartbeat",
  "repository_snapshot_git_archive",
  "repository_snapshot_git_worktree",
]);

export const harnessBridgeHealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    runtimeMode: z.enum(["bridge", "sidecar", "in_process"]),
    defaultKind: z.string().trim().min(1).nullable(),
    commandConfigured: z.boolean(),
    availableKinds: z.array(harnessBridgeAvailableKindSchema),
    pathMappings: z.number().int().min(0),
    capabilities: z.array(harnessBridgeCapabilitySchema).default([]),
  })
  .strict();

export const harnessDetectedCliSchema = z
  .object({
    kind: z.string().trim().min(1),
    label: z.string().trim().min(1),
    command: z.string().trim().min(1),
    found: z.boolean(),
    path: z.string().trim().min(1).nullable(),
    version: z.string().trim().min(1).max(400).nullable(),
    lastVerifiedVersion: z.string().trim().min(1).max(400).nullable(),
    recommendSmoke: z.boolean(),
    probedAt: z.string().trim().min(1),
    message: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export const harnessBridgeDetectionResponseSchema = z
  .object({
    probedAt: z.string().trim().min(1),
    harnesses: z.array(harnessDetectedCliSchema),
  })
  .strict();

export const harnessBridgeSmokeRecordResponseSchema = z
  .object({
    recorded: z.boolean(),
    harness: harnessDetectedCliSchema.nullable(),
  })
  .strict();

export const harnessStatusAvailableKindSchema = harnessKindDescriptorSchema.pick({
  kind: true,
  label: true,
  defaultModel: true,
  defaultModelDisplay: true,
  supportedWorkflows: true,
  skillSupport: true,
  mcp: true,
  smokeTest: true,
});

export const harnessLocalCliStatusSchema = z
  .object({
    status: harnessCliInstallStatusSchema,
    path: z.string().trim().min(1).nullable(),
    version: z.string().trim().min(1).max(400).nullable(),
    message: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export const harnessBridgeKindStatusSchema = z
  .object({
    configured: z.boolean(),
    commandConfigured: z.boolean(),
  })
  .strict();

export const harnessSkillStatusDetailSchema = z
  .object({
    skillMode: harnessSkillModeSchema,
    status: harnessSkillPackageStatusSchema,
    packageName: z.string().trim().min(1).nullable(),
    expectedVersion: z.string().trim().min(1).nullable(),
    installedVersion: z.string().trim().min(1).max(100).nullable(),
    path: z.string().trim().min(1).nullable(),
    diagnostics: z.array(z.string().trim().min(1).max(1000)).max(20),
  })
  .strict();

export const harnessMcpSetupStatusDetailSchema = z
  .object({
    status: harnessMcpSetupStatusSchema,
    smokeResource: z.string().trim().min(1).nullable(),
    diagnostics: z.array(z.string().trim().min(1).max(1000)).max(20),
  })
  .strict();

export const harnessKindSetupStatusSchema = harnessStatusAvailableKindSchema
  .extend({
    cli: harnessLocalCliStatusSchema,
    bridge: harnessBridgeKindStatusSchema,
    skill: harnessSkillStatusDetailSchema,
    mcpSetup: harnessMcpSetupStatusDetailSchema,
  })
  .strict();

export const harnessStatusResponseSchema = z
  .object({
    configured: z.boolean(),
    baseUrl: z.string().trim().min(1).nullable(),
    healthy: z.boolean(),
    runtimeMode: harnessRuntimeModeSchema,
    availableKinds: z.array(harnessStatusAvailableKindSchema),
    harnesses: z.array(harnessKindSetupStatusSchema),
    detectedHarnesses: z.array(harnessDetectedCliSchema).default([]),
    bridgeCapabilities: z.array(harnessBridgeCapabilitySchema).default([]),
    errorMessage: z.string().trim().min(1).nullable(),
  })
  .strict();

export const harnessSkillCheckResponseSchema = z
  .object({
    kind: z.string().trim().min(1),
    skill: harnessSkillStatusDetailSchema,
  })
  .strict();

export const harnessSkillInstallResponseSchema = z
  .object({
    kind: z.string().trim().min(1),
    installed: z.boolean(),
    skill: harnessSkillStatusDetailSchema,
  })
  .strict();

export const harnessSetupSmokeCheckStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const harnessSetupSmokeCheckResultSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    status: harnessSetupSmokeCheckStatusSchema,
    summary: z.string().trim().min(1).max(1000),
  })
  .strict();

export const harnessSetupSmokeResponseSchema = z
  .object({
    workflowKind: z.literal("setup_smoke"),
    harnessKind: z.string().trim().min(1),
    status: harnessSetupSmokeStatusSchema,
    message: z.string().trim().min(1).max(2000),
    checks: z.array(harnessSetupSmokeCheckResultSchema).max(20),
    diagnostics: z.array(z.string().trim().min(1).max(1000)).max(20),
  })
  .strict();

export type HarnessSkillMode = z.infer<typeof harnessSkillModeSchema>;
export type HarnessModelCatalogSource = z.infer<typeof harnessModelCatalogSourceSchema>;
export type HarnessModelReasoningLevel = z.infer<typeof harnessModelReasoningLevelSchema>;
export type HarnessModelCatalogModel = z.infer<typeof harnessModelCatalogModelSchema>;
export type HarnessModelCatalog = z.infer<typeof harnessModelCatalogSchema>;
export type HarnessMcpExpectation = z.infer<typeof harnessMcpExpectationSchema>;
export type HarnessSmokeTestMode = z.infer<typeof harnessSmokeTestModeSchema>;
export type HarnessCliInstallStatus = z.infer<typeof harnessCliInstallStatusSchema>;
export type HarnessSkillPackageStatus = z.infer<typeof harnessSkillPackageStatusSchema>;
export type HarnessMcpSetupStatus = z.infer<typeof harnessMcpSetupStatusSchema>;
export type HarnessSetupSmokeStatus = z.infer<typeof harnessSetupSmokeStatusSchema>;
export type HarnessCliDescriptor = z.infer<typeof harnessCliDescriptorSchema>;
export type HarnessSkillSupportDescriptor = z.infer<typeof harnessSkillSupportDescriptorSchema>;
export type HarnessMcpExpectationDescriptor = z.infer<typeof harnessMcpExpectationDescriptorSchema>;
export type HarnessSmokeTestSupportDescriptor = z.infer<
  typeof harnessSmokeTestSupportDescriptorSchema
>;
export type HarnessWorkflow = z.infer<typeof harnessWorkflowSchema>;
export type HarnessRuntimeMode = z.infer<typeof harnessRuntimeModeSchema>;
export type HarnessRepositoryAccessMode = z.infer<typeof harnessRepositoryAccessModeSchema>;
export type HarnessRepositoryWorkspaceStrategy = z.infer<
  typeof harnessRepositoryWorkspaceStrategySchema
>;
export type HarnessRepositoryAccess = z.infer<typeof harnessRepositoryAccessSchema>;
export type HarnessProfileSettings = z.infer<typeof harnessProfileSettingsSchema>;
export type HarnessKindDescriptor = z.infer<typeof harnessKindDescriptorSchema>;
export type HarnessMcpServerConfig = z.infer<typeof harnessMcpServerConfigSchema>;
export type HarnessOutputCaptureMode = z.infer<typeof harnessOutputCaptureModeSchema>;
export type HarnessRunStatus = z.infer<typeof harnessRunStatusSchema>;
export type HarnessRunProfile = z.infer<typeof harnessRunProfileSchema>;
export type HarnessRunRequest = z.input<typeof harnessRunRequestSchema>;
export type HarnessStreamEventKind = z.infer<typeof harnessStreamEventKindSchema>;
export type HarnessStreamingCapability = z.infer<typeof harnessStreamingCapabilitySchema>;
export type HarnessStreamEvent = z.infer<typeof harnessStreamEventSchema>;
export type HarnessExecutionMetadata = z.infer<typeof harnessExecutionMetadataSchema>;
export type HarnessRunResponse = z.infer<typeof harnessRunResponseSchema>;
export type HarnessRunJobStatus = z.infer<typeof harnessRunJobStatusSchema>;
export type HarnessRunJob = z.infer<typeof harnessRunJobSchema>;
export type HarnessRunJobCreateResponse = z.infer<typeof harnessRunJobCreateResponseSchema>;
export type HarnessRunJobEventsResponse = z.infer<typeof harnessRunJobEventsResponseSchema>;
export type HarnessBridgeAvailableKind = z.infer<typeof harnessBridgeAvailableKindSchema>;
export type HarnessBridgeCapability = z.infer<typeof harnessBridgeCapabilitySchema>;
export type HarnessBridgeHealthResponse = z.infer<typeof harnessBridgeHealthResponseSchema>;
export type HarnessDetectedCli = z.infer<typeof harnessDetectedCliSchema>;
export type HarnessBridgeDetectionResponse = z.infer<typeof harnessBridgeDetectionResponseSchema>;
export type HarnessBridgeSmokeRecordResponse = z.infer<
  typeof harnessBridgeSmokeRecordResponseSchema
>;
export type HarnessStatusAvailableKind = z.infer<typeof harnessStatusAvailableKindSchema>;
export type HarnessLocalCliStatus = z.infer<typeof harnessLocalCliStatusSchema>;
export type HarnessBridgeKindStatus = z.infer<typeof harnessBridgeKindStatusSchema>;
export type HarnessSkillStatusDetail = z.infer<typeof harnessSkillStatusDetailSchema>;
export type HarnessMcpSetupStatusDetail = z.infer<typeof harnessMcpSetupStatusDetailSchema>;
export type HarnessKindSetupStatus = z.infer<typeof harnessKindSetupStatusSchema>;
export type HarnessStatusResponse = z.infer<typeof harnessStatusResponseSchema>;
export type HarnessSkillCheckResponse = z.infer<typeof harnessSkillCheckResponseSchema>;
export type HarnessSkillInstallResponse = z.infer<typeof harnessSkillInstallResponseSchema>;
export type HarnessSetupSmokeCheckStatus = z.infer<typeof harnessSetupSmokeCheckStatusSchema>;
export type HarnessSetupSmokeCheckResult = z.infer<typeof harnessSetupSmokeCheckResultSchema>;
export type HarnessSetupSmokeResponse = z.infer<typeof harnessSetupSmokeResponseSchema>;

function cloneHarnessKindDescriptor(descriptor: HarnessKindDescriptor): HarnessKindDescriptor {
  return {
    ...descriptor,
    cli: {
      ...descriptor.cli,
      commands: [...descriptor.cli.commands],
      versionArgs: [...descriptor.cli.versionArgs],
    },
    skillSupport: { ...descriptor.skillSupport },
    mcp: { ...descriptor.mcp },
    smokeTest: { ...descriptor.smokeTest },
    supportedWorkflows: [...descriptor.supportedWorkflows],
  };
}
