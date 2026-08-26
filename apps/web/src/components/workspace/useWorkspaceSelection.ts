import { useCallback, useEffect, useState } from "react";

import type {
  RevisionId,
  ThreadRef,
  SpotlightViewRef,
  ThreadAnchor,
  ThreadWithComments,
} from "@greenroom/schemas";

import type { DiffViewerLineMembershipView } from "../DiffViewer";
import { threadAnchorKey, type ThreadFilter } from "../threadTriageUtils";
import type { DiffMode, SpotlightSelection, WorkspaceDrawerSection } from "./workspaceTypes";
import { readWorkspaceDrawerState, writeWorkspaceDrawerState } from "./workspaceUtils";

export interface WorkspaceSelectionController {
  activeThreadFilters: ThreadFilter[];
  clearThreadFilters: () => void;
  composerAnchor: ThreadAnchor | null;
  composerAnchors: ThreadAnchor[];
  diffMode: DiffMode;
  drawerOpen: boolean;
  drawerSection: WorkspaceDrawerSection;
  focusedAnchorKey: string | null;
  navigateToSpotlightMembership: (view: DiffViewerLineMembershipView, anchor: ThreadAnchor) => void;
  navigateToThread: (thread: ThreadWithComments) => void;
  selectedPath: string | null;
  selectedRevisionId: RevisionId | null;
  selectedSpotlightViewRef: SpotlightViewRef | null;
  selectedThreadRef: ThreadRef | null;
  selectFile: (path: string) => void;
  selectRevision: (revisionId: RevisionId) => void;
  selectSection: (section: WorkspaceDrawerSection) => void;
  selectSpotlightCoverage: () => void;
  selectSpotlightView: (viewRef: SpotlightViewRef) => void;
  setComposerAnchors: (anchors: ThreadAnchor[]) => void;
  setDiffMode: (mode: DiffMode) => void;
  setSelectedPath: (path: string | null) => void;
  setSelectedRevisionId: (revisionId: RevisionId | null) => void;
  setSelectedThreadRef: (shortRef: ThreadRef | null) => void;
  setSpotlightSelection: (selection: SpotlightSelection | null) => void;
  spotlightSelection: SpotlightSelection | null;
  toggleDrawer: () => void;
  toggleThreadFilter: (filter: ThreadFilter) => void;
}

/**
 * All workspace view-selection state: which drawer section is active
 * (persisted across loads), the selected file/revision/diff mode, the
 * Spotlight selection that filters the center diff, the thread composer
 * anchors, and the cross-surface navigation handlers that keep them
 * consistent (thread cards jump the diff, membership chips jump into a
 * Spotlight view). Teach is not drawer state: it lives on its own route,
 * and the Spotlight scope banner links there with the selected View.
 */
export function useWorkspaceSelection({
  currentRevisionId,
}: {
  currentRevisionId: RevisionId | null;
}): WorkspaceSelectionController {
  const [drawerState, setDrawerState] = useState(readWorkspaceDrawerState);
  const [selectedRevisionId, setSelectedRevisionId] = useState<RevisionId | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>("unified");
  const [spotlightSelection, setSpotlightSelection] = useState<SpotlightSelection | null>(null);
  const [focusedAnchorKey, setFocusedAnchorKey] = useState<string | null>(null);
  const [composerAnchors, setComposerAnchors] = useState<ThreadAnchor[]>([]);
  const [selectedThreadRef, setSelectedThreadRef] = useState<ThreadRef | null>(null);
  const [activeThreadFilters, setActiveThreadFilters] = useState<ThreadFilter[]>([]);
  const selectedSpotlightViewRef =
    spotlightSelection?.kind === "view" ? spotlightSelection.viewRef : null;

  useEffect(() => {
    writeWorkspaceDrawerState(drawerState);
  }, [drawerState]);

  const navigateToThread = useCallback(
    (thread: ThreadWithComments) => {
      setDrawerState({ open: true, section: "threads" });
      setSelectedRevisionId(
        thread.anchor.revisionId === currentRevisionId ? null : thread.anchor.revisionId,
      );
      setSelectedPath(thread.anchor.filePath);
      setComposerAnchors([]);
      setSelectedThreadRef(thread.shortRef);
    },
    [currentRevisionId],
  );

  const navigateToSpotlightMembership = useCallback(
    (view: DiffViewerLineMembershipView, anchor: ThreadAnchor) => {
      setDrawerState({ open: true, section: "spotlight" });
      setSelectedRevisionId(null);
      setSpotlightSelection({ kind: "view", viewRef: view.displayRef });
      setSelectedPath(anchor.filePath);
      setFocusedAnchorKey(threadAnchorKey(anchor));
      setComposerAnchors([]);
      setSelectedThreadRef(null);
    },
    [],
  );

  const selectSection = useCallback((section: WorkspaceDrawerSection) => {
    setDrawerState({ open: true, section });
    setFocusedAnchorKey(null);
    setComposerAnchors([]);
    setSelectedThreadRef(null);

    if (section === "spotlight") {
      setSelectedRevisionId(null);
    }
  }, []);

  const toggleThreadFilter = useCallback((filter: ThreadFilter) => {
    setActiveThreadFilters((current) =>
      current.includes(filter)
        ? current.filter((candidate) => candidate !== filter)
        : [...current, filter],
    );
  }, []);

  return {
    activeThreadFilters,
    clearThreadFilters: useCallback(() => setActiveThreadFilters([]), []),
    composerAnchor: composerAnchors.at(-1) ?? null,
    composerAnchors,
    diffMode,
    drawerOpen: drawerState.open,
    drawerSection: drawerState.section,
    focusedAnchorKey,
    navigateToSpotlightMembership,
    navigateToThread,
    selectedPath,
    selectedRevisionId,
    selectedSpotlightViewRef,
    selectedThreadRef,
    selectFile: useCallback((path: string) => {
      setSelectedPath(path);
      setComposerAnchors([]);
    }, []),
    selectRevision: useCallback(
      (revisionId: RevisionId) => {
        setSelectedRevisionId(revisionId === currentRevisionId ? null : revisionId);
        setComposerAnchors([]);
      },
      [currentRevisionId],
    ),
    selectSection,
    selectSpotlightCoverage: useCallback(() => {
      setSpotlightSelection({ kind: "coverage" });
      setComposerAnchors([]);
      setSelectedThreadRef(null);
    }, []),
    selectSpotlightView: useCallback((viewRef: SpotlightViewRef) => {
      setSpotlightSelection({ kind: "view", viewRef });
      setComposerAnchors([]);
      setSelectedThreadRef(null);
    }, []),
    setComposerAnchors,
    setDiffMode,
    setSelectedPath,
    setSelectedRevisionId,
    setSelectedThreadRef,
    setSpotlightSelection,
    spotlightSelection,
    toggleDrawer: useCallback(() => {
      setDrawerState((current) => ({ ...current, open: !current.open }));
    }, []),
    toggleThreadFilter,
  };
}
