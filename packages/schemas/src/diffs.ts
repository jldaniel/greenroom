import * as z from "zod";

import { idSchema, relativePathSchema } from "./primitives";
import { revisionIdSchema } from "./reviews";

export const diffFileIdSchema = idSchema.refine((value) => value.startsWith("diff_file_"), {
  message: "Diff file IDs must use the diff_file_ prefix",
});

export const diffHunkIdSchema = idSchema.refine((value) => value.startsWith("diff_hunk_"), {
  message: "Diff hunk IDs must use the diff_hunk_ prefix",
});

export const diffFileStatusSchema = z.enum([
  "added",
  "deleted",
  "modified",
  "renamed",
  "copied",
  "mode_changed",
  "type_changed",
  "binary",
]);

export const diffSideSchema = z.enum(["base", "head"]);

export const diffLineTypeSchema = z.enum(["context", "addition", "deletion", "no_newline"]);

export const diffLineSchema = z
  .object({
    type: diffLineTypeSchema,
    oldLineNumber: z.number().int().min(1).nullable(),
    newLineNumber: z.number().int().min(1).nullable(),
    content: z.string(),
  })
  .superRefine((value, context) => {
    if (value.type === "addition" && value.newLineNumber === null) {
      context.addIssue({
        code: "custom",
        message: "Addition lines require a new line number",
        path: ["newLineNumber"],
      });
    }

    if (value.type === "deletion" && value.oldLineNumber === null) {
      context.addIssue({
        code: "custom",
        message: "Deletion lines require an old line number",
        path: ["oldLineNumber"],
      });
    }
  });

export const renameMetadataSchema = z.object({
  oldPath: relativePathSchema,
  newPath: relativePathSchema,
  similarity: z.number().int().min(0).max(100).nullable(),
});

export const diffHunkSchema = z.object({
  id: diffHunkIdSchema,
  fileId: diffFileIdSchema,
  oldStart: z.number().int().min(0),
  oldLines: z.number().int().min(0),
  newStart: z.number().int().min(0),
  newLines: z.number().int().min(0),
  header: z.string().trim().min(1).max(1000),
  lines: z.array(diffLineSchema),
  sortOrder: z.number().int().min(1),
});

export const diffFileSchema = z.object({
  id: diffFileIdSchema,
  revisionId: revisionIdSchema,
  path: relativePathSchema,
  oldPath: relativePathSchema.nullable(),
  status: diffFileStatusSchema,
  isBinary: z.boolean(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  oldMode: z.string().trim().min(1).max(32).nullable(),
  newMode: z.string().trim().min(1).max(32).nullable(),
  renameMetadata: renameMetadataSchema.nullable(),
  hunks: z.array(diffHunkSchema),
});

export type DiffFileId = z.infer<typeof diffFileIdSchema>;
export type DiffHunkId = z.infer<typeof diffHunkIdSchema>;
export type DiffFileStatus = z.infer<typeof diffFileStatusSchema>;
export type DiffSide = z.infer<typeof diffSideSchema>;
export type DiffLineType = z.infer<typeof diffLineTypeSchema>;
export type DiffLine = z.infer<typeof diffLineSchema>;
export type RenameMetadata = z.infer<typeof renameMetadataSchema>;
export type DiffHunk = z.infer<typeof diffHunkSchema>;
export type DiffFile = z.infer<typeof diffFileSchema>;
