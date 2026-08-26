import * as z from "zod";

import { diffHunkIdSchema, diffLineTypeSchema, diffSideSchema } from "./diffs";
import { idSchema, relativePathSchema, timestampSchema } from "./primitives";
import { reviewDisplayIdSchema, revisionIdSchema } from "./reviews";

export const threadIdSchema = idSchema.refine((value) => value.startsWith("thread_"), {
  message: "Thread IDs must use the thread_ prefix",
});

export const commentIdSchema = idSchema.refine((value) => value.startsWith("comment_"), {
  message: "Comment IDs must use the comment_ prefix",
});

export const threadRefSchema = z
  .string()
  .trim()
  .regex(/^GT-[1-9]\d*$/u, "Thread refs must look like GT-12");

/**
 * The only externally-accepted way to address a thread. Kept as a named
 * alias of the global short-ref schema so API surfaces read as "reference".
 */
export const threadReferenceSchema = threadRefSchema;

export const threadStatusSchema = z.enum(["open", "resolved", "dismissed"]);

export const threadTypeSchema = z.enum(["question", "issue", "suggestion", "note"]);

export const threadSeveritySchema = z.enum(["blocking", "major", "minor", "nit"]);

export const participantKindSchema = z.enum([
  "human",
  "mcp_client",
  "external_agent",
  "teaching",
  "builtin_reviewer",
  "system",
]);

export const threadSourceSchema = z.object({
  kind: participantKindSchema.exclude(["system"]),
  displayName: z.string().trim().min(1).max(160),
  clientName: z.string().trim().min(1).max(160).nullable().optional(),
  toolName: z.string().trim().min(1).max(160).nullable().optional(),
  profileId: idSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const threadAnchorSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  revisionId: revisionIdSchema,
  filePath: relativePathSchema,
  oldFilePath: relativePathSchema.nullable(),
  side: diffSideSchema,
  lineNumber: z.number().int().min(1),
  lineType: diffLineTypeSchema,
  hunkId: diffHunkIdSchema.nullable(),
  hunkHeader: z.string().trim().min(1).max(1000).nullable(),
  contextBefore: z.array(z.string()).max(20),
  contextAfter: z.array(z.string()).max(20),
  originalLineText: z.string().nullable(),
});

export const threadAnchorListSchema = z.array(threadAnchorSchema).min(1).max(200);

export const commentCreateInputSchema = z.object({
  threadRef: threadRefSchema,
  parentCommentId: commentIdSchema.nullable().optional(),
  authorKind: participantKindSchema,
  authorDisplayName: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(65_000),
});

export const commentSchema = z.object({
  id: commentIdSchema,
  threadRef: threadRefSchema,
  parentCommentId: commentIdSchema.nullable(),
  authorKind: participantKindSchema,
  authorDisplayName: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(65_000),
  sortOrder: z.number().int().min(1),
  createdAt: timestampSchema,
  editedAt: timestampSchema.nullable(),
});

export const threadCreateInputSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  type: threadTypeSchema,
  severity: threadSeveritySchema.nullable().optional(),
  source: threadSourceSchema,
  anchor: threadAnchorSchema,
  anchors: threadAnchorListSchema.optional(),
  firstComment: commentCreateInputSchema.omit({ threadRef: true }),
});

export const threadSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  shortRef: threadRefSchema,
  status: threadStatusSchema,
  type: threadTypeSchema,
  severity: threadSeveritySchema.nullable(),
  source: threadSourceSchema,
  anchor: threadAnchorSchema,
  anchors: threadAnchorListSchema,
  remapConfidence: z.number().min(0).max(1).nullable(),
  outdated: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const threadWithCommentsSchema = threadSchema.extend({
  comments: z.array(commentSchema),
});

export type ThreadId = z.infer<typeof threadIdSchema>;
export type CommentId = z.infer<typeof commentIdSchema>;
export type ThreadRef = z.infer<typeof threadRefSchema>;
export type ThreadReference = z.infer<typeof threadReferenceSchema>;
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export type ThreadType = z.infer<typeof threadTypeSchema>;
export type ThreadSeverity = z.infer<typeof threadSeveritySchema>;
export type ParticipantKind = z.infer<typeof participantKindSchema>;
export type ThreadSource = z.infer<typeof threadSourceSchema>;
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;
export type ThreadAnchorList = z.infer<typeof threadAnchorListSchema>;
export type CommentCreateInput = z.infer<typeof commentCreateInputSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type ThreadCreateInput = z.infer<typeof threadCreateInputSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type ThreadWithComments = z.infer<typeof threadWithCommentsSchema>;
