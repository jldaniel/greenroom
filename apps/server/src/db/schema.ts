import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type {
  AgentEventSource,
  CapabilityScope,
  DiffLine,
  DiffSummary,
  ProfilePrivacy,
  RenameMetadata,
  ReviewRange,
  SpotlightAutoGenerationConfig,
  SpotlightApprovedOutline,
  ThreadAnchor,
  ThreadSource,
  HarnessStreamEvent,
  WorkflowApprovedScope,
  WorkflowConsentSummary,
  WorkflowDraftOutput,
  WorkflowFinalOutput,
  WorkflowKind,
  WorkflowRedactedMetadata,
  WorkflowRunEventSeverity,
  WorkflowRunEventType,
  WorkflowRunPhase,
  WorkflowRunStatus,
  WorkflowValidationIssue,
  WorktreeFingerprint,
} from "@greenroom/schemas";

export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    rootPath: text("root_path").notNull(),
    gitCommonDir: text("git_common_dir").notNull(),
    identityKey: text("identity_key").notNull(),
    displayName: text("display_name").notNull(),
    defaultBranchCandidate: text("default_branch_candidate"),
    spotlightConfig: text("spotlight_config", { mode: "json" })
      .$type<SpotlightAutoGenerationConfig>()
      .notNull(),
    lastOpenedAt: text("last_opened_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("repositories_identity_key_unique").on(table.identityKey),
    index("repositories_updated_at_idx").on(table.updatedAt),
  ],
);

export const reviewPrs = sqliteTable(
  "review_prs",
  {
    id: text("id").primaryKey(),
    displayId: text("display_id").notNull(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    range: text("range", { mode: "json" }).$type<ReviewRange>().notNull(),
    baseRefDisplay: text("base_ref_display").notNull(),
    headRefDisplay: text("head_ref_display").notNull(),
    currentRevisionId: text("current_revision_id"),
    status: text("status").notNull(),
    spotlightConfig: text("spotlight_config", { mode: "json" })
      .$type<SpotlightAutoGenerationConfig>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_prs_display_id_unique").on(table.displayId),
    index("review_prs_repository_id_idx").on(table.repositoryId),
    index("review_prs_updated_at_idx").on(table.updatedAt),
  ],
);

export const reviewRevisions = sqliteTable(
  "review_revisions",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha"),
    worktreeFingerprint: text("worktree_fingerprint", {
      mode: "json",
    }).$type<WorktreeFingerprint>(),
    diffSummary: text("diff_summary", { mode: "json" }).$type<DiffSummary>().notNull(),
    refreshReason: text("refresh_reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("review_revisions_review_id_idx").on(table.reviewId),
    index("review_revisions_created_at_idx").on(table.createdAt),
  ],
);

export const diffFiles = sqliteTable(
  "diff_files",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => reviewRevisions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    oldPath: text("old_path"),
    status: text("status").notNull(),
    isBinary: integer("is_binary", { mode: "boolean" }).notNull(),
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    oldMode: text("old_mode"),
    newMode: text("new_mode"),
    renameMetadata: text("rename_metadata", { mode: "json" }).$type<RenameMetadata>(),
  },
  (table) => [
    index("diff_files_revision_id_idx").on(table.revisionId),
    index("diff_files_path_idx").on(table.path),
  ],
);

export const diffHunks = sqliteTable(
  "diff_hunks",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => diffFiles.id, { onDelete: "cascade" }),
    oldStart: integer("old_start").notNull(),
    oldLines: integer("old_lines").notNull(),
    newStart: integer("new_start").notNull(),
    newLines: integer("new_lines").notNull(),
    header: text("header").notNull(),
    lines: text("lines", { mode: "json" }).$type<DiffLine[]>().notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("diff_hunks_file_id_idx").on(table.fileId),
    index("diff_hunks_sort_order_idx").on(table.fileId, table.sortOrder),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    shortRef: text("short_ref").notNull(),
    status: text("status").notNull(),
    type: text("type").notNull(),
    severity: text("severity"),
    source: text("source", { mode: "json" }).$type<ThreadSource>().notNull(),
    anchor: text("anchor", { mode: "json" }).$type<ThreadAnchor>().notNull(),
    anchors: text("anchors", { mode: "json" }).$type<ThreadAnchor[]>().notNull(),
    remapConfidence: real("remap_confidence"),
    outdated: integer("outdated", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("threads_short_ref_unique").on(table.shortRef),
    index("threads_review_status_idx").on(table.reviewId, table.status),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    parentCommentId: text("parent_comment_id"),
    authorKind: text("author_kind").notNull(),
    authorDisplayName: text("author_display_name").notNull(),
    body: text("body").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
    editedAt: text("edited_at"),
  },
  (table) => [
    index("comments_thread_id_idx").on(table.threadId),
    index("comments_sort_order_idx").on(table.threadId, table.sortOrder),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    workflowType: text("workflow_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt"),
    modelSettings: text("model_settings", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    allowedTools: text("allowed_tools", { mode: "json" }).$type<string[]>().notNull(),
    contextPreferences: text("context_preferences", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    privacy: text("privacy", { mode: "json" }).$type<ProfilePrivacy>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("profiles_name_unique").on(table.name)],
);

export const spotlightRuns = sqliteTable(
  "spotlight_runs",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    trigger: text("trigger").notNull(),
    gated: integer("gated", { mode: "boolean" }).notNull(),
    status: text("status").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => reviewRevisions.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    approvedOutline: text("approved_outline", { mode: "json" }).$type<SpotlightApprovedOutline>(),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("spotlight_runs_review_id_idx").on(table.reviewId),
    index("spotlight_runs_review_status_idx").on(table.reviewId, table.status),
    index("spotlight_runs_created_at_idx").on(table.createdAt),
  ],
);

export const spotlightViews = sqliteTable(
  "spotlight_views",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    displayRef: text("display_ref").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    intent: text("intent").notNull(),
    orderIndex: integer("order_index").notNull(),
    health: text("health").notNull(),
    originRunId: text("origin_run_id")
      .notNull()
      .references(() => spotlightRuns.id, { onDelete: "cascade" }),
    lastReconciledRevisionId: text("last_reconciled_revision_id")
      .notNull()
      .references(() => reviewRevisions.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("spotlight_views_display_ref_unique").on(table.displayRef),
    index("spotlight_views_review_id_idx").on(table.reviewId),
    index("spotlight_views_review_order_idx").on(table.reviewId, table.orderIndex),
    index("spotlight_views_origin_run_id_idx").on(table.originRunId),
  ],
);

export const spotlightViewRegions = sqliteTable(
  "spotlight_view_regions",
  {
    id: text("id").primaryKey(),
    viewId: text("view_id")
      .notNull()
      .references(() => spotlightViews.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    oldPath: text("old_path"),
    anchors: text("anchors", { mode: "json" }).$type<ThreadAnchor[]>().notNull(),
    remapConfidence: real("remap_confidence"),
    stale: integer("stale", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("spotlight_view_regions_view_id_idx").on(table.viewId),
    index("spotlight_view_regions_file_path_idx").on(table.filePath),
  ],
);

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowKind: text("workflow_kind").$type<WorkflowKind>().notNull(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => reviewRevisions.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    harnessKind: text("harness_kind").notNull(),
    status: text("status").$type<WorkflowRunStatus>().notNull(),
    phase: text("phase").$type<WorkflowRunPhase>().notNull(),
    consentSummary: text("consent_summary", { mode: "json" })
      .$type<WorkflowConsentSummary>()
      .notNull(),
    approvedScope: text("approved_scope", { mode: "json" }).$type<WorkflowApprovedScope>(),
    draftOutput: text("draft_output", { mode: "json" }).$type<WorkflowDraftOutput>(),
    finalOutput: text("final_output", { mode: "json" }).$type<WorkflowFinalOutput>(),
    validationIssues: text("validation_issues", { mode: "json" })
      .$type<WorkflowValidationIssue[]>()
      .notNull(),
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }).$type<WorkflowRedactedMetadata>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    queuedAt: text("queued_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    completedAt: text("completed_at"),
    cancelledAt: text("cancelled_at"),
  },
  (table) => [
    index("workflow_runs_review_id_idx").on(table.reviewId),
    index("workflow_runs_review_status_idx").on(table.reviewId, table.status),
    index("workflow_runs_status_idx").on(table.status),
    index("workflow_runs_created_at_idx").on(table.createdAt),
  ],
);

export const workflowRunEvents = sqliteTable(
  "workflow_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviewPrs.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    eventType: text("event_type").$type<WorkflowRunEventType>().notNull(),
    summary: text("summary").notNull(),
    severity: text("severity").$type<WorkflowRunEventSeverity>().notNull(),
    timestamp: text("timestamp").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<WorkflowRedactedMetadata>().notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_events_run_sequence_unique").on(table.runId, table.sequenceNumber),
    index("workflow_run_events_run_id_idx").on(table.runId),
    index("workflow_run_events_review_id_idx").on(table.reviewId),
    index("workflow_run_events_timestamp_idx").on(table.timestamp),
  ],
);

export const workflowRunTranscripts = sqliteTable(
  "workflow_run_transcripts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    profileId: text("profile_id"),
    workflowKind: text("workflow_kind").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    prompt: text("prompt").notNull(),
    output: text("output"),
    stderr: text("stderr").notNull(),
    redacted: integer("redacted", { mode: "boolean" }).notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull(),
    promptBytes: integer("prompt_bytes").notNull(),
    outputBytes: integer("output_bytes").notNull(),
    stderrBytes: integer("stderr_bytes").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("workflow_run_transcripts_run_id_idx").on(table.runId),
    index("workflow_run_transcripts_created_at_idx").on(table.createdAt),
  ],
);

export const workflowRunHarnessEvents = sqliteTable(
  "workflow_run_harness_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    profileId: text("profile_id"),
    workflowKind: text("workflow_kind").notNull(),
    attempt: integer("attempt").notNull().default(0),
    sequenceNumber: integer("sequence_number").notNull(),
    event: text("event", { mode: "json" }).$type<HarnessStreamEvent>().notNull(),
    redacted: integer("redacted", { mode: "boolean" }).notNull().default(true),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    totalBytes: integer("total_bytes").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_harness_events_run_sequence_unique").on(
      table.runId,
      table.sequenceNumber,
    ),
    index("workflow_run_harness_events_run_id_idx").on(table.runId),
    index("workflow_run_harness_events_created_at_idx").on(table.createdAt),
  ],
);

export const capabilityTokens = sqliteTable(
  "capability_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<CapabilityScope[]>().notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    expiresAt: text("expires_at"),
  },
  (table) => [
    uniqueIndex("capability_tokens_token_hash_unique").on(table.tokenHash),
    index("capability_tokens_revoked_at_idx").on(table.revokedAt),
    index("capability_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export const refCounters = sqliteTable("ref_counters", {
  scope: text("scope").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id").references(() => reviewPrs.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    source: text("source", { mode: "json" }).$type<AgentEventSource>().notNull(),
    threadRefs: text("thread_refs", { mode: "json" }).$type<string[]>().notNull(),
    summary: text("summary").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("agent_events_review_id_idx").on(table.reviewId),
    index("agent_events_created_at_idx").on(table.createdAt),
  ],
);

export const storageSchema = {
  repositories,
  reviewPrs,
  reviewRevisions,
  diffFiles,
  diffHunks,
  threads,
  comments,
  profiles,
  spotlightRuns,
  spotlightViews,
  spotlightViewRegions,
  workflowRuns,
  workflowRunEvents,
  workflowRunTranscripts,
  capabilityTokens,
  refCounters,
  agentEvents,
};
