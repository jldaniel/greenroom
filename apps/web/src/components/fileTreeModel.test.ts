import { describe, expect, it } from "vitest";

import { buildFileTree, filterFileTree, flattenFileTree } from "./fileTreeModel";

interface TestFile {
  path: string;
}

function paths(files: readonly TestFile[]): string[] {
  return files.map((file) => file.path);
}

describe("file tree model", () => {
  it("groups shared POSIX directories while preserving root files", () => {
    const tree = buildFileTree([
      { path: "README.md" },
      { path: "src/components/Button.tsx" },
      { path: "src/index.ts" },
      { path: "docs/guide.md" },
    ]);

    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual([
      "directory:docs",
      "directory:src",
      "file:README.md",
    ]);
    expect(tree[1]).toMatchObject({
      kind: "directory",
      path: "src",
      children: [
        {
          kind: "directory",
          path: "src/components",
          children: [{ kind: "file", path: "src/components/Button.tsx" }],
        },
        { kind: "file", path: "src/index.ts" },
      ],
    });
  });

  it("sorts folders first and files alphabetically at every level", () => {
    const files = [
      { path: "zeta.ts" },
      { path: "src/z10.ts" },
      { path: "alpha.ts" },
      { path: "src/z2.ts" },
      { path: "assets/icon.svg" },
    ];

    expect(paths(flattenFileTree(buildFileTree(files)))).toEqual([
      "assets/icon.svg",
      "src/z2.ts",
      "src/z10.ts",
      "alpha.ts",
      "zeta.ts",
    ]);
    expect(paths(flattenFileTree(buildFileTree([...files].reverse())))).toEqual([
      "assets/icon.svg",
      "src/z2.ts",
      "src/z10.ts",
      "alpha.ts",
      "zeta.ts",
    ]);
  });

  it("filters case-insensitive substrings against complete paths", () => {
    const tree = buildFileTree([
      { path: "src/Components/Button.tsx" },
      { path: "src/utils/button.ts" },
      { path: "tests/components.test.ts" },
    ]);

    expect(paths(flattenFileTree(filterFileTree(tree, "COMPONENTS/")))).toEqual([
      "src/Components/Button.tsx",
    ]);
    expect(paths(flattenFileTree(filterFileTree(tree, "button")))).toEqual([
      "src/Components/Button.tsx",
      "src/utils/button.ts",
    ]);
  });

  it("prunes empty directories and returns an empty result when nothing matches", () => {
    const tree = buildFileTree([{ path: "src/index.ts" }, { path: "tests/index.test.ts" }]);

    expect(filterFileTree(tree, "missing")).toEqual([]);
    expect(filterFileTree(tree, "tests/")).toMatchObject([
      {
        kind: "directory",
        path: "tests",
        children: [{ kind: "file", path: "tests/index.test.ts" }],
      },
    ]);
  });
});
