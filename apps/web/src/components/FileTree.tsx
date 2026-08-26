import { useId, type ReactNode } from "react";
import {
  Binary,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCog,
  FileMinus2,
  FilePenLine,
  FilePlus2,
  FileQuestion,
  FileType2,
  Folder,
  FolderOpen,
  Search,
  X,
} from "lucide-react";

import type { DiffFile, DiffFileStatus } from "@greenroom/schemas";

import type { PreviewDiffFile } from "../api/client";
import type { FileTreeNode } from "./fileTreeModel";
import type { ControlledFileTreeModel } from "./useFileTreeModel";

type FileTreeFile = DiffFile | PreviewDiffFile;

interface FileTreeProps<T extends FileTreeFile> {
  className?: string;
  /** Muted note rendered below the list (e.g. the untracked-files exclusion). */
  footnote?: ReactNode;
  listClassName?: string;
  model: ControlledFileTreeModel<T>;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

export function FileTree<T extends FileTreeFile>({
  className = "",
  footnote = null,
  listClassName = "max-h-[34rem]",
  model,
  selectedPath,
  onSelect,
}: FileTreeProps<T>) {
  const headingId = useId();
  const filterId = useId();

  return (
    <nav
      aria-label="Changed files"
      className={`min-w-0 overflow-hidden rounded-lg border border-line bg-surface ${className}`}
    >
      <div
        className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-normal text-muted"
        id={headingId}
      >
        Files
      </div>
      <div className="border-b border-line p-2">
        <label className="sr-only" htmlFor={filterId}>
          Filter changed files
        </label>
        <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-canvas px-2 focus-within:ring-4 focus-within:ring-accent/30">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <input
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            id={filterId}
            onChange={(event) => model.setFilter(event.target.value)}
            placeholder="Filter files"
            type="search"
            value={model.filter}
          />
          {model.filter.length === 0 ? null : (
            <button
              aria-label="Clear file filter"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-muted-surface hover:text-ink"
              onClick={model.clearFilter}
              title="Clear file filter"
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div aria-labelledby={headingId} className={`${listClassName} overflow-auto`} role="tree">
        <div className="min-w-full py-1">
          {model.tree.length === 0 ? (
            <p
              aria-live="polite"
              className="px-3 py-6 text-center text-sm text-muted"
              role="status"
            >
              No matching files
            </p>
          ) : (
            model.tree.map((node) => (
              <TreeNode
                depth={0}
                key={`${node.kind}:${node.path}`}
                model={model}
                node={node}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            ))
          )}
        </div>
      </div>
      {footnote === null ? null : <div className="border-t border-line px-3 py-2">{footnote}</div>}
    </nav>
  );
}

function TreeNode<T extends FileTreeFile>({
  depth,
  model,
  node,
  onSelect,
  selectedPath,
}: {
  depth: number;
  model: ControlledFileTreeModel<T>;
  node: FileTreeNode<T>;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const inset = `${0.5 + depth * 1.125}rem`;

  if (node.kind === "directory") {
    const expanded = model.isExpanded(node.path);

    return (
      <div aria-expanded={expanded} aria-label={`Directory ${node.path}`} role="treeitem">
        <button
          className="flex h-8 w-max min-w-full items-center gap-1.5 whitespace-nowrap pr-3 text-left text-sm font-medium text-ink hover:bg-muted-surface"
          onClick={() => model.toggleDirectory(node.path)}
          style={{ paddingLeft: inset }}
          title={node.path}
          type="button"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
          )}
          {expanded ? (
            <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />
          ) : (
            <Folder aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />
          )}
          <span>{node.name}</span>
        </button>
        {expanded ? (
          <div role="group">
            {node.children.map((child) => (
              <TreeNode
                depth={depth + 1}
                key={`${child.kind}:${child.path}`}
                model={model}
                node={child}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const file = node.file;
  const selected = file.path === selectedPath;
  const accessibleLabel = fileAccessibleLabel(file);

  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-keyshortcuts="J K"
      aria-label={accessibleLabel}
      className={`flex h-8 w-max min-w-full items-center gap-3 whitespace-nowrap pr-3 text-left text-sm ${
        selected ? "bg-accent-soft text-ink" : "text-ink hover:bg-muted-surface"
      }`}
      onClick={() => {
        model.revealPath(file.path);
        onSelect(file.path);
      }}
      role="treeitem"
      style={{ paddingLeft: inset }}
      title={accessibleLabel}
      type="button"
    >
      <span className="flex items-center gap-2">
        <FileStatusIcon status={file.status} />
        <span>{node.name}</span>
      </span>
      <span aria-hidden="true" className="flex shrink-0 gap-1.5 text-xs tabular-nums">
        <span className="text-success-ink">+{file.additions}</span>
        <span className="text-danger-ink">-{file.deletions}</span>
      </span>
    </button>
  );
}

function FileStatusIcon({ status }: { status: DiffFileStatus }) {
  const className = "size-4 shrink-0";

  switch (status) {
    case "added":
      return <FilePlus2 aria-hidden="true" className={`${className} text-success-ink`} />;
    case "deleted":
      return <FileMinus2 aria-hidden="true" className={`${className} text-danger-ink`} />;
    case "renamed":
      return <FilePenLine aria-hidden="true" className={`${className} text-accent-ink`} />;
    case "copied":
      return <Copy aria-hidden="true" className={`${className} text-accent-ink`} />;
    case "mode_changed":
      return <FileCog aria-hidden="true" className={`${className} text-warning-ink`} />;
    case "type_changed":
      return <FileType2 aria-hidden="true" className={`${className} text-warning-ink`} />;
    case "binary":
      return <Binary aria-hidden="true" className={`${className} text-warning-ink`} />;
    case "modified":
      return <FilePenLine aria-hidden="true" className={`${className} text-muted`} />;
    default:
      return <FileQuestion aria-hidden="true" className={`${className} text-muted`} />;
  }
}

function fileAccessibleLabel(file: FileTreeFile): string {
  const rename = file.oldPath === null ? "" : `, from ${file.oldPath}`;
  return `Open ${file.path}, ${statusLabel(file.status)}${rename}, ${file.additions} additions, ${file.deletions} deletions`;
}

function statusLabel(status: DiffFileStatus): string {
  return status.replaceAll("_", " ");
}
