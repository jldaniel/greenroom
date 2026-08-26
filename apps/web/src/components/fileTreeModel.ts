export interface FileTreePathLike {
  path: string;
}

export interface FileTreeDirectory<T extends FileTreePathLike> {
  children: FileTreeNode<T>[];
  kind: "directory";
  name: string;
  path: string;
}

export interface FileTreeLeaf<T extends FileTreePathLike> {
  file: T;
  kind: "file";
  name: string;
  path: string;
}

export type FileTreeNode<T extends FileTreePathLike> = FileTreeDirectory<T> | FileTreeLeaf<T>;

interface MutableDirectory<T extends FileTreePathLike> {
  directories: Map<string, MutableDirectory<T>>;
  files: Map<string, T>;
  name: string;
  path: string;
}

const nameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** Build a deterministic folder-first tree from POSIX-style relative paths. */
export function buildFileTree<T extends FileTreePathLike>(files: readonly T[]): FileTreeNode<T>[] {
  const root: MutableDirectory<T> = {
    directories: new Map(),
    files: new Map(),
    name: "",
    path: "",
  };

  for (const file of files) {
    const segments = file.path.split("/");
    const fileName = segments.pop();

    if (fileName === undefined || fileName.length === 0) {
      continue;
    }

    let directory = root;

    for (const segment of segments) {
      const path = directory.path.length === 0 ? segment : `${directory.path}/${segment}`;
      let child = directory.directories.get(segment);

      if (child === undefined) {
        child = {
          directories: new Map(),
          files: new Map(),
          name: segment,
          path,
        };
        directory.directories.set(segment, child);
      }

      directory = child;
    }

    directory.files.set(fileName, file);
  }

  return finalizeDirectory(root);
}

/** Prune files that do not contain the case-insensitive full-path query. */
export function filterFileTree<T extends FileTreePathLike>(
  tree: readonly FileTreeNode<T>[],
  filter: string,
): FileTreeNode<T>[] {
  const query = filter.toLowerCase();

  if (query.length === 0) {
    return [...tree];
  }

  const filtered: FileTreeNode<T>[] = [];

  for (const node of tree) {
    if (node.kind === "file") {
      if (node.path.toLowerCase().includes(query)) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterFileTree(node.children, filter);

    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }

  return filtered;
}

/** Flatten files in the same folder-first alphabetical order shown by the tree. */
export function flattenFileTree<T extends FileTreePathLike>(tree: readonly FileTreeNode<T>[]): T[] {
  const files: T[] = [];

  for (const node of tree) {
    if (node.kind === "file") {
      files.push(node.file);
    } else {
      files.push(...flattenFileTree(node.children));
    }
  }

  return files;
}

export function directoryPathsForFile(path: string): string[] {
  const segments = path.split("/");
  segments.pop();

  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function finalizeDirectory<T extends FileTreePathLike>(
  directory: MutableDirectory<T>,
): FileTreeNode<T>[] {
  const directories: FileTreeDirectory<T>[] = [...directory.directories.values()]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((child) => ({
      children: finalizeDirectory(child),
      kind: "directory",
      name: child.name,
      path: child.path,
    }));
  const files: FileTreeLeaf<T>[] = [...directory.files.entries()]
    .sort(([left], [right]) => compareNames(left, right))
    .map(([name, file]) => ({
      file,
      kind: "file",
      name,
      path: file.path,
    }));

  return [...directories, ...files];
}

function compareNames(left: string, right: string): number {
  return nameCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}
