import { Link } from "@tanstack/react-router";
import { BookOpen, Tags } from "lucide-react";

import type { SpotlightViewRef } from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import { SpotlightHealthBadge, SpotlightIntentBadge } from "./SpotlightBadges";
import type { SpotlightSelection } from "./workspaceTypes";

/**
 * Scope banner shown above the center diff while the Spotlight drawer section
 * filters it in place: the selected View or Coverage entry, its lit-line
 * legend, and the Teach entry point that links to the dedicated Teach route
 * with the selected View preselected.
 */
export function SpotlightScopeBanner({
  coverageAnchorCount,
  fileCount,
  isLoading,
  selection,
  teachTo,
  view,
}: {
  coverageAnchorCount: number;
  fileCount: number;
  isLoading: boolean;
  selection: SpotlightSelection;
  teachTo?: { reviewId: string; viewRef: SpotlightViewRef };
  view: SpotlightViewResource | null;
}) {
  const title = selection.kind === "view" ? (view?.title ?? "Spotlight View") : "Coverage";
  const description =
    selection.kind === "view"
      ? view?.description
      : "Changed lines that are not lit by any current View.";

  return (
    <section className="rounded-lg border border-line bg-surface px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tags aria-hidden="true" className="size-4 text-accent-ink" />
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {selection.kind === "view" && view !== null ? (
              <>
                <SpotlightIntentBadge intent={view.intent} />
                <SpotlightHealthBadge health={view.health} />
              </>
            ) : null}
            {selection.kind === "coverage" ? <SpotlightIntentBadge intent="coverage" /> : null}
          </div>
          {description === undefined ? null : (
            <p className="mt-1 max-w-4xl break-words text-sm text-muted">{description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{isLoading ? "Loading files" : `${fileCount} scoped files`}</span>
            {selection.kind === "coverage" ? <span>{coverageAnchorCount} unlit lines</span> : null}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm border border-accent/30 bg-accent-soft" />
              Lit
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm border border-line bg-muted-surface opacity-60" />
              Unlit change
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm border border-line bg-surface" />
              Context
            </span>
          </div>
        </div>
        {teachTo === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-muted hover:bg-muted-surface hover:text-ink"
              params={{ reviewId: teachTo.reviewId }}
              search={{ view: teachTo.viewRef }}
              to="/reviews/$reviewId/teach"
            >
              <BookOpen aria-hidden="true" className="size-4" />
              Teach
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
