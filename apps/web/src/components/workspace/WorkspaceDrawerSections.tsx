import type {
  DiffFile,
  Profile,
  RevisionId,
  RevisionSnapshot,
  ThreadWithComments,
} from "@greenroom/schemas";

import type { AiRunReadiness } from "../aiReadinessUtils";
import { ThreadPanel } from "../ThreadTriage";
import { AiReviewSection } from "./AiReviewSection";
import { RevisionPanel } from "./RevisionPanel";
import { SpotlightSection } from "./SpotlightSection";
import type { AiReviewRunsController } from "./useAiReviewRuns";
import type { RunConfirmationFlow } from "./useRunConfirmationFlow";
import type { SpotlightRunsController } from "./useSpotlightRuns";
import type { SpotlightScope } from "./useSpotlightScope";
import type { WorkspaceSelectionController } from "./useWorkspaceSelection";
import { WorkspaceDrawer } from "./WorkspaceDrawer";

/**
 * The right drawer's section content: one of Threads, AI Review, or
 * Spotlight, with the revision panel below so revision selection stays
 * reachable from every section. Teach lives on its own route.
 */
export function WorkspaceDrawerSections({
  ai,
  aiReadiness,
  builtinReviewProfiles,
  currentRevisionId,
  diffRevision,
  drawerWidth,
  files,
  isRefreshing,
  isThreadsLoading,
  onRefresh,
  onDrawerWidthChange,
  profilesLoading,
  readinessChecking,
  revisions,
  runFlow,
  scope,
  selectedFilePath,
  selectedRevisionIsCurrent,
  selection,
  spotlight,
  spotlightProfileReady,
  spotlightReadiness,
  threads,
  worktreeDirty,
}: {
  ai: AiReviewRunsController;
  aiReadiness: AiRunReadiness;
  builtinReviewProfiles: Profile[];
  currentRevisionId: RevisionId | null;
  diffRevision: RevisionSnapshot | undefined;
  drawerWidth: number;
  files: DiffFile[];
  isRefreshing: boolean;
  isThreadsLoading: boolean;
  onRefresh: () => void;
  onDrawerWidthChange: (width: number) => void;
  profilesLoading: boolean;
  readinessChecking: boolean;
  revisions: readonly RevisionSnapshot[] | undefined;
  runFlow: RunConfirmationFlow;
  scope: SpotlightScope;
  selectedFilePath: string | null;
  selectedRevisionIsCurrent: boolean;
  selection: WorkspaceSelectionController;
  spotlight: SpotlightRunsController;
  spotlightProfileReady: boolean;
  spotlightReadiness: AiRunReadiness;
  threads: ThreadWithComments[];
  worktreeDirty: boolean;
}) {
  return (
    <WorkspaceDrawer
      activeSection={selection.drawerSection}
      onWidthChange={onDrawerWidthChange}
      width={drawerWidth}
    >
      {selection.drawerSection === "threads" ? (
        <ThreadPanel
          activeFilters={selection.activeThreadFilters}
          isLoading={isThreadsLoading}
          onClearFilters={selection.clearThreadFilters}
          onNavigate={selection.navigateToThread}
          onToggleFilter={selection.toggleThreadFilter}
          selectedFilePath={selectedFilePath}
          selectedThreadRef={selection.selectedThreadRef}
          threads={threads}
        />
      ) : null}
      {selection.drawerSection === "ai_review" ? (
        <AiReviewSection
          ai={ai}
          canPrepare={
            currentRevisionId !== null &&
            ai.profileId !== null &&
            files.length > 0 &&
            ai.selectedProfile?.provider === "harness" &&
            !aiReadiness.blocked
          }
          currentRevisionId={currentRevisionId}
          isCheckingReadiness={readinessChecking}
          isRefreshing={isRefreshing}
          onPrepare={runFlow.requestAiReviewRun}
          onRecoverFingerprint={runFlow.requestFingerprintRecovery}
          onRefreshReview={onRefresh}
          profiles={builtinReviewProfiles}
          readiness={aiReadiness}
          worktreeDirty={worktreeDirty}
        />
      ) : null}
      {selection.drawerSection === "spotlight" ? (
        <SpotlightSection
          canRefineSelectedView={scope.selectedView !== null}
          coverageAnchorCount={scope.coverageAnchorCount}
          coverageFileCount={scope.coverageFileCount}
          isCoverageLoading={scope.isCoverageLoading}
          isLoadingViews={scope.isLoadingViews}
          onSelectCoverage={selection.selectSpotlightCoverage}
          onSelectView={selection.selectSpotlightView}
          onStartRun={runFlow.requestSpotlightRun}
          isCheckingReadiness={readinessChecking}
          profileLoading={profilesLoading}
          profileReady={spotlightProfileReady}
          readiness={spotlightReadiness}
          selection={selection.spotlightSelection}
          spotlight={spotlight}
          views={scope.views}
        />
      ) : null}
      <RevisionPanel
        currentRevisionId={currentRevisionId}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        onSelectRevision={selection.selectRevision}
        revision={diffRevision}
        revisions={revisions}
        selectedRevisionIsCurrent={selectedRevisionIsCurrent}
      />
    </WorkspaceDrawer>
  );
}
