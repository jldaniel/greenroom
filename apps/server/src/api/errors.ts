import type { Context } from "hono";
import * as z from "zod";

import { DomainInvariantError } from "@greenroom/core";
import { apiErrorSchema, type ApiError, type ApiErrorCode } from "@greenroom/schemas";
import {
  GitCommandError,
  GitRangeError,
  GitRefResolutionError,
  GitRepositoryError,
} from "@greenroom/git";

import { GreenroomConfigFileError } from "../config/file";

type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;

export class ApiHttpError extends Error {
  readonly status: ApiErrorStatus;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: ApiErrorStatus,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function apiErrorResponse(
  context: Context,
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return context.json({ error: createApiError(code, message, details) }, status);
}

export function handleApiError(error: Error, context: Context): Response {
  if (error instanceof ApiHttpError) {
    return apiErrorResponse(context, error.status, error.code, error.message, error.details);
  }

  if (error instanceof z.ZodError) {
    return apiErrorResponse(context, 400, "validation_error", "Request validation failed", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof GreenroomConfigFileError) {
    return apiErrorResponse(context, 400, "validation_error", "Config file validation failed", {
      issues: error.issues.map((issue) => ({
        path: issue.key,
        message: issue.message,
      })),
    });
  }

  if (error instanceof DomainInvariantError) {
    return apiErrorResponse(context, 409, "conflict", error.message);
  }

  if (error instanceof GitRepositoryError) {
    const status = error.code === "path_not_found" ? 404 : 400;
    const code = error.code === "path_not_found" ? "not_found" : "bad_request";

    return apiErrorResponse(context, status, code, error.message, {
      gitErrorCode: error.code,
      path: error.path,
    });
  }

  if (error instanceof GitRefResolutionError) {
    return apiErrorResponse(context, 404, "not_found", error.message, {
      gitErrorCode: error.code,
      ref: error.ref,
    });
  }

  if (error instanceof GitRangeError) {
    return apiErrorResponse(context, 409, "conflict", error.message, {
      gitErrorCode: error.code,
    });
  }

  if (error instanceof GitCommandError) {
    const status = error.code === "invalid_command" ? 400 : 500;
    const code = error.code === "invalid_command" ? "bad_request" : "internal_error";

    return apiErrorResponse(context, status, code, error.message, {
      gitErrorCode: error.code,
      exitCode: error.exitCode,
      stderr: error.stderr.trim(),
    });
  }

  return apiErrorResponse(context, 500, "internal_error", "An internal server error occurred");
}

function createApiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  const payload: { code: ApiErrorCode; message: string; details?: Record<string, unknown> } = {
    code,
    message,
  };

  if (details !== undefined) {
    payload.details = details;
  }

  return apiErrorSchema.parse(payload);
}
