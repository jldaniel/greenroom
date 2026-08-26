import { Link } from "@tanstack/react-router";
import { GitPullRequestArrow } from "lucide-react";

import type { ReviewResource } from "../../api/client";
import { compactSha, formatDateTime } from "../../utils";
import { DiffSummary } from "../DiffSummary";
import { ReviewStatusBadge } from "../Status";

/**
 * Review title card: name, display id, status, base..head range, and the
 * current revision's diff summary.
 */
export function WorkspaceHeader({
  review,
  visibleReviewId,
}: {
  review: ReviewResource | undefined;
  visibleReviewId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            to="/reviews"
          >
            Reviews
          </Link>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <GitPullRequestArrow aria-hidden="true" className="size-5 text-accent-ink" />
            <h1
              className="min-w-0 max-w-full truncate text-2xl font-semibold tracking-normal"
              id="review-workspace-title"
            >
              {review?.review.title ?? visibleReviewId}
            </h1>
            <span className="rounded-md border border-line bg-muted-surface px-2 py-0.5 font-mono text-xs text-muted">
              {visibleReviewId}
            </span>
            {review === undefined ? null : <ReviewStatusBadge status={review.review.status} />}
          </div>
          {review === undefined ? null : (
            <p className="mt-1 break-words text-sm text-muted">
              {review.repository.displayName} - {review.review.baseRefDisplay}..
              {review.review.headRefDisplay}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-muted lg:text-right">
          <span>Updated</span>
          <span className="text-ink">{formatDateTime(review?.review.updatedAt)}</span>
          <span>Base</span>
          <span className="font-mono text-ink">{compactSha(review?.currentRevision?.baseSha)}</span>
          <span>Head</span>
          <span className="font-mono text-ink">{compactSha(review?.currentRevision?.headSha)}</span>
        </div>
      </div>
      {review?.currentRevision === undefined || review.currentRevision === null ? null : (
        <DiffSummary summary={review.currentRevision.diffSummary} />
      )}
    </div>
  );
}
