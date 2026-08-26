import type { ReactNode } from "react";
import { Rows3, SplitSquareHorizontal } from "lucide-react";

import type { DiffFile } from "@greenroom/schemas";

import { EmptyState, LoadingBlock } from "../Feedback";
import { FileTree } from "../FileTree";
import type { ControlledFileTreeModel } from "../useFileTreeModel";
import {
  clampFileTreeWidth,
  FILE_TREE_DEFAULT_WIDTH,
  FILE_TREE_MAX_WIDTH,
  FILE_TREE_MIN_WIDTH,
} from "./fileTreeSizing";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";
import type { DiffMode } from "./workspaceTypes";

/**
 * The permanent center surface of the workspace: file tree plus diff
 * toolbar and viewer. It is never swapped out; the Spotlight drawer section
 * filters the file set and adds a scope banner in place. Renders as a
 * fragment so the file tree and diff column sit directly on the workspace
 * grid.
 */
export function DiffSection({
  diffMode,
  emptyBody,
  emptyTitle,
  fileTreeFootnote = null,
  fileTreeModel,
  fileTreeWidth,
  files,
  isScopeLoading,
  onDiffModeChange,
  onFileTreeWidthChange,
  onSelectFile,
  scopeBanner = null,
  selectedPath,
  viewer,
}: {
  diffMode: DiffMode;
  emptyBody?: string;
  emptyTitle: string;
  fileTreeFootnote?: ReactNode;
  fileTreeModel: ControlledFileTreeModel<DiffFile>;
  fileTreeWidth: number;
  files: DiffFile[];
  isScopeLoading: boolean;
  onDiffModeChange: (mode: DiffMode) => void;
  onFileTreeWidthChange: (width: number) => void;
  onSelectFile: (path: string) => void;
  scopeBanner?: ReactNode;
  selectedPath: string | null;
  viewer: ReactNode;
}) {
  return (
    <>
      <div className="relative min-w-0 2xl:sticky 2xl:top-6 2xl:h-[calc(100vh-3rem)] 2xl:self-start">
        <FileTree
          className="2xl:flex 2xl:h-full 2xl:flex-col"
          footnote={fileTreeFootnote}
          listClassName="max-h-[34rem] 2xl:min-h-0 2xl:flex-1 2xl:max-h-none"
          model={fileTreeModel}
          onSelect={onSelectFile}
          selectedPath={selectedPath}
        />
        <WorkspaceResizeHandle
          ariaLabel="Resize file browser"
          className="absolute inset-y-0 -right-3 w-6"
          clampWidth={clampFileTreeWidth}
          defaultWidth={FILE_TREE_DEFAULT_WIDTH}
          edge="right"
          maxWidth={FILE_TREE_MAX_WIDTH}
          minWidth={FILE_TREE_MIN_WIDTH}
          onWidthChange={onFileTreeWidthChange}
          title="Drag to resize file browser; double-click to reset"
          width={fileTreeWidth}
        />
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Rows3 aria-hidden="true" className="size-4 text-accent-ink" />
            Diff
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted-surface p-1">
            <button
              aria-keyshortcuts="U"
              aria-pressed={diffMode === "unified"}
              className={modeButtonClassName(diffMode === "unified")}
              onClick={() => onDiffModeChange("unified")}
              title="Unified diff (U)"
              type="button"
            >
              <Rows3 aria-hidden="true" className="size-4" />
              <span>Unified</span>
            </button>
            <button
              aria-keyshortcuts="S"
              aria-pressed={diffMode === "split"}
              className={modeButtonClassName(diffMode === "split")}
              onClick={() => onDiffModeChange("split")}
              title="Split diff (S)"
              type="button"
            >
              <SplitSquareHorizontal aria-hidden="true" className="size-4" />
              <span>Split</span>
            </button>
          </div>
        </div>

        {scopeBanner}

        {isScopeLoading ? (
          <LoadingBlock label="Loading Spotlight diff" />
        ) : files.length === 0 ? (
          <section className="rounded-lg border border-line bg-surface p-4">
            <EmptyState
              title={emptyTitle}
              {...(emptyBody === undefined ? {} : { body: emptyBody })}
            />
          </section>
        ) : (
          viewer
        )}
      </div>
    </>
  );
}

function modeButtonClassName(active: boolean): string {
  return `inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium ${
    active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
  }`;
}
