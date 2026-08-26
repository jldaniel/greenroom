import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Archive, GitPullRequestArrow, Plus, RotateCcw } from "lucide-react";

import type { ReviewStateFilter, ReviewStatus } from "@greenroom/schemas";

import { useReviews, useTransitionReviewStatus } from "../api/hooks";
import { compactSha, formatDateTime } from "../utils";
import { DiffSummary } from "./DiffSummary";
import { ApiErrorBanner, EmptyState, LoadingBlock } from "./Feedback";
import { ReviewStatusBadge } from "./Status";

const reviewStateFilters: Array<{ value: ReviewStateFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export function ReviewListPanel() {
  const [stateFilter, setStateFilter] = useState<ReviewStateFilter>("open");
  const reviews = useReviews(stateFilter);
  const transitionReviewStatus = useTransitionReviewStatus();
  const emptyState = emptyStateForFilter(stateFilter);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Reviews</h1>
          <p className="mt-1 text-sm text-muted">Committed-ref review PRs</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div
            aria-label="Review state"
            className="grid grid-cols-3 gap-1 rounded-lg bg-muted-surface p-1"
            role="radiogroup"
          >
            {reviewStateFilters.map((filter) => (
              <button
                aria-checked={stateFilter === filter.value}
                className={`inline-flex h-9 min-w-20 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors ${
                  stateFilter === filter.value
                    ? "bg-surface text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
                key={filter.value}
                onClick={() => setStateFilter(filter.value)}
                role="radio"
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-surface transition hover:bg-ink/90"
            to="/reviews/new"
          >
            <Plus aria-hidden="true" className="size-4" />
            Create
          </Link>
        </div>
      </div>

      {reviews.isLoading ? <LoadingBlock label="Loading reviews" /> : null}
      {reviews.error === null ? null : <ApiErrorBanner error={reviews.error} />}
      {transitionReviewStatus.error === null ? null : (
        <ApiErrorBanner error={transitionReviewStatus.error} />
      )}
      {reviews.data !== undefined && reviews.data.length === 0 ? (
        <EmptyState title={emptyState.title} body={emptyState.body} />
      ) : null}
      {reviews.data === undefined || reviews.data.length === 0 ? null : (
        <div className="grid gap-4">
          {reviews.data.map(({ review, repository, currentRevision }) => {
            const nextStatus: ReviewStatus = review.status === "open" ? "closed" : "open";
            const actionLabel = nextStatus === "closed" ? "Close" : "Reopen";
            const ActionIcon = nextStatus === "closed" ? Archive : RotateCcw;

            return (
              <article
                className="min-w-0 rounded-lg border border-line bg-surface p-4"
                key={review.displayId}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <GitPullRequestArrow aria-hidden="true" className="size-4 text-accent-ink" />
                      <Link
                        className="min-w-0 max-w-full break-words font-medium text-ink underline-offset-4 hover:underline"
                        params={{ reviewId: review.displayId }}
                        to="/reviews/$reviewId"
                      >
                        {review.title}
                      </Link>
                      <span className="rounded-md border border-line bg-muted-surface px-2 py-0.5 font-mono text-xs text-muted">
                        {review.displayId}
                      </span>
                      <ReviewStatusBadge status={review.status} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                      <span className="min-w-0 break-words">{repository.displayName}</span>
                      <span className="min-w-0 break-words">
                        {review.baseRefDisplay}..{review.headRefDisplay}
                      </span>
                      <span>Updated {formatDateTime(review.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 lg:items-end">
                    <div className="text-xs text-muted lg:text-right">
                      <p>Base {compactSha(currentRevision?.baseSha)}</p>
                      <p>Head {compactSha(currentRevision?.headSha)}</p>
                    </div>
                    <button
                      aria-label={`${actionLabel} ${review.displayId}`}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface disabled:opacity-50"
                      disabled={transitionReviewStatus.isPending}
                      onClick={() =>
                        transitionReviewStatus.mutate({
                          reviewId: review.displayId,
                          status: nextStatus,
                        })
                      }
                      type="button"
                    >
                      <ActionIcon aria-hidden="true" className="size-4" />
                      {actionLabel}
                    </button>
                  </div>
                </div>
                {currentRevision === null ? null : (
                  <div className="mt-4">
                    <DiffSummary summary={currentRevision.diffSummary} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function emptyStateForFilter(filter: ReviewStateFilter): { title: string; body: string } {
  switch (filter) {
    case "open":
      return {
        title: "No open reviews",
        body: "Create a committed-ref review from a registered repository.",
      };
    case "closed":
      return {
        title: "No closed reviews",
        body: "Closed reviews will appear here.",
      };
    case "all":
      return {
        title: "No reviews",
        body: "Create a committed-ref review from a registered repository.",
      };
  }
}
