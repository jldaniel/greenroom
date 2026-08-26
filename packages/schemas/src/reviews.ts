import * as z from "zod";

import { gitRefSchema, gitShaSchema, idSchema, timestampSchema } from "./primitives";
import { repositoryIdSchema, spotlightAutoGenerationConfigSchema } from "./repositories";

export const reviewPrIdSchema = idSchema.refine((value) => value.startsWith("review_"), {
  message: "Review IDs must use the review_ prefix",
});

export const reviewDisplayIdSchema = z
  .string()
  .trim()
  .regex(/^GR-[1-9]\d*$/u, "Review display IDs must look like GR-12");

/**
 * The only externally-accepted way to address a review. Kept as a named
 * alias of the display-id schema so API surfaces read as "reference".
 */
export const reviewReferenceSchema = reviewDisplayIdSchema;

export const revisionIdSchema = idSchema.refine((value) => value.startsWith("revision_"), {
  message: "Revision IDs must use the revision_ prefix",
});

export const reviewRefKindSchema = z.enum([
  "branch",
  "tag",
  "commit",
  "ref",
  "worktree",
  "empty_tree",
]);

export const reviewRangeKindSchema = z.enum([
  "default_branch",
  "branch_to_branch",
  "commit_to_commit",
  "tag_or_ref",
  "same_branch_slice",
  "worktree",
  "whole_repository",
  "custom",
]);

export const reviewRefInputSchema = z.object({
  kind: reviewRefKindSchema,
  value: gitRefSchema,
  displayName: z.string().trim().min(1).max(512).optional(),
});

export const reviewRangeSchema = z.object({
  kind: reviewRangeKindSchema,
  baseRef: reviewRefInputSchema,
  headRef: reviewRefInputSchema,
});

export const diffSummarySchema = z.object({
  fileCount: z.number().int().min(0),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  binaryFileCount: z.number().int().min(0),
  renameCount: z.number().int().min(0),
});

export const reviewStatusSchema = z.enum(["open", "closed"]);

export const reviewStateFilterSchema = z.enum(["open", "closed", "all"]);

export const reviewPrCreateInputSchema = z.object({
  repositoryId: repositoryIdSchema,
  title: z.string().trim().min(1).max(240),
  range: reviewRangeSchema,
  baseRefDisplay: z.string().trim().min(1).max(512),
  headRefDisplay: z.string().trim().min(1).max(512),
  spotlightConfig: spotlightAutoGenerationConfigSchema.optional(),
});

export const reviewPrUpdateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    status: reviewStatusSchema.optional(),
    currentRevisionId: revisionIdSchema.nullable().optional(),
    spotlightConfig: spotlightAutoGenerationConfigSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one review field is required");

export const reviewPrSchema = z.object({
  displayId: reviewDisplayIdSchema,
  repositoryId: repositoryIdSchema,
  title: z.string().trim().min(1).max(240),
  range: reviewRangeSchema,
  baseRefDisplay: z.string().trim().min(1).max(512),
  headRefDisplay: z.string().trim().min(1).max(512),
  currentRevisionId: revisionIdSchema.nullable(),
  status: reviewStatusSchema,
  spotlightConfig: spotlightAutoGenerationConfigSchema.default({ autoGenerateSpotlight: false }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const worktreeFingerprintSchema = z.object({
  headSha: gitShaSchema,
  stagedDiffHash: z.string().trim().min(1).max(128).nullable(),
  unstagedDiffHash: z.string().trim().min(1).max(128).nullable(),
});

export const revisionRefreshReasonSchema = z.enum(["initial", "manual_refresh", "detected_change"]);

export const revisionCreateInputSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  baseSha: gitShaSchema,
  headSha: gitShaSchema.nullable(),
  worktreeFingerprint: worktreeFingerprintSchema.nullable().optional(),
  diffSummary: diffSummarySchema,
  refreshReason: revisionRefreshReasonSchema.default("initial"),
});

export const revisionSnapshotSchema = z.object({
  id: revisionIdSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  baseSha: gitShaSchema,
  headSha: gitShaSchema.nullable(),
  worktreeFingerprint: worktreeFingerprintSchema.nullable(),
  diffSummary: diffSummarySchema,
  refreshReason: revisionRefreshReasonSchema,
  createdAt: timestampSchema,
});

export type ReviewPrId = z.infer<typeof reviewPrIdSchema>;
export type ReviewDisplayId = z.infer<typeof reviewDisplayIdSchema>;
export type ReviewReference = z.infer<typeof reviewReferenceSchema>;
export type RevisionId = z.infer<typeof revisionIdSchema>;
export type ReviewRefKind = z.infer<typeof reviewRefKindSchema>;
export type ReviewRangeKind = z.infer<typeof reviewRangeKindSchema>;
export type ReviewRefInput = z.infer<typeof reviewRefInputSchema>;
export type ReviewRange = z.infer<typeof reviewRangeSchema>;
export type DiffSummary = z.infer<typeof diffSummarySchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewStateFilter = z.infer<typeof reviewStateFilterSchema>;
export type ReviewPrCreateInput = z.infer<typeof reviewPrCreateInputSchema>;
export type ReviewPrUpdateInput = z.infer<typeof reviewPrUpdateInputSchema>;
export type ReviewPr = z.infer<typeof reviewPrSchema>;
export type WorktreeFingerprint = z.infer<typeof worktreeFingerprintSchema>;
export type RevisionRefreshReason = z.infer<typeof revisionRefreshReasonSchema>;
export type RevisionCreateInput = z.input<typeof revisionCreateInputSchema>;
export type RevisionSnapshot = z.infer<typeof revisionSnapshotSchema>;
