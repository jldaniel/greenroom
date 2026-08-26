import * as z from "zod";

import { builtinReviewFindingSchema } from "./builtin-review";
import { diffFileStatusSchema } from "./diffs";
import { gitShaSchema, idSchema, relativePathSchema, timestampSchema } from "./primitives";
import { profileIdSchema, profileWorkflowTypeSchema, providerKindSchema } from "./profiles";
import { reviewDisplayIdSchema, revisionIdSchema } from "./reviews";
import { structuredTeachingOutputSchema } from "./teaching";

export const workflowRunIdSchema = idSchema.refine((value) => value.startsWith("workflow_run_"), {
  message: "Workflow run IDs must use the workflow_run_ prefix",
});

export const workflowRunEventIdSchema = idSchema.refine(
  (value) => value.startsWith("workflow_event_"),
  {
    message: "Workflow event IDs must use the workflow_event_ prefix",
  },
);

export const workflowKindSchema = z.enum([
  "builtin_review",
  "spotlight_plan",
  "spotlight_membership",
  "spotlight_refine",
  "teaching_generate",
  "teaching_follow_up",
  "setup_smoke",
]);

export const workflowRunStatusSchema = z.enum([
  "pending_consent",
  "queued",
  "running",
  "awaiting_user",
  "repairing",
  "completed",
  "failed",
  "cancelled",
]);

export const workflowRunPhaseSchema = z.enum([
  "pending_consent",
  "queued",
  "launching_harness",
  "reading_context",
  "drafting",
  "validating",
  "repairing",
  "persisting",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled",
]);

export const workflowRunEventTypeSchema = z.enum([
  "lifecycle",
  "harness_launch",
  "harness_progress",
  "mcp_resource_read",
  "draft_submission",
  "validation",
  "repair_attempt",
  "persistence",
  "failure",
]);

export const workflowRunEventSeveritySchema = z.enum(["debug", "info", "warning", "error"]);

export const workflowHarnessKindSchema = z.string().trim().min(1).max(120);

export const workflowMcpCapabilitySchema = z.enum([
  "review:read",
  "revision:read",
  "diff:read",
  "threads:read",
  "spotlight:read",
  "teaching:read",
  "draft:submit",
  "validation:read",
  "trace:write",
]);

export const workflowExpectedOutputModeSchema = z.enum([
  "builtin_review_findings",
  "spotlight_outline",
  "spotlight_membership",
  "teaching_draft",
  "teaching_follow_up_answer",
  "setup_smoke_report",
]);

export const workflowTracingStatusSchema = z.enum(["disabled", "redacted"]);
export const workflowRepositoryAccessModeSchema = z.enum(["mcp_only", "snapshot_readonly"]);
export const workflowRepositoryWorkspaceStrategySchema = z.enum(["git_archive", "git_worktree"]);

export const workflowDefaultRepositoryAccessSummary = {
  mode: "mcp_only",
  readScopeLabel: "Greenroom MCP context only",
  revisionId: null,
  baseSha: null,
  headSha: null,
  workspaceStrategy: null,
} as const;

export const workflowRedactedMetadataSchema = z
  .record(z.string().trim().min(1).max(80), z.unknown())
  .default({})
  .superRefine((value, context) => {
    const serialized = JSON.stringify(value);

    if (serialized.length > 32_000) {
      context.addIssue({
        code: "custom",
        message: "Workflow metadata must stay below 32KB",
      });
    }

    for (const key of Object.keys(value)) {
      if (/(api[_-]?key|authorization|credential|password|secret|token)/iu.test(key)) {
        context.addIssue({
          code: "custom",
          message: "Workflow metadata cannot persist credential-like keys",
          path: [key],
        });
      }
    }
  });

export const workflowChangedFileSummaryEntrySchema = z
  .object({
    path: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    status: diffFileStatusSchema,
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    isBinary: z.boolean().default(false),
  })
  .strict();

export const workflowChangedFileSummarySchema = z
  .object({
    fileCount: z.number().int().min(0),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    binaryFileCount: z.number().int().min(0),
    renameCount: z.number().int().min(0),
    files: z.array(workflowChangedFileSummaryEntrySchema).max(250).default([]),
    omittedFileCount: z.number().int().min(0).default(0),
  })
  .strict();

export const workflowConsentProfileSummarySchema = z
  .object({
    id: profileIdSchema,
    name: z.string().trim().min(1).max(160),
    workflowType: profileWorkflowTypeSchema,
    provider: providerKindSchema,
    model: z.string().trim().min(1).max(160),
  })
  .strict();

export const workflowRepositoryAccessSummarySchema = z
  .object({
    mode: workflowRepositoryAccessModeSchema,
    readScopeLabel: z.string().trim().min(1).max(400),
    revisionId: revisionIdSchema.nullable().default(null),
    baseSha: gitShaSchema.nullable().default(null),
    headSha: gitShaSchema.nullable().default(null),
    workspaceStrategy: workflowRepositoryWorkspaceStrategySchema.nullable().default(null),
  })
  .strict()
  .default(workflowDefaultRepositoryAccessSummary)
  .superRefine((value, context) => {
    if (value.mode !== "snapshot_readonly") {
      return;
    }

    if (value.revisionId === null) {
      context.addIssue({
        code: "custom",
        message: "Snapshot repository access requires a revision id",
        path: ["revisionId"],
      });
    }

    if (value.headSha === null) {
      context.addIssue({
        code: "custom",
        message: "Snapshot repository access requires a committed head SHA",
        path: ["headSha"],
      });
    }

    if (value.baseSha === null) {
      context.addIssue({
        code: "custom",
        message: "Snapshot repository access requires a base SHA",
        path: ["baseSha"],
      });
    }

    if (value.workspaceStrategy === null) {
      context.addIssue({
        code: "custom",
        message: "Snapshot repository access requires a workspace strategy",
        path: ["workspaceStrategy"],
      });
    }
  });

export const workflowConsentSummarySchema = z
  .object({
    workflowKind: workflowKindSchema,
    selectedHarness: workflowHarnessKindSchema,
    profile: workflowConsentProfileSummarySchema,
    reviewDisplayId: reviewDisplayIdSchema,
    revisionId: revisionIdSchema,
    scopeLabel: z.string().trim().min(1).max(240),
    changedFiles: workflowChangedFileSummarySchema,
    allowedMcpCapabilities: z.array(workflowMcpCapabilitySchema).max(40).default([]),
    expectedMcpResources: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
    expectedOutputMode: workflowExpectedOutputModeSchema,
    repositoryAccess: workflowRepositoryAccessSummarySchema,
    threadCreationGate: z
      .object({
        mode: z.enum(["draft_approval_required", "auto_create_after_validation"]),
        autoCreateThreads: z.boolean(),
        reason: z.string().trim().min(1).max(400),
      })
      .strict()
      .nullable()
      .default(null),
    tracingStatus: workflowTracingStatusSchema.default("disabled"),
  })
  .strict();

export const workflowApprovedScopeSchema = z
  .object({
    label: z.string().trim().min(1).max(240),
    revisionId: revisionIdSchema,
    filePaths: z.array(relativePathSchema).max(500).default([]),
    changedFiles: workflowChangedFileSummarySchema,
    metadata: workflowRedactedMetadataSchema,
  })
  .strict();

export const workflowAnchorKeySchema = z.string().trim().min(1).max(240);

export const workflowBuiltinReviewDraftOutputSchema = z
  .object({
    kind: z.literal("builtin_review_findings"),
    summary: z.string().trim().min(1).max(8000),
    findings: z.array(builtinReviewFindingSchema).max(50),
    nonFindings: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  })
  .strict();

export const workflowSpotlightOutlineItemSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    intent: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(1000),
    rationale: z.string().trim().min(1).max(2000).nullable().default(null),
    anchorKeyHints: z.array(workflowAnchorKeySchema).max(200).default([]),
  })
  .strict();

export const workflowSpotlightOutlineDraftOutputSchema = z
  .object({
    kind: z.literal("spotlight_outline"),
    views: z.array(workflowSpotlightOutlineItemSchema).min(1).max(40),
  })
  .strict();

export const workflowSpotlightMembershipItemSchema = z
  .object({
    viewKey: z.string().trim().min(1).max(80),
    anchorKeys: z.array(workflowAnchorKeySchema).max(500).default([]),
    filePaths: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
    rationale: z.string().trim().min(1).max(2000).nullable().default(null),
  })
  .strict();

export const workflowSpotlightMembershipDraftOutputSchema = z
  .object({
    kind: z.literal("spotlight_membership"),
    memberships: z.array(workflowSpotlightMembershipItemSchema).max(100),
    uncoveredAnchorKeys: z.array(workflowAnchorKeySchema).max(500).default([]),
    uncoveredFiles: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  })
  .strict();

export const workflowTeachingDraftOutputSchema = structuredTeachingOutputSchema.extend({
  kind: z.literal("teaching_draft"),
});

export const workflowTeachingFollowUpAnswerOutputSchema = z
  .object({
    kind: z.literal("teaching_follow_up_answer"),
    answer: z.string().trim().min(1).max(16_000),
  })
  .strict();

export const workflowSetupSmokeCheckSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    status: z.enum(["passed", "failed", "skipped"]),
    summary: z.string().trim().min(1).max(1000),
  })
  .strict();

export const workflowSetupSmokeDraftOutputSchema = z
  .object({
    kind: z.literal("setup_smoke_report"),
    status: z.enum(["passed", "failed"]),
    checks: z.array(workflowSetupSmokeCheckSchema).max(50),
  })
  .strict();

export const workflowDraftOutputSchema = z.discriminatedUnion("kind", [
  workflowBuiltinReviewDraftOutputSchema,
  workflowSpotlightOutlineDraftOutputSchema,
  workflowSpotlightMembershipDraftOutputSchema,
  workflowTeachingDraftOutputSchema,
  workflowTeachingFollowUpAnswerOutputSchema,
  workflowSetupSmokeDraftOutputSchema,
]);

export const workflowFinalOutputSchema = workflowDraftOutputSchema;

export const workflowValidationIssueSeveritySchema = z.enum(["info", "warning", "error"]);

export const workflowValidationIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000),
    severity: workflowValidationIssueSeveritySchema.default("error"),
    path: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    recoverable: z.boolean().default(true),
    metadata: workflowRedactedMetadataSchema,
  })
  .strict();

export const workflowRepairPromptMetadataSchema = z
  .object({
    attemptNumber: z.number().int().min(1).max(20),
    issueCodes: z.array(z.string().trim().min(1).max(80)).max(100),
    promptSummary: z.string().trim().min(1).max(2000),
    createdAt: timestampSchema,
    metadata: workflowRedactedMetadataSchema,
  })
  .strict();

export const workflowRunRepairAttemptRecordSchema = z
  .object({
    attemptNumber: z.number().int().min(1).max(20),
    issueCodes: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
    createdAt: timestampSchema,
  })
  .strict();

export const workflowRunRepairProgressSchema = z
  .object({
    attemptNumber: z.number().int().min(1).max(20),
    maxAttempts: z.number().int().min(1).max(20),
    attempts: z.array(workflowRunRepairAttemptRecordSchema).max(20).default([]),
  })
  .strict();

/**
 * Derives "repair attempt N of M" progress from persisted run metadata. The
 * orchestrator records `repairAttemptCount`, `maxRepairAttempts`, and the
 * per-attempt `repairAttempts` history whenever a repair attempt starts, so
 * run detail/status responses expose repair progress without a new endpoint.
 * Runs that never entered the repair loop return `null`.
 */
export function workflowRunRepairProgressFromMetadata(
  metadata: WorkflowRedactedMetadata,
): WorkflowRunRepairProgress | null {
  const attemptNumber = repairAttemptCountValue(metadata.repairAttemptCount);
  const maxAttempts = repairAttemptCountValue(metadata.maxRepairAttempts);

  if (attemptNumber === null || maxAttempts === null) {
    return null;
  }

  const attempts = Array.isArray(metadata.repairAttempts)
    ? metadata.repairAttempts.flatMap((entry) => {
        const parsed = workflowRunRepairAttemptRecordSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

  return { attemptNumber, maxAttempts, attempts };
}

function repairAttemptCountValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : null;
}

const allowedWorkflowRunStatusTransitions = {
  pending_consent: ["pending_consent", "queued", "cancelled"],
  queued: ["queued", "running", "failed", "cancelled"],
  running: ["running", "awaiting_user", "repairing", "completed", "failed", "cancelled"],
  awaiting_user: [
    "awaiting_user",
    "queued",
    "running",
    "repairing",
    "completed",
    "failed",
    "cancelled",
  ],
  repairing: [
    "repairing",
    "queued",
    "running",
    "awaiting_user",
    "completed",
    "failed",
    "cancelled",
  ],
  completed: ["completed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
} as const satisfies Record<
  z.infer<typeof workflowRunStatusSchema>,
  readonly z.infer<typeof workflowRunStatusSchema>[]
>;

export const workflowRunStatusTransitionSchema = z
  .object({
    from: workflowRunStatusSchema,
    to: workflowRunStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (isWorkflowRunStatusTransitionAllowed(value.from, value.to)) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: `Workflow status cannot transition from ${value.from} to ${value.to}`,
      path: ["to"],
    });
  });

const workflowRunCreateInputBaseSchema = z
  .object({
    workflowKind: workflowKindSchema,
    revisionId: revisionIdSchema,
    profileId: profileIdSchema,
    harnessKind: workflowHarnessKindSchema,
    status: workflowRunStatusSchema.default("pending_consent"),
    phase: workflowRunPhaseSchema.optional(),
    consentSummary: workflowConsentSummarySchema,
    approvedScope: workflowApprovedScopeSchema.nullable().default(null),
    metadata: workflowRedactedMetadataSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.consentSummary.workflowKind !== value.workflowKind) {
      context.addIssue({
        code: "custom",
        message: "Consent summary workflow kind must match the run workflow kind",
        path: ["consentSummary", "workflowKind"],
      });
    }

    if (value.consentSummary.revisionId !== value.revisionId) {
      context.addIssue({
        code: "custom",
        message: "Consent summary revision id must match the run revision id",
        path: ["consentSummary", "revisionId"],
      });
    }

    if (value.consentSummary.profile.id !== value.profileId) {
      context.addIssue({
        code: "custom",
        message: "Consent summary profile id must match the run profile id",
        path: ["consentSummary", "profile", "id"],
      });
    }

    if (value.consentSummary.selectedHarness !== value.harnessKind) {
      context.addIssue({
        code: "custom",
        message: "Consent summary selected harness must match the run harness kind",
        path: ["consentSummary", "selectedHarness"],
      });
    }
  });

export const workflowRunCreateInputSchema = workflowRunCreateInputBaseSchema.transform((value) => ({
  ...value,
  phase: value.phase ?? defaultWorkflowRunPhaseForStatus(value.status),
}));
export const workflowRunStatusUpdateInputSchema = z
  .object({
    status: workflowRunStatusSchema,
    phase: workflowRunPhaseSchema.optional(),
    errorMessage: z.string().trim().min(1).max(4000).nullable().optional(),
    metadata: workflowRedactedMetadataSchema.optional(),
  })
  .strict();

export const workflowRunSchema = z.object({
  id: workflowRunIdSchema,
  workflowKind: workflowKindSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  revisionId: revisionIdSchema,
  profileId: profileIdSchema,
  harnessKind: workflowHarnessKindSchema,
  status: workflowRunStatusSchema,
  phase: workflowRunPhaseSchema,
  consentSummary: workflowConsentSummarySchema,
  approvedScope: workflowApprovedScopeSchema.nullable(),
  draftOutput: workflowDraftOutputSchema.nullable(),
  finalOutput: workflowFinalOutputSchema.nullable(),
  validationIssues: z.array(workflowValidationIssueSchema).max(200),
  errorMessage: z.string().trim().min(1).max(4000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  queuedAt: timestampSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  metadata: workflowRedactedMetadataSchema,
});

export const workflowRunEventCreateInputSchema = z
  .object({
    runId: workflowRunIdSchema,
    eventType: workflowRunEventTypeSchema,
    summary: z.string().trim().min(1).max(2000),
    severity: workflowRunEventSeveritySchema.default("info"),
    metadata: workflowRedactedMetadataSchema,
  })
  .strict();

export const workflowRunEventSchema = z.object({
  id: workflowRunEventIdSchema,
  runId: workflowRunIdSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  sequenceNumber: z.number().int().min(1),
  eventType: workflowRunEventTypeSchema,
  summary: z.string().trim().min(1).max(2000),
  severity: workflowRunEventSeveritySchema,
  timestamp: timestampSchema,
  metadata: workflowRedactedMetadataSchema,
});

export function isWorkflowRunStatusTransitionAllowed(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus,
): boolean {
  return (allowedWorkflowRunStatusTransitions[from] as readonly WorkflowRunStatus[]).includes(to);
}

export function defaultWorkflowRunPhaseForStatus(status: WorkflowRunStatus): WorkflowRunPhase {
  switch (status) {
    case "pending_consent":
      return "pending_consent";
    case "queued":
      return "queued";
    case "running":
      return "launching_harness";
    case "awaiting_user":
      return "awaiting_user";
    case "repairing":
      return "repairing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export type WorkflowRunId = z.infer<typeof workflowRunIdSchema>;
export type WorkflowRunEventId = z.infer<typeof workflowRunEventIdSchema>;
export type WorkflowKind = z.infer<typeof workflowKindSchema>;
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;
export type WorkflowRunPhase = z.infer<typeof workflowRunPhaseSchema>;
export type WorkflowRunEventType = z.infer<typeof workflowRunEventTypeSchema>;
export type WorkflowRunEventSeverity = z.infer<typeof workflowRunEventSeveritySchema>;
export type WorkflowHarnessKind = z.infer<typeof workflowHarnessKindSchema>;
export type WorkflowMcpCapability = z.infer<typeof workflowMcpCapabilitySchema>;
export type WorkflowExpectedOutputMode = z.infer<typeof workflowExpectedOutputModeSchema>;
export type WorkflowTracingStatus = z.infer<typeof workflowTracingStatusSchema>;
export type WorkflowRepositoryAccessMode = z.infer<typeof workflowRepositoryAccessModeSchema>;
export type WorkflowRepositoryWorkspaceStrategy = z.infer<
  typeof workflowRepositoryWorkspaceStrategySchema
>;
export type WorkflowRedactedMetadata = z.infer<typeof workflowRedactedMetadataSchema>;
export type WorkflowChangedFileSummaryEntry = z.infer<typeof workflowChangedFileSummaryEntrySchema>;
export type WorkflowChangedFileSummary = z.infer<typeof workflowChangedFileSummarySchema>;
export type WorkflowConsentProfileSummary = z.infer<typeof workflowConsentProfileSummarySchema>;
export type WorkflowRepositoryAccessSummary = z.infer<typeof workflowRepositoryAccessSummarySchema>;
export type WorkflowConsentSummary = z.infer<typeof workflowConsentSummarySchema>;
export type WorkflowApprovedScope = z.infer<typeof workflowApprovedScopeSchema>;
export type WorkflowAnchorKey = z.infer<typeof workflowAnchorKeySchema>;
export type WorkflowBuiltinReviewDraftOutput = z.infer<
  typeof workflowBuiltinReviewDraftOutputSchema
>;
export type WorkflowSpotlightOutlineItem = z.infer<typeof workflowSpotlightOutlineItemSchema>;
export type WorkflowSpotlightOutlineDraftOutput = z.infer<
  typeof workflowSpotlightOutlineDraftOutputSchema
>;
export type WorkflowSpotlightMembershipItem = z.infer<typeof workflowSpotlightMembershipItemSchema>;
export type WorkflowSpotlightMembershipDraftOutput = z.infer<
  typeof workflowSpotlightMembershipDraftOutputSchema
>;
export type WorkflowTeachingDraftOutput = z.infer<typeof workflowTeachingDraftOutputSchema>;
export type WorkflowTeachingFollowUpAnswerOutput = z.infer<
  typeof workflowTeachingFollowUpAnswerOutputSchema
>;
export type WorkflowSetupSmokeCheck = z.infer<typeof workflowSetupSmokeCheckSchema>;
export type WorkflowSetupSmokeDraftOutput = z.infer<typeof workflowSetupSmokeDraftOutputSchema>;
export type WorkflowDraftOutput = z.infer<typeof workflowDraftOutputSchema>;
export type WorkflowFinalOutput = z.infer<typeof workflowFinalOutputSchema>;
export type WorkflowValidationIssueSeverity = z.infer<typeof workflowValidationIssueSeveritySchema>;
export type WorkflowValidationIssue = z.infer<typeof workflowValidationIssueSchema>;
export type WorkflowRepairPromptMetadata = z.infer<typeof workflowRepairPromptMetadataSchema>;
export type WorkflowRunRepairAttemptRecord = z.infer<typeof workflowRunRepairAttemptRecordSchema>;
export type WorkflowRunRepairProgress = z.infer<typeof workflowRunRepairProgressSchema>;
export type WorkflowRunCreateInput = z.input<typeof workflowRunCreateInputSchema>;
export type WorkflowRunStatusUpdateInput = z.input<typeof workflowRunStatusUpdateInputSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowRunEventCreateInput = z.input<typeof workflowRunEventCreateInputSchema>;
export type WorkflowRunEvent = z.infer<typeof workflowRunEventSchema>;
