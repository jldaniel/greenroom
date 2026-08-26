import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearch } from "@tanstack/react-router";

import type { ReviewReference } from "@greenroom/schemas";

import {
  useHarnessStatus,
  useProfiles,
  useRefreshReview,
  useReview,
  useReviewDiff,
  useReviewRevisions,
  useReviewThreads,
  useReviewWorktreeStatus,
  useWorkflowRuns,
} from "../api/hooks";
import { deriveAiRunReadiness } from "../components/aiReadinessUtils";
import { ApiErrorBannerGroup, EmptyState, LoadingBlock } from "../components/Feedback";
import { RunConsentDialog } from "../components/RunConsentDialog";
import { useFileTreeModel } from "../components/useFileTreeModel";
import { filterThreads, threadAnchors, threadDomId } from "../components/threadTriageUtils";
import {
  pendingRunConfirmationDescription,
  pendingRunConfirmationDetails,
  pendingRunConfirmationTitle,
} from "../components/workspace/runConfirmation";
import { ShortcutOverlay } from "../components/workspace/ShortcutOverlay";
import { FILE_TREE_DEFAULT_WIDTH } from "../components/workspace/fileTreeSizing";
import { WORKSPACE_DRAWER_DEFAULT_WIDTH } from "../components/workspace/workspaceDrawerSizing";
import { useAiReviewRuns } from "../components/workspace/useAiReviewRuns";
import { useRunConfirmationFlow } from "../components/workspace/useRunConfirmationFlow";
import { useSpotlightRuns } from "../components/workspace/useSpotlightRuns";
import { useSpotlightScope } from "../components/workspace/useSpotlightScope";
import { useThreadActions } from "../components/workspace/useThreadActions";
import { useWorkspaceSelection } from "../components/workspace/useWorkspaceSelection";
import { useWorkspaceShortcuts } from "../components/workspace/useWorkspaceShortcuts";
import {
  workspaceDrawerSectionLabels,
  WorkspacePanelTabs,
} from "../components/workspace/WorkspaceDrawer";
import { WorkspaceCenter } from "../components/workspace/WorkspaceCenter";
import { WorkspaceDrawerSections } from "../components/workspace/WorkspaceDrawerSections";
import { WorkspaceHeader } from "../components/workspace/WorkspaceHeader";
import {
  buildWorkspaceStatus,
  spotlightViewSelectionIsStale,
} from "../components/workspace/workspaceUtils";

/**
 * Diff-centric review workspace: the diff (file tree + viewer) is the
 * permanent center surface; a right drawer hosts the Threads, AI Review, and
 * Spotlight sections. Spotlight selection filters the center diff in place
 * while its section is active. Teach lives on its own full-page route; the
 * panel tab bar and the Spotlight scope banner link to it.
 */
export function ReviewWorkspacePage() {
  const params = useParams({ from: "/reviews/$reviewId" });
  const search = useSearch({ from: "/reviews/$reviewId" });
  const reviewReference = params.reviewId as ReviewReference;
  const review = useReview(reviewReference);
  const visibleReviewId = review.data?.review.displayId ?? reviewReference;
  const currentRevisionId = review.data?.review.currentRevisionId ?? null;
  const selection = useWorkspaceSelection({ currentRevisionId });
  const [fileTreeWidth, setFileTreeWidth] = useState(FILE_TREE_DEFAULT_WIDTH);
  const [drawerWidth, setDrawerWidth] = useState(WORKSPACE_DRAWER_DEFAULT_WIDTH);
  const diff = useReviewDiff(reviewReference, selection.selectedRevisionId);
  const revisions = useReviewRevisions(reviewReference);
  const threads = useReviewThreads(reviewReference);
  const refreshReview = useRefreshReview();
  const aiSectionActive = selection.drawerOpen && selection.drawerSection === "ai_review";
  const spotlightSectionActive = selection.drawerOpen && selection.drawerSection === "spotlight";
  const files = useMemo(() => diff.data?.files ?? [], [diff.data?.files]);
  const profiles = useProfiles(aiSectionActive || spotlightSectionActive);
  const builtinReviewProfiles = useMemo(
    () => (profiles.data ?? []).filter((profile) => profile.workflowType === "builtin_review"),
    [profiles.data],
  );
  const spotlightProfile = useMemo(
    () => (profiles.data ?? []).find((profile) => profile.workflowType === "spotlight") ?? null,
    [profiles.data],
  );
  const worktreeStatus = useReviewWorktreeStatus(
    reviewReference,
    aiSectionActive || spotlightSectionActive,
  );
  const worktreeDirty = worktreeStatus.data?.dirty ?? false;
  const aiWorkflowSectionActive = aiSectionActive || spotlightSectionActive;
  // The run list stays enabled (and polls while runs are active) even when
  // the AI drawer sections are closed, so queue positions and
  // linked spotlight workflow runs are current when a section reopens.
  const reviewWorkflowRuns = useWorkflowRuns(reviewReference, true, true);
  const scope = useSpotlightScope({
    files,
    reviewId: reviewReference,
    scopeEnabled: spotlightSectionActive,
    selection: selection.spotlightSelection,
    viewsEnabled: spotlightSectionActive,
  });
  const spotlightSelection = selection.spotlightSelection;
  const setSpotlightSelection = selection.setSpotlightSelection;
  useEffect(() => {
    if (
      !spotlightSectionActive ||
      scope.isLoadingViews ||
      !scope.hasLoadedViews ||
      !spotlightViewSelectionIsStale(spotlightSelection, scope.views)
    ) {
      return;
    }

    setSpotlightSelection(null);
  }, [
    scope.hasLoadedViews,
    scope.isLoadingViews,
    scope.views,
    setSpotlightSelection,
    spotlightSelection,
    spotlightSectionActive,
  ]);
  const ai = useAiReviewRuns({
    currentRevisionId,
    enabled: aiSectionActive,
    profiles: builtinReviewProfiles,
    reviewId: reviewReference,
    reviewWorkflowRuns: reviewWorkflowRuns.data ?? [],
  });
  const spotlight = useSpotlightRuns({
    currentRevisionId,
    enabled: spotlightSectionActive,
    profile: spotlightProfile,
    reviewId: reviewReference,
    reviewWorkflowRuns: reviewWorkflowRuns.data ?? [],
    selectedView: scope.selectedView,
  });
  // Point-of-use readiness for the AI drawer sections: bridge and
  // harness detection state from /api/harness/status, derived per profile
  // provider so mock profiles never block.
  const harnessStatus = useHarnessStatus(aiWorkflowSectionActive);
  const aiReadiness = deriveAiRunReadiness({
    provider: ai.selectedProfile?.provider ?? null,
    status: harnessStatus.data,
  });
  const spotlightReadiness = deriveAiRunReadiness({
    provider: spotlightProfile?.provider ?? null,
    status: harnessStatus.data,
  });
  const spotlightFilterActive = spotlightSectionActive && selection.spotlightSelection !== null;
  const threadActions = useThreadActions({
    reviewId: reviewReference,
    selection,
    spotlightView: spotlightFilterActive ? scope.selectedView : null,
  });
  const visibleFiles = spotlightFilterActive ? scope.scopeFiles : files;
  const fileTreeModel = useFileTreeModel(visibleFiles, selection.selectedPath);
  const selectedFile = useMemo(
    () =>
      visibleFiles.find((file) => file.path === selection.selectedPath) ?? visibleFiles[0] ?? null,
    [selection.selectedPath, visibleFiles],
  );
  const selectedFilePath = selectedFile?.path ?? null;
  const selectedFileIndex = selectedFilePath
    ? fileTreeModel.filteredFiles.findIndex((file) => file.path === selectedFilePath)
    : -1;
  const selectedRevisionIsCurrent =
    diff.data?.revision.id !== undefined && diff.data.revision.id === currentRevisionId;
  const activeDiffRevisionId = spotlightFilterActive
    ? scope.activeScopeRevisionId
    : diff.data?.revision.id;
  const activeDiffIsCurrent =
    activeDiffRevisionId !== undefined && activeDiffRevisionId === currentRevisionId;
  const inlineThreads = useMemo(
    () =>
      selectedFilePath === null || activeDiffRevisionId === undefined
        ? []
        : (threads.data ?? []).filter((thread) =>
            threadAnchors(thread).some(
              (anchor) =>
                anchor.filePath === selectedFilePath && anchor.revisionId === activeDiffRevisionId,
            ),
          ),
    [activeDiffRevisionId, selectedFilePath, threads.data],
  );
  const visiblePanelThreads = useMemo(
    () => filterThreads(threads.data ?? [], selection.activeThreadFilters, selectedFilePath),
    [selection.activeThreadFilters, selectedFilePath, threads.data],
  );
  const runFlow = useRunConfirmationFlow({
    aiConsentMode: ai.consentMode,
    createAiConsent: ai.createConsent,
    recoverAiFingerprint: useCallback(async () => {
      await ai.recoverFingerprint();
      selection.setSelectedRevisionId(null);
    }, [ai.recoverFingerprint, selection.setSelectedRevisionId]),
    spotlightConsentMode: spotlight.consentMode,
    startSpotlightRun: spotlight.startRun,
  });

  useEffect(() => {
    if (visibleFiles.length === 0) {
      if (scope.isScopeLoading) {
        return;
      }

      selection.setSelectedPath(null);
      return;
    }

    if (!visibleFiles.some((file) => file.path === selection.selectedPath)) {
      selection.setSelectedPath(visibleFiles[0]?.path ?? null);
    }
  }, [scope.isScopeLoading, selection.selectedPath, selection.setSelectedPath, visibleFiles]);

  useEffect(() => {
    if (!spotlightSectionActive) {
      return;
    }

    const current = selection.spotlightSelection;

    if (current?.kind === "coverage") {
      return;
    }

    if (
      current?.kind === "view" &&
      scope.views.some((view) => view.displayRef === current.viewRef)
    ) {
      return;
    }

    selection.setSpotlightSelection(
      scope.views[0] === undefined ? null : { kind: "view", viewRef: scope.views[0].displayRef },
    );
  }, [
    scope.views,
    selection.setSpotlightSelection,
    selection.spotlightSelection,
    spotlightSectionActive,
  ]);

  // Deep-linked thread and view refs apply once per page load:
  // the thread link waits for the thread list, the view link first activates
  // the Spotlight section (views only load while it is open) and then selects
  // the matching SV ref. Unknown refs are a no-op.
  const threadDeepLinkApplied = useRef(false);
  const viewDeepLinkApplied = useRef(false);
  const deepLinkThread = search.thread;
  const deepLinkView = search.view;

  useEffect(() => {
    if (deepLinkThread === undefined || threadDeepLinkApplied.current) {
      return;
    }

    if (threads.data === undefined) {
      return;
    }

    threadDeepLinkApplied.current = true;
    const target = threads.data.find((thread) => thread.shortRef === deepLinkThread);

    if (target !== undefined) {
      selection.navigateToThread(target);
    }
  }, [deepLinkThread, selection.navigateToThread, threads.data]);

  useEffect(() => {
    if (deepLinkView === undefined || viewDeepLinkApplied.current) {
      return;
    }

    if (!spotlightSectionActive) {
      selection.selectSection("spotlight");
      return;
    }

    if (!scope.hasLoadedViews) {
      return;
    }

    viewDeepLinkApplied.current = true;
    const target = scope.views.find((view) => view.displayRef === deepLinkView);

    if (target !== undefined) {
      selection.setSpotlightSelection({ kind: "view", viewRef: target.displayRef });
    }
  }, [
    deepLinkView,
    scope.hasLoadedViews,
    scope.views,
    selection.selectSection,
    selection.setSpotlightSelection,
    spotlightSectionActive,
  ]);

  useEffect(() => {
    const target = selection.selectedThreadRef;

    if (target === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(threadDomId(target))
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [inlineThreads.length, selectedFilePath, selection.selectedThreadRef]);

  const selectRelativeFile = useCallback(
    (offset: number) => {
      if (fileTreeModel.filteredFiles.length === 0) {
        return;
      }

      const startIndex = selectedFileIndex >= 0 ? selectedFileIndex : offset > 0 ? -1 : 0;
      const nextIndex =
        (startIndex + offset + fileTreeModel.filteredFiles.length) %
        fileTreeModel.filteredFiles.length;
      const nextFile = fileTreeModel.filteredFiles[nextIndex];

      if (nextFile !== undefined) {
        fileTreeModel.revealPath(nextFile.path);
        selection.selectFile(nextFile.path);
      }
    },
    [fileTreeModel, selectedFileIndex, selection.selectFile],
  );

  const selectRelativeThread = useCallback(
    (offset: number) => {
      if (visiblePanelThreads.length === 0) {
        return;
      }

      const currentIndex = visiblePanelThreads.findIndex(
        (thread) => thread.shortRef === selection.selectedThreadRef,
      );
      const startIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
      const nextIndex =
        (startIndex + offset + visiblePanelThreads.length) % visiblePanelThreads.length;
      const nextThread = visiblePanelThreads[nextIndex];

      if (nextThread !== undefined) {
        selection.navigateToThread(nextThread);
      }
    },
    [selection.navigateToThread, selection.selectedThreadRef, visiblePanelThreads],
  );

  const handleRefreshReview = useCallback(async () => {
    const refreshed = await refreshReview.mutateAsync(reviewReference);

    if (!refreshed.reused) {
      selection.setSelectedRevisionId(null);
    }
  }, [refreshReview, reviewReference, selection.setSelectedRevisionId]);

  const [shortcutOverlayOpen, setShortcutOverlayOpen] = useState(false);

  useWorkspaceShortcuts({
    canClearComposer: selection.composerAnchor !== null,
    canRefresh: !refreshReview.isPending,
    onClearComposer: useCallback(
      () => selection.setComposerAnchors([]),
      [selection.setComposerAnchors],
    ),
    onRefresh: useCallback(() => void handleRefreshReview(), [handleRefreshReview]),
    onSelectRelativeFile: selectRelativeFile,
    onSelectRelativeThread: selectRelativeThread,
    onSetDiffMode: selection.setDiffMode,
    onShowShortcuts: useCallback(() => setShortcutOverlayOpen(true), []),
  });

  const aiReviewError = aiSectionActive ? (profiles.error ?? ai.error) : null;
  const spotlightError = spotlightSectionActive
    ? (scope.error ?? spotlight.error ?? profiles.error)
    : null;
  const isWorkspaceLoading =
    review.isLoading || diff.isLoading || threads.isLoading || revisions.isLoading;
  const workspaceStatus = buildWorkspaceStatus({
    isLoading: isWorkspaceLoading,
    isRefreshing: refreshReview.isPending,
    isSavingThread:
      threadActions.isCreating || threadActions.isReplying || threadActions.isTransitioning,
    sectionLabel: selection.drawerOpen
      ? workspaceDrawerSectionLabels[selection.drawerSection]
      : "Diff",
    selectedFilePath,
    visibleThreadCount: visiblePanelThreads.length,
  });
  const runDialogDescription =
    runFlow.pending === null
      ? null
      : pendingRunConfirmationDescription(runFlow.pending, worktreeDirty);
  return (
    <section aria-labelledby="review-workspace-title" className="space-y-5">
      <p aria-live="polite" className="sr-only" role="status">
        {workspaceStatus}
      </p>
      <WorkspaceHeader review={review.data} visibleReviewId={visibleReviewId} />

      {isWorkspaceLoading ? <LoadingBlock label="Loading review workspace" /> : null}
      <ApiErrorBannerGroup
        errors={[
          review.error,
          diff.error,
          scope.lineMembershipError,
          aiReviewError,
          spotlightError,
          threadActions.error,
          refreshReview.error,
          threads.error,
          revisions.error,
          aiWorkflowSectionActive ? reviewWorkflowRuns.error : null,
        ]}
      />
      {runFlow.trustedRunNotice === null ? null : (
        <p
          aria-live="polite"
          className="break-words rounded-lg border border-line bg-muted-surface px-4 py-3 text-sm text-ink"
          role="status"
        >
          {runFlow.trustedRunNotice}
        </p>
      )}

      {!isWorkspaceLoading && review.error === null && diff.error === null ? (
        <WorkspacePanelTabs
          activeSection={selection.drawerSection}
          drawerOpen={selection.drawerOpen}
          onSelectSection={selection.selectSection}
          onToggleDrawer={selection.toggleDrawer}
          reviewId={reviewReference}
        />
      ) : null}

      {files.length === 0 && !isWorkspaceLoading && diff.error === null ? (
        <EmptyState title="No changed files" />
      ) : null}

      {files.length === 0 ? null : (
        <div
          className={`grid min-w-0 gap-4 ${
            selection.drawerOpen
              ? "2xl:grid-cols-[var(--file-tree-width)_minmax(0,1fr)_var(--workspace-drawer-width)]"
              : "2xl:grid-cols-[var(--file-tree-width)_minmax(0,1fr)]"
          }`}
          style={
            {
              "--file-tree-width": `${fileTreeWidth}px`,
              "--workspace-drawer-width": `${drawerWidth}px`,
            } as CSSProperties
          }
        >
          <WorkspaceCenter
            activeDiffIsCurrent={activeDiffIsCurrent}
            activeDiffRevisionId={activeDiffRevisionId}
            fileTreeModel={fileTreeModel}
            fileTreeWidth={fileTreeWidth}
            inlineThreads={inlineThreads}
            isWorktreeReview={review.data?.review.range.kind === "worktree"}
            reviewReference={reviewReference}
            scope={scope}
            selectedFile={selectedFile}
            selection={selection}
            spotlightFilterActive={spotlightFilterActive}
            threadActions={threadActions}
            visibleFiles={visibleFiles}
            onFileTreeWidthChange={setFileTreeWidth}
          />

          {selection.drawerOpen ? (
            <WorkspaceDrawerSections
              ai={ai}
              aiReadiness={aiReadiness}
              builtinReviewProfiles={builtinReviewProfiles}
              currentRevisionId={currentRevisionId}
              diffRevision={diff.data?.revision}
              drawerWidth={drawerWidth}
              files={files}
              isRefreshing={refreshReview.isPending}
              isThreadsLoading={threads.isLoading}
              onRefresh={() => void handleRefreshReview()}
              onDrawerWidthChange={setDrawerWidth}
              profilesLoading={profiles.isLoading}
              readinessChecking={harnessStatus.isLoading}
              revisions={revisions.data}
              runFlow={runFlow}
              scope={scope}
              selectedFilePath={selectedFilePath}
              selectedRevisionIsCurrent={selectedRevisionIsCurrent}
              selection={selection}
              spotlight={spotlight}
              spotlightProfileReady={spotlightProfile !== null}
              spotlightReadiness={spotlightReadiness}
              threads={threads.data ?? []}
              worktreeDirty={worktreeDirty}
            />
          ) : null}
        </div>
      )}

      {shortcutOverlayOpen ? (
        <ShortcutOverlay onClose={() => setShortcutOverlayOpen(false)} />
      ) : null}

      {runFlow.pending === null ? null : (
        <RunConsentDialog
          confirmLabel={
            runFlow.pending.kind === "fingerprint_recovery" ? "Refresh & retry" : "Confirm & run"
          }
          details={pendingRunConfirmationDetails({
            currentWorktreeHeadSha: worktreeStatus.data?.currentFingerprint?.headSha ?? null,
            files,
            pendingRunConfirmation: runFlow.pending,
            profile: runFlow.pending.kind === "spotlight" ? spotlightProfile : ai.selectedProfile,
            reviewDisplayId: visibleReviewId,
            revisionId: currentRevisionId,
            selectedSpotlightView: scope.selectedView,
          })}
          {...(runDialogDescription === null ? {} : { description: runDialogDescription })}
          isConfirming={
            ai.isCreatingConsent || spotlight.isCreatingRun || ai.isRecoveringFingerprint
          }
          onCancel={runFlow.cancelPending}
          onConfirm={() => void runFlow.confirmPending()}
          title={pendingRunConfirmationTitle(runFlow.pending)}
        />
      )}
    </section>
  );
}
