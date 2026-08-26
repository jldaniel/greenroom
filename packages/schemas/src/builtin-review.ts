import * as z from "zod";

import { diffFileStatusSchema, diffLineSchema } from "./diffs";
import { idSchema, relativePathSchema, timestampSchema } from "./primitives";
import { profileIdSchema } from "./profiles";
import {
  reviewDisplayIdSchema,
  reviewPrSchema,
  revisionIdSchema,
  revisionSnapshotSchema,
} from "./reviews";
import { repositorySchema } from "./repositories";
import {
  threadRefSchema,
  threadSeveritySchema,
  threadStatusSchema,
  threadTypeSchema,
} from "./threads";

export const builtinReviewRunIdSchema = idSchema.refine(
  (value) => value.startsWith("workflow_run_"),
  {
    message: "Built-in review run IDs must use the workflow_run_ prefix",
  },
);

export const builtinReviewRunStatusSchema = z.enum([
  "pending_consent",
  "approved",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled",
]);

export const builtinReviewContextLineSchema = diffLineSchema.extend({
  anchorKey: z.string().trim().min(1).nullable(),
});

export const builtinReviewContextHunkSchema = z.object({
  id: z.string().trim().min(1),
  header: z.string().trim().min(1).max(1000),
  oldStart: z.number().int().min(0),
  oldLines: z.number().int().min(0),
  newStart: z.number().int().min(0),
  newLines: z.number().int().min(0),
  lines: z.array(builtinReviewContextLineSchema),
});

export const builtinReviewContextFileSchema = z.object({
  path: relativePathSchema,
  oldPath: relativePathSchema.nullable(),
  status: diffFileStatusSchema,
  isBinary: z.boolean(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  hunks: z.array(builtinReviewContextHunkSchema),
  changedLineCount: z.number().int().min(0),
  approximateTokenCount: z.number().int().min(0),
});

export const builtinReviewOmittedFileSchema = z
  .object({
    path: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    reason: z.string().trim().min(1).max(1000),
    approximateTokenCount: z.number().int().min(0),
    changedLineCount: z.number().int().min(0),
  })
  .strict();

export const builtinReviewExistingThreadSchema = z
  .object({
    shortRef: threadRefSchema,
    status: threadStatusSchema,
    type: threadTypeSchema,
    severity: threadSeveritySchema.nullable(),
    filePath: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    lineNumber: z.number().int().min(1),
    title: z.string().trim().min(1).max(240).nullable(),
    bodyPreview: z.string().max(1000),
  })
  .strict();

export const builtinReviewSpotlightSummarySchema = z
  .object({
    displayRef: z.string().trim().min(1),
    title: z.string().trim().min(1).max(160),
    intent: z.string().trim().min(1).max(80),
    health: z.enum(["current", "drifted", "outdated"]),
    associatedFiles: z.array(
      z
        .object({
          path: relativePathSchema,
          oldPath: relativePathSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const builtinReviewContextPackSchema = z.object({
  review: reviewPrSchema,
  repository: repositorySchema,
  revision: revisionSnapshotSchema,
  files: z.array(builtinReviewContextFileSchema),
  omittedFiles: z.array(builtinReviewOmittedFileSchema),
  existingThreads: z.array(builtinReviewExistingThreadSchema),
  spotlightViews: z.array(builtinReviewSpotlightSummarySchema),
  approximateTokenCount: z.number().int().min(0),
  generatedAt: timestampSchema,
});

export const builtinReviewConsentCreateInputSchema = z
  .object({
    profileId: profileIdSchema,
    revisionId: revisionIdSchema.nullable().optional(),
    maxApproximateTokens: z.number().int().min(1000).max(80_000).default(24_000),
    start: z.boolean().default(false),
  })
  .strict();

export const builtinReviewFindingSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(65_000),
    type: threadTypeSchema,
    severity: threadSeveritySchema.nullable(),
    anchorKey: z.string().trim().min(1),
    anchorKeys: z.array(z.string().trim().min(1)).max(200).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const builtinReviewOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(8000),
    findings: z.array(builtinReviewFindingSchema).max(50),
    nonFindings: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  })
  .strict();

export const builtinReviewRunSchema = z.object({
  id: builtinReviewRunIdSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  profileId: profileIdSchema,
  status: builtinReviewRunStatusSchema,
  context: builtinReviewContextPackSchema,
  createdAt: timestampSchema,
  approvedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  errorMessage: z.string().trim().min(1).max(4000).nullable(),
  output: builtinReviewOutputSchema.nullable(),
  createdThreadRefs: z.array(threadRefSchema),
});

export type BuiltinReviewRunId = z.infer<typeof builtinReviewRunIdSchema>;
export type BuiltinReviewRunStatus = z.infer<typeof builtinReviewRunStatusSchema>;
export type BuiltinReviewContextLine = z.infer<typeof builtinReviewContextLineSchema>;
export type BuiltinReviewContextHunk = z.infer<typeof builtinReviewContextHunkSchema>;
export type BuiltinReviewContextFile = z.infer<typeof builtinReviewContextFileSchema>;
export type BuiltinReviewOmittedFile = z.infer<typeof builtinReviewOmittedFileSchema>;
export type BuiltinReviewExistingThread = z.infer<typeof builtinReviewExistingThreadSchema>;
export type BuiltinReviewSpotlightSummary = z.infer<typeof builtinReviewSpotlightSummarySchema>;
export type BuiltinReviewContextPack = z.infer<typeof builtinReviewContextPackSchema>;
export type BuiltinReviewConsentCreateInput = z.input<typeof builtinReviewConsentCreateInputSchema>;
export type BuiltinReviewFinding = z.infer<typeof builtinReviewFindingSchema>;
export type BuiltinReviewOutput = z.infer<typeof builtinReviewOutputSchema>;
export type BuiltinReviewRun = z.infer<typeof builtinReviewRunSchema>;
