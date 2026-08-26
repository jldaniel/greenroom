import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, BookOpen } from "lucide-react";

import type { ReviewReference } from "@greenroom/schemas";

import { useReview, useReviewDiff, useSpotlightViews } from "../api/hooks";
import { ApiErrorBannerGroup, LoadingBlock } from "../components/Feedback";
import { ReviewStatusBadge } from "../components/Status";
import { TeachingSession } from "../components/teach/TeachingSession";
import { useToasts } from "../components/Toast";

/**
 * Dedicated full-page Teach surface: Teach left the
 * workspace drawer for its own route at `/reviews/:reviewId/teach`. The
 * workspace panel tab bar links here, and the Spotlight scope banner links
 * here with `?view=<viewId>` to preselect View-scoped teaching. The session
 * itself (run setup, walkthrough with inline excerpts, interactive quiz, and
 * the follow-up conversation) lives in `components/teach/`. Promoted points
 * become regular review threads that are triaged back in the workspace.
 */
export function TeachPage() {
  const params = useParams({ from: "/reviews/$reviewId/teach" });
  const search = useSearch({ from: "/reviews/$reviewId/teach" });
  const navigate = useNavigate();
  const pushToast = useToasts();
  const reviewReference = params.reviewId as ReviewReference;
  const review = useReview(reviewReference);
  const diff = useReviewDiff(reviewReference, null);
  const currentRevisionId = review.data?.review.currentRevisionId ?? null;
  const visibleReviewId = review.data?.review.displayId ?? reviewReference;
  const spotlightViews = useSpotlightViews(reviewReference);
  const files = useMemo(() => diff.data?.files ?? [], [diff.data?.files]);
  const isLoading = review.isLoading || diff.isLoading;

  return (
    <section aria-labelledby="teach-page-title" className="space-y-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        <Link
          className="inline-flex items-center gap-1.5 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          params={{ reviewId: params.reviewId }}
          to="/reviews/$reviewId"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to workspace
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <BookOpen aria-hidden="true" className="size-5 text-accent-ink" />
          <h1 className="truncate text-2xl font-semibold tracking-normal" id="teach-page-title">
            Teach
          </h1>
          <span className="rounded-md border border-line bg-muted-surface px-2 py-0.5 font-mono text-xs text-muted">
            {visibleReviewId}
          </span>
          {review.data === undefined ? null : (
            <ReviewStatusBadge status={review.data.review.status} />
          )}
        </div>
        {review.data === undefined ? null : (
          <p className="mt-1 truncate text-sm text-muted">
            {review.data.review.title} - {review.data.repository.displayName} -{" "}
            {review.data.review.baseRefDisplay}..{review.data.review.headRefDisplay}
          </p>
        )}
      </div>

      <ApiErrorBannerGroup errors={[review.error, diff.error, spotlightViews.error]} />

      {isLoading ? <LoadingBlock label="Loading teaching context" /> : null}

      {!isLoading ? (
        <TeachingSession
          currentRevisionId={currentRevisionId}
          files={files}
          initialSpotlightViewRef={search.view ?? null}
          onPromoted={(shortRef) =>
            pushToast({
              kind: "success",
              title: `Promoted to thread ${shortRef}`,
              body: "The point is now a review thread; triage it from the workspace.",
              action: {
                label: "Open workspace",
                onAction: () =>
                  void navigate({
                    to: "/reviews/$reviewId",
                    params: { reviewId: params.reviewId },
                  }),
              },
            })
          }
          reviewId={reviewReference}
          revisionId={diff.data?.revision.id ?? null}
          spotlightViews={spotlightViews.data ?? []}
        />
      ) : null}
    </section>
  );
}
