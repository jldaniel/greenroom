import * as z from "zod";

import { diffFileStatusSchema, diffLineSchema, diffSideSchema } from "./diffs";
import { idSchema, relativePathSchema, timestampSchema } from "./primitives";
import { profileIdSchema } from "./profiles";
import { repositorySchema } from "./repositories";
import {
  reviewDisplayIdSchema,
  reviewPrSchema,
  revisionIdSchema,
  revisionSnapshotSchema,
} from "./reviews";
import { spotlightViewHealthSchema, spotlightViewRefSchema } from "./spotlight";
import { threadAnchorSchema } from "./threads";

export const teachingRunIdSchema = idSchema.refine((value) => value.startsWith("workflow_run_"), {
  message: "Teaching run IDs must use the workflow_run_ prefix",
});

export const teachingRunStatusSchema = z.enum([
  "pending_consent",
  "approved",
  "completed",
  "failed",
]);

export const teachingContextHunkSchema = z.object({
  header: z.string().trim().min(1).max(1000),
  oldStart: z.number().int().min(0),
  oldLines: z.number().int().min(0),
  newStart: z.number().int().min(0),
  newLines: z.number().int().min(0),
  lines: z.array(diffLineSchema),
});

export const teachingContextFileSchema = z.object({
  path: relativePathSchema,
  oldPath: relativePathSchema.nullable(),
  status: diffFileStatusSchema,
  isBinary: z.boolean(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  hunks: z.array(teachingContextHunkSchema),
  approximateTokenCount: z.number().int().min(0),
});

export const teachingContextScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("full_pr"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("spotlight_view"),
      viewRef: spotlightViewRefSchema,
      title: z.string().trim().min(1).max(160),
      health: spotlightViewHealthSchema,
    })
    .strict(),
]);

export const teachingContextSpotlightRegionSchema = z
  .object({
    filePath: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    anchors: z.array(threadAnchorSchema).min(1).max(200),
  })
  .strict();

export const teachingContextOmittedRegionSchema = z
  .object({
    filePath: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    anchorCount: z.number().int().min(1),
  })
  .strict();

export const teachingContextPackSchema = z.object({
  review: reviewPrSchema,
  repository: repositorySchema,
  revision: revisionSnapshotSchema,
  scope: teachingContextScopeSchema.default({ kind: "full_pr" }),
  files: z.array(teachingContextFileSchema),
  omittedFiles: z.array(relativePathSchema),
  spotlightRegions: z.array(teachingContextSpotlightRegionSchema).default([]),
  omittedRegions: z.array(teachingContextOmittedRegionSchema).default([]),
  approximateTokenCount: z.number().int().min(0),
  generatedAt: timestampSchema,
});

export const teachingScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("full_pr"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("spotlight_view"),
      viewRef: spotlightViewRefSchema,
    })
    .strict(),
]);

export const teachingConsentCreateInputSchema = z
  .object({
    profileId: profileIdSchema,
    revisionId: revisionIdSchema.nullable().optional(),
    scope: teachingScopeSchema.default({ kind: "full_pr" }),
    maxApproximateTokens: z.number().int().min(1000).max(80_000).default(16_000),
    start: z.boolean().default(false),
  })
  .strict();

export const teachingRunSchema = z.object({
  id: teachingRunIdSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  profileId: profileIdSchema,
  status: teachingRunStatusSchema,
  context: teachingContextPackSchema,
  createdAt: timestampSchema,
  approvedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  errorMessage: z.string().trim().min(1).max(4000).nullable(),
});

export const teachingDiagramSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  mermaidSource: z.string().trim().min(1).max(6000),
});

export const teachingExcerptRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("anchor"),
      anchor: threadAnchorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("lines"),
      filePath: relativePathSchema,
      side: diffSideSchema.default("head"),
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
    })
    .strict()
    .refine((excerpt) => excerpt.endLine >= excerpt.startLine, {
      message: "Line excerpts require endLine >= startLine",
      path: ["endLine"],
    })
    .refine((excerpt) => excerpt.endLine - excerpt.startLine < 200, {
      message: "Line excerpts may span at most 200 lines",
      path: ["endLine"],
    }),
]);

export const teachingPointSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(4000),
  filePath: relativePathSchema.nullable(),
  lineNumber: z.number().int().min(1).nullable(),
  anchor: threadAnchorSchema.nullable(),
  excerpts: z.array(teachingExcerptRefSchema).max(4).default([]),
  diagramId: z.string().trim().min(1).max(80).nullable().default(null),
});

export const teachingQuizChoiceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(400),
});

export const teachingQuizQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(1200),
  choices: z.array(teachingQuizChoiceSchema).min(2).max(5),
  correctChoiceId: z.string().trim().min(1).max(80),
  explanation: z.string().trim().min(1).max(2000),
  missedConcept: z.string().trim().min(1).max(400),
  anchor: threadAnchorSchema.nullable(),
  excerpts: z.array(teachingExcerptRefSchema).max(2).default([]),
});

export const structuredTeachingOutputSchema = z.object({
  changeSummary: z.string().trim().min(1).max(8000),
  architectureExplanation: z.string().trim().min(1).max(12_000),
  walkthrough: z.array(teachingPointSchema).min(1).max(40),
  quiz: z.array(teachingQuizQuestionSchema).min(1).max(12),
  missedConcepts: z.array(z.string().trim().min(1).max(600)).max(20),
  diagrams: z.array(teachingDiagramSchema).max(8).default([]),
});

export const teachingRunResultSchema = teachingRunSchema.extend({
  output: structuredTeachingOutputSchema.nullable(),
});

export const teachingFollowUpRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
  })
  .strict();

export const teachingFollowUpStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "repairing",
  "completed",
  "failed",
  "cancelled",
]);

export const teachingFollowUpResponseSchema = z.object({
  runId: teachingRunIdSchema,
  followUpRunId: teachingRunIdSchema.nullable().default(null),
  status: teachingFollowUpStatusSchema,
  answer: z.string().trim().min(1).max(16_000).nullable(),
  createdAt: timestampSchema,
});

export const teachingPromotionInputSchema = z
  .object({
    runId: teachingRunIdSchema.optional(),
    profileId: profileIdSchema.nullable().optional(),
    anchor: threadAnchorSchema,
    body: z.string().trim().min(1).max(65_000),
    title: z.string().trim().min(1).max(240).nullable().optional(),
  })
  .strict();

export const teachingQuizAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  selectedChoiceId: z.string().trim().min(1).max(80),
  correct: z.boolean(),
  missedConcept: z.string().trim().min(1).max(400).nullable(),
});

export type TeachingRunId = z.infer<typeof teachingRunIdSchema>;
export type TeachingRunStatus = z.infer<typeof teachingRunStatusSchema>;
export type TeachingContextHunk = z.infer<typeof teachingContextHunkSchema>;
export type TeachingContextFile = z.infer<typeof teachingContextFileSchema>;
export type TeachingContextScope = z.infer<typeof teachingContextScopeSchema>;
export type TeachingContextSpotlightRegion = z.infer<typeof teachingContextSpotlightRegionSchema>;
export type TeachingContextOmittedRegion = z.infer<typeof teachingContextOmittedRegionSchema>;
export type TeachingContextPack = z.infer<typeof teachingContextPackSchema>;
export type TeachingScope = z.infer<typeof teachingScopeSchema>;
export type TeachingConsentCreateInput = z.input<typeof teachingConsentCreateInputSchema>;
export type TeachingRun = z.infer<typeof teachingRunSchema>;
export type TeachingDiagram = z.infer<typeof teachingDiagramSchema>;
export type TeachingExcerptRef = z.infer<typeof teachingExcerptRefSchema>;
export type TeachingPoint = z.infer<typeof teachingPointSchema>;
export type TeachingQuizChoice = z.infer<typeof teachingQuizChoiceSchema>;
export type TeachingQuizQuestion = z.infer<typeof teachingQuizQuestionSchema>;
export type StructuredTeachingOutput = z.infer<typeof structuredTeachingOutputSchema>;
export type TeachingRunResult = z.infer<typeof teachingRunResultSchema>;
export type TeachingFollowUpRequest = z.input<typeof teachingFollowUpRequestSchema>;
export type TeachingFollowUpStatus = z.infer<typeof teachingFollowUpStatusSchema>;
export type TeachingFollowUpResponse = z.infer<typeof teachingFollowUpResponseSchema>;
export type TeachingPromotionInput = z.input<typeof teachingPromotionInputSchema>;
export type TeachingQuizAnswer = z.infer<typeof teachingQuizAnswerSchema>;
