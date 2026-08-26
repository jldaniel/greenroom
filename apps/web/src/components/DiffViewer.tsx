import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, MessageSquarePlus, Search } from "lucide-react";

import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  ReviewDisplayId,
  RevisionId,
  ThreadRef,
  SpotlightViewRef,
  ThreadAnchor,
  ThreadStatus,
  ThreadWithComments,
} from "@greenroom/schemas";

import type { PreviewDiffFile, PreviewDiffHunk } from "../api/client";
import { EmptyState } from "./Feedback";
import { FileStatusBadge } from "./Status";
import { InlineThreadCard, ThreadComposer, type ThreadComposerValues } from "./ThreadTriage";
import { threadAnchorKey, threadAnchors } from "./threadTriageUtils";

type DiffViewerFile = DiffFile | PreviewDiffFile;
type DiffViewerHunk = DiffFile["hunks"][number] | PreviewDiffHunk;

export interface DiffViewerSpotlightMarkers {
  litChangedLineKeys: ReadonlySet<string>;
}

export interface DiffViewerLineMembershipView {
  displayRef: SpotlightViewRef;
  intent: string;
  orderIndex: number;
  title: string;
}

interface DiffViewerProps {
  composerAnchors?: ThreadAnchor[];
  file: DiffViewerFile | null;
  focusedAnchorKey?: string | null;
  initialLineLimit?: number;
  isCreatingThread?: boolean;
  isReplying?: boolean;
  isTransitioning?: boolean;
  lineMemberships?: ReadonlyMap<string, readonly DiffViewerLineMembershipView[]>;
  mode: "unified" | "split";
  onCancelThread?: () => void;
  onCreateThread?: (values: ThreadComposerValues) => void | Promise<void>;
  onNavigateToSpotlightView?: (view: DiffViewerLineMembershipView, anchor: ThreadAnchor) => void;
  onReplyToThread?: (shortRef: ThreadRef, body: string) => void | Promise<void>;
  onStartThread?: (anchors: ThreadAnchor[]) => void;
  onTransitionThread?: (shortRef: ThreadRef, status: ThreadStatus) => void | Promise<void>;
  reviewId?: ReviewDisplayId;
  revisionId?: RevisionId;
  selectedThreadRef?: ThreadRef | null;
  spotlightMarkers?: DiffViewerSpotlightMarkers;
  threads?: ThreadWithComments[];
}

interface ThreadRenderContext {
  composerAnchorKey: string | null;
  onAnchorMouseDown?: (anchor: ThreadAnchor | null, event: React.MouseEvent<HTMLElement>) => void;
  onAnchorMouseEnter?: (anchor: ThreadAnchor | null) => void;
  isCreatingThread: boolean;
  isReplying: boolean;
  isTransitioning: boolean;
  focusedAnchorKey: string | null;
  lineMemberships: ReadonlyMap<string, readonly DiffViewerLineMembershipView[]>;
  onCancelThread?: () => void;
  onCreateThread?: (values: ThreadComposerValues) => void | Promise<void>;
  onNavigateToSpotlightView?: (view: DiffViewerLineMembershipView, anchor: ThreadAnchor) => void;
  onReplyToThread?: (shortRef: ThreadRef, body: string) => void | Promise<void>;
  onStartThread?: (anchors: ThreadAnchor[]) => void;
  onTransitionThread?: (shortRef: ThreadRef, status: ThreadStatus) => void | Promise<void>;
  reviewId?: ReviewDisplayId;
  revisionId?: RevisionId;
  selectedThreadRef: ThreadRef | null;
  selectedAnchorBoundaries: ReadonlyMap<string, SelectedAnchorBoundary>;
  spotlightMarkers?: DiffViewerSpotlightMarkers;
  threadsByAnchor: Map<string, ThreadWithComments[]>;
}

interface DragSelection {
  endKey: string;
  startKey: string;
}

interface DragSelectionState {
  rowsByKey: ReadonlyMap<string, HTMLElement>;
  selection: DragSelection;
}

interface SelectedAnchorBoundary {
  isEnd: boolean;
  isStart: boolean;
}

const emptyLineMemberships = new Map<string, readonly DiffViewerLineMembershipView[]>();

export function DiffViewer({
  composerAnchors = [],
  file,
  focusedAnchorKey = null,
  initialLineLimit,
  isCreatingThread = false,
  isReplying = false,
  isTransitioning = false,
  lineMemberships = emptyLineMemberships,
  mode,
  onCancelThread,
  onCreateThread,
  onNavigateToSpotlightView,
  onReplyToThread,
  onStartThread,
  onTransitionThread,
  reviewId,
  revisionId,
  selectedThreadRef = null,
  spotlightMarkers,
  threads = [],
}: DiffViewerProps) {
  const hunks = file?.hunks ?? [];
  const lineCount = countDiffLines(hunks);
  const fileKey =
    file === null
      ? null
      : `${revisionId ?? "preview"}:${file.path}:${file.additions}:${file.deletions}:${lineCount}`;
  const effectiveInitialLineLimit =
    initialLineLimit ?? defaultInitialLineLimit(hunks.length, lineCount);
  const [lineLimitState, setLineLimitState] = useState<{ key: string | null; limit: number }>({
    key: null,
    limit: Number.POSITIVE_INFINITY,
  });
  const visibleLineLimit =
    lineLimitState.key === fileKey ? lineLimitState.limit : effectiveInitialLineLimit;
  const visibleHunks = useMemo(
    () => limitHunks(hunks, visibleLineLimit),
    [hunks, visibleLineLimit],
  );
  const selectableAnchors = useMemo(
    () => collectSelectableAnchors(reviewId, revisionId, file, visibleHunks),
    [file, reviewId, revisionId, visibleHunks],
  );
  const selectableIndexByKey = useMemo(
    () =>
      new Map(selectableAnchors.map((anchor, index) => [threadAnchorKey(anchor), index] as const)),
    [selectableAnchors],
  );
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const selectedThreadAnchors = useMemo(() => {
    const selectedThread = threads.find((thread) => thread.shortRef === selectedThreadRef);
    return selectedThread === undefined ? [] : threadAnchors(selectedThread);
  }, [selectedThreadRef, threads]);
  const selectedAnchorBoundaries = useMemo(
    () => buildSelectedAnchorBoundaries([composerAnchors, selectedThreadAnchors]),
    [composerAnchors, selectedThreadAnchors],
  );
  const sectionRef = useRef<HTMLElement>(null);
  const visibleLineCount = countDiffLines(visibleHunks);
  const hiddenLineCount = Math.max(0, lineCount - visibleLineCount);
  const isLargeDiff = lineCount > effectiveInitialLineLimit;

  useEffect(() => {
    function handleMouseUp() {
      const dragState = dragSelectionRef.current;

      if (dragState === null) {
        return;
      }

      const selectedAnchors = anchorsFromSelection(
        dragState.selection,
        selectableAnchors,
        selectableIndexByKey,
      );
      updateDragSelectionRows(
        dragState.rowsByKey,
        dragState.selection,
        null,
        selectableAnchors,
        selectableIndexByKey,
      );
      dragSelectionRef.current = null;

      if (selectedAnchors.length > 0) {
        onStartThread?.(selectedAnchors);
      }
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [onStartThread, selectableAnchors, selectableIndexByKey]);

  useEffect(
    () => () => {
      const dragState = dragSelectionRef.current;

      if (dragState !== null) {
        updateDragSelectionRows(
          dragState.rowsByKey,
          dragState.selection,
          null,
          selectableAnchors,
          selectableIndexByKey,
        );
        dragSelectionRef.current = null;
      }
    },
    [fileKey, selectableAnchors, selectableIndexByKey],
  );

  useEffect(() => {
    if (focusedAnchorKey === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(
        sectionRef.current?.querySelectorAll<HTMLElement>("[data-anchor-key]") ?? [],
      ).find((candidate) => candidate.dataset.anchorKey === focusedAnchorKey);

      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fileKey, focusedAnchorKey, visibleHunks]);

  if (file === null) {
    return <EmptyState title="No file selected" />;
  }

  function handleAnchorMouseDown(
    anchor: ThreadAnchor | null,
    event: React.MouseEvent<HTMLElement>,
  ) {
    if (anchor === null || onStartThread === undefined || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const key = threadAnchorKey(anchor);
    const selection = { startKey: key, endKey: key };
    const rowsByKey = collectAnchorRows(sectionRef.current);
    updateDragSelectionRows(rowsByKey, null, selection, selectableAnchors, selectableIndexByKey);
    dragSelectionRef.current = { rowsByKey, selection };
  }

  function handleAnchorMouseEnter(anchor: ThreadAnchor | null) {
    if (anchor === null) {
      return;
    }

    const dragState = dragSelectionRef.current;

    if (dragState === null) {
      return;
    }

    const endKey = threadAnchorKey(anchor);

    if (dragState.selection.endKey === endKey) {
      return;
    }

    const selection = { ...dragState.selection, endKey };
    updateDragSelectionRows(
      dragState.rowsByKey,
      dragState.selection,
      selection,
      selectableAnchors,
      selectableIndexByKey,
    );
    dragSelectionRef.current = { ...dragState, selection };
  }

  const context: ThreadRenderContext = {
    composerAnchorKey:
      composerAnchors.length === 0 ? null : threadAnchorKey(composerAnchors.at(-1)!),
    focusedAnchorKey,
    isCreatingThread,
    isReplying,
    isTransitioning,
    lineMemberships,
    selectedThreadRef,
    selectedAnchorBoundaries,
    threadsByAnchor: groupThreadsByAnchor(threads),
    ...(spotlightMarkers !== undefined ? { spotlightMarkers } : {}),
    ...(onNavigateToSpotlightView !== undefined ? { onNavigateToSpotlightView } : {}),
    ...(onStartThread !== undefined
      ? {
          onAnchorMouseDown: handleAnchorMouseDown,
          onAnchorMouseEnter: handleAnchorMouseEnter,
          onStartThread,
        }
      : {}),
    ...(onCancelThread !== undefined ? { onCancelThread } : {}),
    ...(onCreateThread !== undefined ? { onCreateThread } : {}),
    ...(onReplyToThread !== undefined ? { onReplyToThread } : {}),
    ...(onTransitionThread !== undefined ? { onTransitionThread } : {}),
    ...(reviewId !== undefined ? { reviewId } : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
  };

  return (
    <section
      aria-label={file.path}
      className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface"
      ref={sectionRef}
    >
      <header className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileStatusBadge status={file.status} />
            <h2 className="truncate font-mono text-sm font-medium">{file.path}</h2>
          </div>
          {file.renameMetadata === null ? null : (
            <p className="mt-1 truncate text-xs text-muted">
              {file.renameMetadata.oldPath} to {file.renameMetadata.newPath}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-muted">
          {isLargeDiff ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-warning-ink">
              <Gauge aria-hidden="true" className="size-3.5" />
              Large diff
            </span>
          ) : null}
          <p>
            <span className="text-success-ink">+{file.additions}</span>{" "}
            <span className="text-danger-ink">-{file.deletions}</span>
          </p>
        </div>
      </header>

      {file.isBinary ? (
        <div className="px-4 py-8">
          <EmptyState title="Binary file" body="Textual diff is not available." />
        </div>
      ) : file.hunks.length === 0 ? (
        <div className="px-4 py-8">
          <EmptyState title="No textual hunks" />
        </div>
      ) : (
        <>
          {isLargeDiff ? (
            <LargeDiffNotice
              hiddenLineCount={hiddenLineCount}
              lineCount={lineCount}
              visibleLineCount={visibleLineCount}
            />
          ) : null}
          {mode === "split" ? (
            <SplitDiff context={context} file={file} hunks={visibleHunks} />
          ) : (
            <UnifiedDiff context={context} file={file} hunks={visibleHunks} />
          )}
          {hiddenLineCount > 0 ? (
            <LargeDiffControls
              hiddenLineCount={hiddenLineCount}
              onLoadAll={() => setLineLimitState({ key: fileKey, limit: Number.POSITIVE_INFINITY })}
              onLoadMore={() => setLineLimitState({ key: fileKey, limit: visibleLineLimit + 600 })}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function LargeDiffNotice({
  hiddenLineCount,
  lineCount,
  visibleLineCount,
}: {
  hiddenLineCount: number;
  lineCount: number;
  visibleLineCount: number;
}) {
  return (
    <div
      aria-live="polite"
      className="border-b border-line bg-warning-soft px-4 py-3 text-sm text-warning-ink"
    >
      Showing {visibleLineCount.toLocaleString()} of {lineCount.toLocaleString()} diff lines.
      {hiddenLineCount > 0
        ? " Load more when you need deeper context; thread anchors remain available for visible changed lines."
        : " All lines are visible."}
    </div>
  );
}

function LargeDiffControls({
  hiddenLineCount,
  onLoadAll,
  onLoadMore,
}: {
  hiddenLineCount: number;
  onLoadAll: () => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-muted-surface px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
      <span>
        {hiddenLineCount.toLocaleString()} diff lines hidden to keep the workspace responsive.
      </span>
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
          onClick={onLoadMore}
          type="button"
        >
          Load 600 more
        </button>
        <button
          className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
          onClick={onLoadAll}
          type="button"
        >
          Load all
        </button>
      </div>
    </div>
  );
}

function UnifiedDiff({
  context,
  file,
  hunks,
}: {
  context: ThreadRenderContext;
  file: DiffViewerFile;
  hunks: DiffViewerHunk[];
}) {
  const columns = unifiedDiffColumns(file.hunks);

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-left font-mono text-xs">
        <tbody>
          {hunks.flatMap((hunk, hunkIndex) => [
            <tr className="bg-hunk text-muted" key={`${hunk.header}-${hunkIndex}-header`}>
              <td className="w-16 select-none border-r border-line px-1 py-1 text-center" />
              {columns.showOldLineNumbers ? (
                <td className="w-14 select-none border-r border-line px-2 py-1 text-right" />
              ) : null}
              {columns.showNewLineNumbers ? (
                <td className="w-14 select-none border-r border-line px-2 py-1 text-right" />
              ) : null}
              <td className="px-3 py-1">{hunk.header}</td>
            </tr>,
            ...hunk.lines.flatMap((line, lineIndex) => {
              const anchor = buildAnchor(
                context.reviewId,
                context.revisionId,
                file,
                hunk,
                line,
                lineIndex,
              );
              const inlineRows = renderThreadRows({
                anchor,
                colSpan: columns.colSpan,
                context,
                rowKey: `${hunk.header}-${hunkIndex}-${lineIndex}`,
              });

              return [
                <tr
                  className={lineClassName(line.type, anchor, context)}
                  data-anchor-key={anchor === null ? undefined : threadAnchorKey(anchor)}
                  key={`${hunk.header}-${hunkIndex}-${lineIndex}-line`}
                  {...lineSelectionHandlers(anchor, context)}
                >
                  <td
                    className={threadControlCellClassName(
                      "w-16 select-none border-r border-line/70 px-1 py-0.5 text-center align-top",
                      anchor,
                      context,
                    )}
                    {...threadControlCellSelectionHandlers(anchor, context)}
                  >
                    <LineControls anchor={anchor} context={context} />
                  </td>
                  {columns.showOldLineNumbers ? (
                    <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted align-top">
                      {line.oldLineNumber ?? ""}
                    </td>
                  ) : null}
                  {columns.showNewLineNumbers ? (
                    <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted align-top">
                      {line.newLineNumber ?? ""}
                    </td>
                  ) : null}
                  <td className="whitespace-pre-wrap break-words px-3 py-0.5 align-top">
                    <span className="select-none pr-2 text-muted">{linePrefix(line.type)}</span>
                    {line.content}
                  </td>
                </tr>,
                ...inlineRows,
              ];
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function unifiedDiffColumns(hunks: readonly DiffViewerHunk[]): {
  colSpan: number;
  showNewLineNumbers: boolean;
  showOldLineNumbers: boolean;
} {
  let showOldLineNumbers = false;
  let showNewLineNumbers = false;

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      showOldLineNumbers ||= line.oldLineNumber !== null;
      showNewLineNumbers ||= line.newLineNumber !== null;

      if (showOldLineNumbers && showNewLineNumbers) {
        return { colSpan: 4, showNewLineNumbers, showOldLineNumbers };
      }
    }
  }

  if (!showOldLineNumbers && !showNewLineNumbers) {
    return { colSpan: 4, showNewLineNumbers: true, showOldLineNumbers: true };
  }

  return {
    colSpan: 2 + Number(showOldLineNumbers) + Number(showNewLineNumbers),
    showNewLineNumbers,
    showOldLineNumbers,
  };
}

function SplitDiff({
  context,
  file,
  hunks,
}: {
  context: ThreadRenderContext;
  file: DiffViewerFile;
  hunks: DiffViewerHunk[];
}) {
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-left font-mono text-xs">
        <tbody>
          {hunks.flatMap((hunk, hunkIndex) => [
            <tr className="bg-hunk text-muted" key={`${hunk.header}-${hunkIndex}-split-header`}>
              <td className="w-16 select-none border-r border-line px-1 py-1 text-center" />
              <td className="w-14 select-none border-r border-line px-2 py-1 text-right" />
              <td className="w-1/2 border-r border-line px-3 py-1">{hunk.header}</td>
              <td className="w-16 select-none border-r border-line px-1 py-1 text-center" />
              <td className="w-14 select-none border-r border-line px-2 py-1 text-right" />
              <td className="w-1/2 px-3 py-1">{hunk.header}</td>
            </tr>,
            ...hunk.lines.flatMap((line, lineIndex) => {
              const anchor = buildAnchor(
                context.reviewId,
                context.revisionId,
                file,
                hunk,
                line,
                lineIndex,
              );
              const inlineRows = renderThreadRows({
                anchor,
                colSpan: 6,
                context,
                rowKey: `${hunk.header}-${hunkIndex}-split-${lineIndex}`,
              });

              return [
                <tr
                  className={lineClassName(line.type, anchor, context)}
                  data-anchor-key={anchor === null ? undefined : threadAnchorKey(anchor)}
                  key={`${hunk.header}-${hunkIndex}-split-${lineIndex}`}
                  {...lineSelectionHandlers(anchor, context)}
                >
                  {splitCells(line, anchor, context)}
                </tr>,
                ...inlineRows,
              ];
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function splitCells(line: DiffLine, anchor: ThreadAnchor | null, context: ThreadRenderContext) {
  if (line.type === "addition") {
    return (
      <>
        <td className="w-16 select-none border-r border-line/70 px-1 py-0.5 text-center" />
        <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted" />
        <td className="w-1/2 border-r border-line/70 px-3 py-0.5 text-muted" />
        <td
          className={threadControlCellClassName(
            "w-16 select-none border-r border-line/70 bg-addition px-1 py-0.5 text-center align-top",
            anchor,
            context,
          )}
          {...threadControlCellSelectionHandlers(anchor, context)}
        >
          <LineControls anchor={anchor} context={context} />
        </td>
        <td className="w-14 select-none border-r border-line/70 bg-addition px-2 py-0.5 text-right text-muted align-top">
          {line.newLineNumber ?? ""}
        </td>
        <td className="w-1/2 whitespace-pre-wrap break-words bg-addition px-3 py-0.5 align-top">
          {line.content}
        </td>
      </>
    );
  }

  if (line.type === "deletion") {
    return (
      <>
        <td
          className={threadControlCellClassName(
            "w-16 select-none border-r border-line/70 bg-deletion px-1 py-0.5 text-center align-top",
            anchor,
            context,
          )}
          {...threadControlCellSelectionHandlers(anchor, context)}
        >
          <LineControls anchor={anchor} context={context} />
        </td>
        <td className="w-14 select-none border-r border-line/70 bg-deletion px-2 py-0.5 text-right text-muted align-top">
          {line.oldLineNumber ?? ""}
        </td>
        <td className="w-1/2 whitespace-pre-wrap break-words border-r border-line/70 bg-deletion px-3 py-0.5 align-top">
          {line.content}
        </td>
        <td className="w-16 select-none border-r border-line/70 px-1 py-0.5 text-center" />
        <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted" />
        <td className="w-1/2 px-3 py-0.5 text-muted" />
      </>
    );
  }

  return (
    <>
      <td className="w-16 select-none border-r border-line/70 px-1 py-0.5 text-center" />
      <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-1/2 whitespace-pre-wrap break-words border-r border-line/70 px-3 py-0.5">
        {line.content}
      </td>
      <td className="w-16 select-none border-r border-line/70 px-1 py-0.5 text-center" />
      <td className="w-14 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted">
        {line.newLineNumber ?? ""}
      </td>
      <td className="w-1/2 whitespace-pre-wrap break-words px-3 py-0.5">{line.content}</td>
    </>
  );
}

function renderThreadRows({
  anchor,
  colSpan,
  context,
  rowKey,
}: {
  anchor: ThreadAnchor | null;
  colSpan: number;
  context: ThreadRenderContext;
  rowKey: string;
}): React.ReactNode[] {
  if (anchor === null) {
    return [];
  }

  const anchorKey = threadAnchorKey(anchor);
  const threads = context.threadsByAnchor.get(anchorKey) ?? [];
  const showComposer =
    context.composerAnchorKey === anchorKey &&
    context.onCreateThread !== undefined &&
    context.onCancelThread !== undefined;

  if (threads.length === 0 && !showComposer) {
    return [];
  }

  return [
    <tr className="bg-muted-surface/70" key={`${rowKey}-threads`}>
      <td className="px-3 py-3" colSpan={colSpan}>
        <div className="space-y-3">
          {threads.map((thread) => (
            <InlineThreadCard
              isReplying={context.isReplying}
              isSelected={context.selectedThreadRef === thread.shortRef}
              isTransitioning={context.isTransitioning}
              key={thread.shortRef}
              onReply={context.onReplyToThread ?? noopReply}
              onTransition={context.onTransitionThread ?? noopTransition}
              thread={thread}
            />
          ))}
          {showComposer ? (
            <ThreadComposer
              isSubmitting={context.isCreatingThread}
              onCancel={context.onCancelThread ?? noopCancel}
              onSubmit={context.onCreateThread ?? noopCreateThread}
            />
          ) : null}
        </div>
      </td>
    </tr>,
  ];
}

function LineControls({
  anchor,
  context,
}: {
  anchor: ThreadAnchor | null;
  context: ThreadRenderContext;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <StartThreadButton anchor={anchor} onStartThread={context.onStartThread} />
      <LineMembershipAffordance anchor={anchor} context={context} />
    </div>
  );
}

function LineMembershipAffordance({
  anchor,
  context,
}: {
  anchor: ThreadAnchor | null;
  context: ThreadRenderContext;
}) {
  const [open, setOpen] = useState(false);

  if (anchor === null || context.onNavigateToSpotlightView === undefined) {
    return null;
  }

  const views = context.lineMemberships.get(threadAnchorKey(anchor)) ?? [];

  if (views.length === 0) {
    return null;
  }

  if (views.length === 1) {
    const view = views[0]!;

    return (
      <button
        aria-label={`Open Spotlight view ${view.title} for ${anchor.filePath} line ${anchor.lineNumber}`}
        className="inline-flex size-6 items-center justify-center rounded-md border border-accent/30 bg-accent-soft text-[11px] font-semibold text-accent-ink hover:border-accent"
        onClick={(event) => {
          event.stopPropagation();
          context.onNavigateToSpotlightView?.(view, anchor);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        title={`Spotlight view: ${view.title}`}
        type="button"
      >
        {view.orderIndex + 1}
      </button>
    );
  }

  return (
    <div className="relative inline-flex font-sans">
      <button
        aria-expanded={open}
        aria-label={`Show ${views.length} Spotlight views for ${anchor.filePath} line ${anchor.lineNumber}`}
        className="inline-flex size-6 items-center justify-center rounded-md border border-accent/30 bg-accent-soft text-[11px] font-semibold text-accent-ink hover:border-accent"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        title={`${views.length} Spotlight views`}
        type="button"
      >
        {views.length}
      </button>
      {open ? (
        <div className="absolute left-0 top-7 z-20 min-w-56 rounded-md border border-line bg-surface p-1 text-left text-xs shadow-lg">
          <div className="flex items-center gap-1 px-2 py-1 font-medium text-muted">
            <Search aria-hidden="true" className="size-3.5" />
            Spotlight views
          </div>
          {views.map((view) => (
            <button
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-muted-surface"
              key={view.displayRef}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                context.onNavigateToSpotlightView?.(view, anchor);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              title={view.title}
              type="button"
            >
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-line bg-muted-surface text-[11px] font-semibold text-muted">
                {view.orderIndex + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{view.title}</span>
                <span className="block truncate text-muted">{view.intent}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StartThreadButton({
  anchor,
  onStartThread,
}: {
  anchor: ThreadAnchor | null;
  onStartThread: ((anchors: ThreadAnchor[]) => void) | undefined;
}) {
  if (anchor === null || onStartThread === undefined) {
    return null;
  }

  return (
    <button
      aria-label={`Start thread on ${anchor.side} line ${anchor.lineNumber}`}
      className="inline-flex size-6 cursor-crosshair items-center justify-center rounded-md text-muted hover:bg-surface hover:text-accent-ink"
      onClick={(event) => {
        event.stopPropagation();

        if (event.detail === 0) {
          onStartThread([anchor]);
        }
      }}
      title={`Start thread on ${anchor.side} line ${anchor.lineNumber}`}
      type="button"
    >
      <MessageSquarePlus aria-hidden="true" className="size-4" />
    </button>
  );
}

function buildAnchor(
  reviewId: ReviewDisplayId | undefined,
  revisionId: RevisionId | undefined,
  file: DiffViewerFile,
  hunk: DiffViewerHunk,
  line: DiffLine,
  lineIndex: number,
): ThreadAnchor | null {
  if (reviewId === undefined || revisionId === undefined || !isPersistedHunk(hunk)) {
    return null;
  }

  if (line.type === "addition" && line.newLineNumber !== null) {
    return {
      reviewDisplayId: reviewId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "head",
      lineNumber: line.newLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  if (line.type === "deletion" && line.oldLineNumber !== null) {
    return {
      reviewDisplayId: reviewId,
      revisionId,
      filePath: file.path,
      oldFilePath: file.oldPath,
      side: "base",
      lineNumber: line.oldLineNumber,
      lineType: line.type,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      contextBefore: nearbyContext(hunk.lines, lineIndex, "before"),
      contextAfter: nearbyContext(hunk.lines, lineIndex, "after"),
      originalLineText: line.content,
    };
  }

  return null;
}

function nearbyContext(
  lines: readonly DiffLine[],
  lineIndex: number,
  direction: "after" | "before",
): string[] {
  const windowSize = 3;

  if (direction === "before") {
    return lines
      .slice(Math.max(0, lineIndex - windowSize), lineIndex)
      .map((candidate) => candidate.content);
  }

  return lines
    .slice(lineIndex + 1, lineIndex + 1 + windowSize)
    .map((candidate) => candidate.content);
}

function isPersistedHunk(hunk: DiffViewerHunk): hunk is DiffHunk {
  return "id" in hunk;
}

function collectSelectableAnchors(
  reviewId: ReviewDisplayId | undefined,
  revisionId: RevisionId | undefined,
  file: DiffViewerFile | null,
  hunks: readonly DiffViewerHunk[],
): ThreadAnchor[] {
  if (file === null) {
    return [];
  }

  const anchors: ThreadAnchor[] = [];

  for (const hunk of hunks) {
    for (const [lineIndex, line] of hunk.lines.entries()) {
      const anchor = buildAnchor(reviewId, revisionId, file, hunk, line, lineIndex);

      if (anchor !== null) {
        anchors.push(anchor);
      }
    }
  }

  return anchors;
}

function anchorsFromSelection(
  selection: DragSelection | null,
  anchors: readonly ThreadAnchor[],
  indexByKey: ReadonlyMap<string, number>,
): ThreadAnchor[] {
  if (selection === null) {
    return [];
  }

  const startIndex = indexByKey.get(selection.startKey);
  const endIndex = indexByKey.get(selection.endKey);

  if (startIndex === undefined || endIndex === undefined) {
    return [];
  }

  const low = Math.min(startIndex, endIndex);
  const high = Math.max(startIndex, endIndex);

  return anchors.slice(low, high + 1);
}

interface SelectionInterval {
  high: number;
  low: number;
}

function collectAnchorRows(section: HTMLElement | null): Map<string, HTMLElement> {
  const rowsByKey = new Map<string, HTMLElement>();

  for (const row of section?.querySelectorAll<HTMLElement>("[data-anchor-key]") ?? []) {
    const key = row.dataset.anchorKey;

    if (key !== undefined) {
      rowsByKey.set(key, row);
    }
  }

  return rowsByKey;
}

function updateDragSelectionRows(
  rowsByKey: ReadonlyMap<string, HTMLElement>,
  previousSelection: DragSelection | null,
  nextSelection: DragSelection | null,
  anchors: readonly ThreadAnchor[],
  indexByKey: ReadonlyMap<string, number>,
): void {
  const previous = selectionInterval(previousSelection, indexByKey);
  const next = selectionInterval(nextSelection, indexByKey);

  setSelectionBoundaryClasses(rowsByKey, anchors, previous, false);

  for (const interval of subtractSelectionInterval(previous, next)) {
    setSelectionIntervalClass(rowsByKey, anchors, interval, false);
  }

  for (const interval of subtractSelectionInterval(next, previous)) {
    setSelectionIntervalClass(rowsByKey, anchors, interval, true);
  }

  setSelectionBoundaryClasses(rowsByKey, anchors, next, true);
}

function selectionInterval(
  selection: DragSelection | null,
  indexByKey: ReadonlyMap<string, number>,
): SelectionInterval | null {
  if (selection === null) {
    return null;
  }

  const startIndex = indexByKey.get(selection.startKey);
  const endIndex = indexByKey.get(selection.endKey);

  if (startIndex === undefined || endIndex === undefined) {
    return null;
  }

  return {
    low: Math.min(startIndex, endIndex),
    high: Math.max(startIndex, endIndex),
  };
}

export function subtractSelectionInterval(
  source: SelectionInterval | null,
  excluded: SelectionInterval | null,
): SelectionInterval[] {
  if (source === null) {
    return [];
  }

  if (excluded === null || excluded.high < source.low || excluded.low > source.high) {
    return [source];
  }

  const intervals: SelectionInterval[] = [];

  if (excluded.low > source.low) {
    intervals.push({ low: source.low, high: excluded.low - 1 });
  }

  if (excluded.high < source.high) {
    intervals.push({ low: excluded.high + 1, high: source.high });
  }

  return intervals;
}

function setSelectionIntervalClass(
  rowsByKey: ReadonlyMap<string, HTMLElement>,
  anchors: readonly ThreadAnchor[],
  interval: SelectionInterval,
  selected: boolean,
): void {
  for (let index = interval.low; index <= interval.high; index += 1) {
    const anchor = anchors[index];

    if (anchor !== undefined) {
      rowsByKey.get(threadAnchorKey(anchor))?.classList.toggle("diff-range-selected", selected);
    }
  }
}

function setSelectionBoundaryClasses(
  rowsByKey: ReadonlyMap<string, HTMLElement>,
  anchors: readonly ThreadAnchor[],
  interval: SelectionInterval | null,
  selected: boolean,
): void {
  if (interval === null) {
    return;
  }

  const startAnchor = anchors[interval.low];
  const endAnchor = anchors[interval.high];

  if (startAnchor !== undefined) {
    rowsByKey.get(threadAnchorKey(startAnchor))?.classList.toggle("diff-range-start", selected);
  }

  if (endAnchor !== undefined) {
    rowsByKey.get(threadAnchorKey(endAnchor))?.classList.toggle("diff-range-end", selected);
  }
}

function buildSelectedAnchorBoundaries(
  ranges: readonly (readonly ThreadAnchor[])[],
): Map<string, SelectedAnchorBoundary> {
  const boundaries = new Map<string, SelectedAnchorBoundary>();

  for (const anchors of ranges) {
    for (const [index, anchor] of anchors.entries()) {
      const key = threadAnchorKey(anchor);
      const boundary = boundaries.get(key) ?? { isEnd: false, isStart: false };

      boundary.isStart ||= index === 0;
      boundary.isEnd ||= index === anchors.length - 1;
      boundaries.set(key, boundary);
    }
  }

  return boundaries;
}

function lineSelectionHandlers(
  anchor: ThreadAnchor | null,
  context: ThreadRenderContext,
): React.HTMLAttributes<HTMLTableRowElement> {
  if (anchor === null || context.onAnchorMouseEnter === undefined) {
    return {};
  }

  return {
    onMouseEnter: () => context.onAnchorMouseEnter?.(anchor),
  };
}

function threadControlCellSelectionHandlers(
  anchor: ThreadAnchor | null,
  context: ThreadRenderContext,
): React.HTMLAttributes<HTMLTableCellElement> {
  if (anchor === null || context.onAnchorMouseDown === undefined) {
    return {};
  }

  return {
    onMouseDown: (event) => context.onAnchorMouseDown?.(anchor, event),
  };
}

function threadControlCellClassName(
  baseClassName: string,
  anchor: ThreadAnchor | null,
  context: ThreadRenderContext,
): string {
  const selectable =
    anchor !== null && context.onAnchorMouseDown !== undefined ? " cursor-crosshair" : "";
  return `${baseClassName}${selectable}`;
}

function groupThreadsByAnchor(
  threads: readonly ThreadWithComments[],
): Map<string, ThreadWithComments[]> {
  const grouped = new Map<string, ThreadWithComments[]>();

  for (const thread of threads) {
    const key = threadAnchorKey(thread.anchor);
    const existing = grouped.get(key);

    if (existing === undefined) {
      grouped.set(key, [thread]);
    } else {
      existing.push(thread);
    }
  }

  return grouped;
}

function countDiffLines(hunks: readonly { lines: readonly DiffLine[] }[]): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

function defaultInitialLineLimit(hunkCount: number, lineCount: number): number {
  if (lineCount <= 1_200 && hunkCount <= 80) {
    return Number.POSITIVE_INFINITY;
  }

  return 1_200;
}

function limitHunks<T extends { lines: DiffLine[] }>(hunks: readonly T[], lineLimit: number): T[] {
  if (!Number.isFinite(lineLimit)) {
    return [...hunks];
  }

  const visible: T[] = [];
  let remaining = Math.max(0, lineLimit);

  for (const hunk of hunks) {
    if (remaining <= 0) {
      break;
    }

    if (hunk.lines.length <= remaining) {
      visible.push(hunk);
      remaining -= hunk.lines.length;
      continue;
    }

    visible.push({ ...hunk, lines: hunk.lines.slice(0, remaining) });
    break;
  }

  return visible;
}

function noopReply(): void {
  return undefined;
}

function noopTransition(): void {
  return undefined;
}

function noopCancel(): void {
  return undefined;
}

function noopCreateThread(): void {
  return undefined;
}

function lineClassName(
  type: DiffLine["type"],
  anchor: ThreadAnchor | null,
  context: ThreadRenderContext,
): string {
  const spotlight = spotlightLineClassName(type, anchor, context);
  const focused =
    anchor !== null && context.focusedAnchorKey === threadAnchorKey(anchor)
      ? " diff-line-focused"
      : "";
  const boundary =
    anchor === null ? undefined : context.selectedAnchorBoundaries.get(threadAnchorKey(anchor));
  const selected =
    boundary === undefined
      ? ""
      : ` diff-range-selected${boundary.isStart ? " diff-range-start" : ""}${
          boundary.isEnd ? " diff-range-end" : ""
        }`;

  switch (type) {
    case "addition":
      return `bg-addition${spotlight}${focused}${selected}`;
    case "deletion":
      return `bg-deletion${spotlight}${focused}${selected}`;
    case "no_newline":
      return `bg-warning-soft text-warning-ink${focused}${selected}`;
    default:
      return `bg-surface${focused}${selected}`;
  }
}

function spotlightLineClassName(
  type: DiffLine["type"],
  anchor: ThreadAnchor | null,
  context: ThreadRenderContext,
): string {
  if (
    anchor === null ||
    context.spotlightMarkers === undefined ||
    (type !== "addition" && type !== "deletion")
  ) {
    return "";
  }

  return context.spotlightMarkers.litChangedLineKeys.has(threadAnchorKey(anchor))
    ? " spotlight-line-lit"
    : " spotlight-line-unlit";
}

function linePrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}
