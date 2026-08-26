import * as z from "zod";

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*_[A-Za-z0-9_-]+$/u, "IDs must use a lowercase prefix and opaque suffix");

export const timestampSchema = z
  .string()
  .trim()
  .regex(isoTimestampPattern, "Timestamps must be ISO-8601 UTC strings");

export const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,64}$/iu, "Git SHAs must be hexadecimal");

export const gitRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\0"), "Git refs cannot contain NUL bytes");

export const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith("/"), "Paths must be absolute")
  .refine((value) => !value.includes("\0"), "Paths cannot contain NUL bytes");

export const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.startsWith("/"), "Paths must be repository-relative")
  .refine((value) => !value.includes("\0"), "Paths cannot contain NUL bytes");

export const paginationRequestSchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(250).default(50),
});

export const paginationResponseSchema = z.object({
  nextCursor: z.string().trim().min(1).max(512).nullable(),
});

export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_error",
  "internal_error",
]);

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().trim().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type GreenroomId = z.infer<typeof idSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type GitSha = z.infer<typeof gitShaSchema>;
export type GitRef = z.infer<typeof gitRefSchema>;
export type PaginationRequest = z.input<typeof paginationRequestSchema>;
export type Pagination = z.output<typeof paginationRequestSchema>;
export type PaginationResponse = z.infer<typeof paginationResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
