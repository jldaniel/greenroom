import type {
  DiffFile,
  ReviewReference,
  RevisionId,
  ThreadAnchor,
  ThreadWithComments,
} from "@greenroom/schemas";

import { DiffViewer } from "../DiffViewer";
import { UntrackedFilesNote } from "../UntrackedFilesNote";
import type { ControlledFileTreeModel } from "../useFileTreeModel";
import { DiffSection } from "./DiffSection";
import { SpotlightScopeBanner } from "./SpotlightScopeBanner";
import type { SpotlightScope } from "./useSpotlightScope";
import type { ThreadActionsController } from "./useThreadActions";
import type { WorkspaceSelectionController } from "./useWorkspaceSelection";

/**
 * The permanent center surface, fully wired: diff toolbar, file tree,
 * viewer with inline threads and membership chips, and the Spotlight scope
 * banner while the Spotlight drawer section filters the diff in place.
 */
export function WorkspaceCenter({
  activeDiffIsCurrent,
  activeDiffRevisionId,
  fileTreeModel,
  fileTreeWidth,
  inlineThreads,
  isWorktreeReview,
  reviewReference,
  scope,
  selectedFile,
  selection,
  spotlightFilterActive,
  threadActions,
  onFileTreeWidthChange,
  visibleFiles,
}: {
  activeDiffIsCurrent: boolean;
  activeDiffRevisionId: RevisionId | undefined;
  fileTreeModel: ControlledFileTreeModel<DiffFile>;
  fileTreeWidth: number;
  inlineThreads: ThreadWithComments[];
  isWorktreeReview: boolean;
  reviewReference: ReviewReference;
  scope: SpotlightScope;
  selectedFile: DiffFile | null;
  selection: WorkspaceSelectionController;
  spotlightFilterActive: boolean;
  threadActions: ThreadActionsController;
  visibleFiles: DiffFile[];
  onFileTreeWidthChange: (width: number) => void;
}) {
  const selectedFilePath = selectedFile?.path ?? null;
  const scopeBanner =
    spotlightFilterActive && selection.spotlightSelection !== null ? (
      <SpotlightScopeBanner
        coverageAnchorCount={scope.coverageAnchorCount}
        fileCount={scope.scopeFiles.length}
        isLoading={scope.isScopeLoading}
        selection={selection.spotlightSelection}
        view={scope.selectedView}
        {...(selection.spotlightSelection.kind === "view" && scope.selectedView !== null
          ? { teachTo: { reviewId: reviewReference, viewRef: scope.selectedView.displayRef } }
          : {})}
      />
    ) : null;
  const viewer = (
    <DiffViewer
      composerAnchors={
        selection.composerAnchor?.filePath === selectedFilePath ? selection.composerAnchors : []
      }
      file={selectedFile}
      isCreatingThread={threadActions.isCreating}
      isReplying={threadActions.isReplying}
      isTransitioning={threadActions.isTransitioning}
      focusedAnchorKey={selection.focusedAnchorKey}
      mode={selection.diffMode}
      onCancelThread={() => selection.setComposerAnchors([])}
      onCreateThread={(values) => threadActions.createThread(values)}
      onNavigateToSpotlightView={selection.navigateToSpotlightMembership}
      onReplyToThread={(shortRef, body) => threadActions.replyToThread(shortRef, body)}
      onTransitionThread={(shortRef, status) => threadActions.transitionThread(shortRef, status)}
      selectedThreadRef={selection.selectedThreadRef}
      threads={inlineThreads}
      reviewId={reviewReference}
      {...(activeDiffIsCurrent ? { lineMemberships: scope.lineMemberships } : {})}
      {...(spotlightFilterActive && scope.spotlightMarkers !== undefined
        ? { spotlightMarkers: scope.spotlightMarkers }
        : {})}
      {...(activeDiffIsCurrent
        ? {
            onStartThread: (anchors: ThreadAnchor[]) => {
              selection.setComposerAnchors(anchors);
              selection.setSelectedThreadRef(null);
            },
          }
        : {})}
      {...(activeDiffRevisionId !== undefined ? { revisionId: activeDiffRevisionId } : {})}
    />
  );

  return (
    <DiffSection
      diffMode={selection.diffMode}
      emptyTitle={
        spotlightFilterActive
          ? selection.spotlightSelection?.kind === "coverage"
            ? "No unlit changed lines"
            : "No associated files"
          : "No changed files"
      }
      {...(spotlightFilterActive
        ? {
            emptyBody:
              selection.spotlightSelection?.kind === "coverage"
                ? "All current changed lines are covered by at least one View."
                : "This View has no lit regions in the current diff.",
          }
        : {})}
      {...(isWorktreeReview ? { fileTreeFootnote: <UntrackedFilesNote /> } : {})}
      fileTreeModel={fileTreeModel}
      fileTreeWidth={fileTreeWidth}
      files={visibleFiles}
      isScopeLoading={scope.isScopeLoading}
      onDiffModeChange={selection.setDiffMode}
      onFileTreeWidthChange={onFileTreeWidthChange}
      onSelectFile={selection.selectFile}
      scopeBanner={scopeBanner}
      selectedPath={selectedFilePath}
      viewer={viewer}
    />
  );
}
