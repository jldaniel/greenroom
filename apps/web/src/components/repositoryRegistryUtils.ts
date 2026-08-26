import { GreenroomApiError, type ReviewPreviewResponse } from "../api/client";

/**
 * Inline outcome of the one-click "Review current changes" action on a
 * Dashboard repository row. Failures stay on the row as a clear
 * sentence instead of a raw error banner, except auth failures which defer
 * to the central 401 connect prompt.
 */
export type QuickReviewNotice =
  | { kind: "no_changes"; message: string }
  | { kind: "auth" }
  | { kind: "failure"; message: string };

/**
 * The server happily creates a worktree review with an empty diff, which
 * would pollute the review list. The one-click flow previews first and stops
 * here when there is nothing to review.
 */
export function deriveQuickReviewNoChanges(
  preview: Pick<ReviewPreviewResponse, "files" | "baseRefDisplay">,
): QuickReviewNotice | null {
  if (preview.files.length > 0) {
    return null;
  }

  return {
    kind: "no_changes",
    message: `No changes to review: the worktree matches ${preview.baseRefDisplay}.`,
  };
}

export function describeQuickReviewError(error: unknown): QuickReviewNotice {
  if (error instanceof GreenroomApiError) {
    if (error.status === 401) {
      return { kind: "auth" };
    }

    if (error.status === 0) {
      return {
        kind: "failure",
        message: "The Greenroom API is unreachable. Start the local services and retry.",
      };
    }

    if (error.status === 403) {
      return {
        kind: "failure",
        message: "The active token is missing the scope needed to create reviews.",
      };
    }

    const gitErrorCode = error.apiError?.details?.gitErrorCode;

    if (gitErrorCode === "path_not_found") {
      return {
        kind: "failure",
        message:
          "The repository path is unreachable. Verify it still exists, then retry or re-register it.",
      };
    }

    if (error.status === 404) {
      return {
        kind: "failure",
        message: "The repository was not found. It may have been removed; reload and retry.",
      };
    }

    if (gitErrorCode === "base_not_found" || gitErrorCode === "merge_base_not_found") {
      return {
        kind: "failure",
        message:
          "No default base branch was detected. Use Create Review to pick a custom base ref.",
      };
    }
  }

  const detail = error instanceof Error ? error.message : "unexpected error";

  return { kind: "failure", message: `Could not create the review: ${detail}` };
}
