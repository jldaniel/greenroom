import { useMemo } from "react";

import type { DiffFile, ReviewReference, RevisionId, SpotlightViewRef } from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import {
  useSpotlightCoverage,
  useSpotlightLineMembership,
  useSpotlightViewDiff,
  useSpotlightViews,
} from "../../api/hooks";
import type { DiffViewerSpotlightMarkers } from "../DiffViewer";
import { threadAnchorKey } from "../threadTriageUtils";
import type { SpotlightSelection } from "./workspaceTypes";
import { anchorFileKey, buildLineMembershipMap, diffFileKey } from "./workspaceUtils";

export interface SpotlightScope {
  activeScopeRevisionId: RevisionId | undefined;
  coverageAnchorCount: number;
  coverageFileCount: number;
  error: unknown;
  hasLoadedViews: boolean;
  isCoverageLoading: boolean;
  isLoadingViews: boolean;
  isScopeLoading: boolean;
  lineMembershipError: unknown;
  lineMemberships: Map<string, readonly SpotlightViewResource[]>;
  scopeFiles: DiffFile[];
  selectedView: SpotlightViewResource | null;
  selectedViewRef: SpotlightViewRef | null;
  spotlightMarkers: DiffViewerSpotlightMarkers | undefined;
  views: SpotlightViewResource[];
}

/**
 * Spotlight data for the diff-centric workspace: the Views list, the
 * scoped file set and lit/unlit markers the center diff shows while the
 * Spotlight drawer section filters it, and the always-on line membership map
 * for the membership chips in the diff gutter.
 */
export function useSpotlightScope({
  files,
  reviewId,
  scopeEnabled,
  selection,
  viewsEnabled,
}: {
  files: readonly DiffFile[];
  reviewId: ReviewReference;
  scopeEnabled: boolean;
  selection: SpotlightSelection | null;
  viewsEnabled: boolean;
}): SpotlightScope {
  const views = useSpotlightViews(reviewId, viewsEnabled);
  const selectedViewRef = selection?.kind === "view" ? selection.viewRef : null;
  const selectedView = useMemo(
    () =>
      selectedViewRef === null
        ? null
        : ((views.data ?? []).find((view) => view.displayRef === selectedViewRef) ?? null),
    [selectedViewRef, views.data],
  );
  const viewDiff = useSpotlightViewDiff(
    reviewId,
    selectedViewRef,
    scopeEnabled && selection?.kind === "view" && selectedView !== null,
  );
  const coverage = useSpotlightCoverage(reviewId, scopeEnabled);
  const lineMembership = useSpotlightLineMembership(reviewId, true);
  const coverageFileKeys = useMemo(
    () => new Set((coverage.data?.unlitAnchors ?? []).map(anchorFileKey)),
    [coverage.data?.unlitAnchors],
  );
  const scopeFiles = useMemo(() => {
    if (!scopeEnabled || selection === null) {
      return [];
    }

    if (selection.kind === "view") {
      return viewDiff.data?.files ?? [];
    }

    return files.filter((file) => coverageFileKeys.has(diffFileKey(file)));
  }, [coverageFileKeys, files, scopeEnabled, selection, viewDiff.data?.files]);
  const spotlightMarkers = useMemo<DiffViewerSpotlightMarkers | undefined>(() => {
    if (!scopeEnabled || selection === null) {
      return undefined;
    }

    if (selection.kind === "view") {
      if (viewDiff.data === undefined) {
        return undefined;
      }

      return {
        litChangedLineKeys: new Set(
          viewDiff.data.regions.flatMap((region) =>
            region.anchors.map((anchor) => threadAnchorKey(anchor)),
          ),
        ),
      };
    }

    if (coverage.data === undefined) {
      return undefined;
    }

    return {
      litChangedLineKeys: new Set(
        coverage.data.unlitAnchors.map((anchor) => threadAnchorKey(anchor)),
      ),
    };
  }, [coverage.data, scopeEnabled, selection, viewDiff.data]);
  const lineMemberships = useMemo(
    () => buildLineMembershipMap(lineMembership.data?.memberships ?? []),
    [lineMembership.data?.memberships],
  );
  const isScopeLoading =
    scopeEnabled &&
    ((selection?.kind === "view" && viewDiff.isLoading) ||
      (selection?.kind === "coverage" && coverage.isLoading));
  const activeScopeRevisionId =
    selection?.kind === "view"
      ? viewDiff.data?.revision.id
      : selection?.kind === "coverage"
        ? coverage.data?.revisionId
        : undefined;

  return {
    activeScopeRevisionId,
    coverageAnchorCount: coverage.data?.unlitAnchors.length ?? 0,
    coverageFileCount: coverageFileKeys.size,
    error: views.error ?? viewDiff.error ?? coverage.error,
    hasLoadedViews: views.data !== undefined,
    isCoverageLoading: coverage.isLoading,
    isLoadingViews: views.isLoading,
    isScopeLoading,
    lineMembershipError: lineMembership.error,
    lineMemberships,
    scopeFiles,
    selectedView,
    selectedViewRef,
    spotlightMarkers,
    views: views.data ?? [],
  };
}
