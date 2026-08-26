import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildFileTree,
  directoryPathsForFile,
  filterFileTree,
  flattenFileTree,
  type FileTreeNode,
  type FileTreePathLike,
} from "./fileTreeModel";

export interface ControlledFileTreeModel<T extends FileTreePathLike> {
  allFiles: T[];
  clearFilter: () => void;
  filter: string;
  filteredFiles: T[];
  isExpanded: (path: string) => boolean;
  revealPath: (path: string) => void;
  setFilter: (filter: string) => void;
  toggleDirectory: (path: string) => void;
  tree: FileTreeNode<T>[];
}

/** Shared controlled state for both changed-file tree consumers. */
export function useFileTreeModel<T extends FileTreePathLike>(
  files: readonly T[],
  selectedPath: string | null,
): ControlledFileTreeModel<T> {
  const [filter, setFilter] = useState("");
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const fullTree = useMemo(() => buildFileTree(files), [files]);
  const tree = useMemo(() => filterFileTree(fullTree, filter), [filter, fullTree]);
  const allFiles = useMemo(() => flattenFileTree(fullTree), [fullTree]);
  const filteredFiles = useMemo(() => flattenFileTree(tree), [tree]);
  const revealPath = useCallback((path: string) => {
    const ancestors = new Set(directoryPathsForFile(path));

    setCollapsedDirectories((current) => {
      if (![...ancestors].some((ancestor) => current.has(ancestor))) {
        return current;
      }

      const next = new Set(current);
      ancestors.forEach((ancestor) => next.delete(ancestor));
      return next;
    });
  }, []);

  useEffect(() => {
    if (selectedPath !== null) {
      revealPath(selectedPath);
    }
  }, [revealPath, selectedPath]);

  return useMemo(
    () => ({
      allFiles,
      clearFilter: () => setFilter(""),
      filter,
      filteredFiles,
      isExpanded: (path: string) => filter.length > 0 || !collapsedDirectories.has(path),
      revealPath,
      setFilter,
      toggleDirectory: (path: string) => {
        setCollapsedDirectories((current) => {
          const next = new Set(current);

          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }

          return next;
        });
      },
      tree,
    }),
    [allFiles, collapsedDirectories, filter, filteredFiles, revealPath, tree],
  );
}
