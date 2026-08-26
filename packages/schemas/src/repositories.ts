import * as z from "zod";

import { absolutePathSchema, idSchema, timestampSchema } from "./primitives";

export const repositoryIdSchema = idSchema.refine((value) => value.startsWith("repo_"), {
  message: "Repository IDs must use the repo_ prefix",
});

export const spotlightAutoGenerationConfigSchema = z
  .object({
    autoGenerateSpotlight: z.boolean().default(false),
  })
  .strict();

export const repositoryCreateInputSchema = z.object({
  rootPath: absolutePathSchema,
  gitCommonDir: absolutePathSchema.optional(),
  identityKey: z.string().trim().min(1).max(4096).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  defaultBranchCandidate: z.string().trim().min(1).max(255).nullable().optional(),
  spotlightConfig: spotlightAutoGenerationConfigSchema.optional(),
});

export const repositoryUpdateInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    defaultBranchCandidate: z.string().trim().min(1).max(255).nullable().optional(),
    lastOpenedAt: timestampSchema.nullable().optional(),
    spotlightConfig: spotlightAutoGenerationConfigSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one repository field is required");

export const repositorySchema = z.object({
  id: repositoryIdSchema,
  rootPath: absolutePathSchema,
  gitCommonDir: absolutePathSchema,
  identityKey: z.string().trim().min(1).max(4096),
  displayName: z.string().trim().min(1).max(200),
  defaultBranchCandidate: z.string().trim().min(1).max(255).nullable(),
  spotlightConfig: spotlightAutoGenerationConfigSchema.default({ autoGenerateSpotlight: false }),
  lastOpenedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type RepositoryId = z.infer<typeof repositoryIdSchema>;
export type SpotlightAutoGenerationConfig = z.infer<typeof spotlightAutoGenerationConfigSchema>;
export type RepositoryCreateInput = z.infer<typeof repositoryCreateInputSchema>;
export type RepositoryUpdateInput = z.infer<typeof repositoryUpdateInputSchema>;
export type Repository = z.infer<typeof repositorySchema>;
