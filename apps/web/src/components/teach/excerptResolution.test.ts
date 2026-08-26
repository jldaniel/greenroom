import { describe, expect, it } from "vitest";

import type { TeachingContextFile, TeachingExcerptRef, ThreadAnchor } from "@greenroom/schemas";

import { resolveTeachingExcerpt, teachingExcerptLabel } from "./excerptResolution";

function contextFile(overrides: Partial<TeachingContextFile> = {}): TeachingContextFile {
  return {
    path: "src/service.ts",
    oldPath: null,
    status: "modified",
    isBinary: false,
    additions: 2,
    deletions: 1,
    approximateTokenCount: 100,
    hunks: [
      {
        header: "@@ -10,4 +10,5 @@",
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 5,
        lines: [
          { type: "context", oldLineNumber: 10, newLineNumber: 10, content: "function main() {" },
          { type: "deletion", oldLineNumber: 11, newLineNumber: null, content: "  return old();" },
          { type: "addition", oldLineNumber: null, newLineNumber: 11, content: "  return one();" },
          { type: "addition", oldLineNumber: null, newLineNumber: 12, content: "  return two();" },
          { type: "context", oldLineNumber: 12, newLineNumber: 13, content: "}" },
        ],
      },
      {
        header: "@@ -40,2 +41,2 @@",
        oldStart: 40,
        oldLines: 2,
        newStart: 41,
        newLines: 2,
        lines: [
          { type: "context", oldLineNumber: 40, newLineNumber: 41, content: "export {};" },
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 42,
            content: "export default 1;",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function anchor(overrides: Partial<ThreadAnchor> = {}): ThreadAnchor {
  return {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/service.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 11,
    lineType: "addition",
    hunkId: null,
    hunkHeader: "@@ -10,4 +10,5 @@",
    contextBefore: [],
    contextAfter: [],
    originalLineText: "  return one();",
    ...overrides,
  };
}

describe("teachingExcerptLabel", () => {
  it("labels line ranges with the file, range, and side", () => {
    const ref: TeachingExcerptRef = {
      kind: "lines",
      filePath: "src/service.ts",
      side: "head",
      startLine: 10,
      endLine: 12,
    };

    expect(teachingExcerptLabel(ref)).toBe("src/service.ts:10-12 (head)");
    expect(teachingExcerptLabel({ ...ref, startLine: 12 })).toBe("src/service.ts:12 (head)");
  });

  it("labels anchors with the anchored line and side", () => {
    expect(teachingExcerptLabel({ kind: "anchor", anchor: anchor() })).toBe(
      "src/service.ts:11 (head)",
    );
  });
});

describe("resolveTeachingExcerpt with line ranges", () => {
  it("collects head-side lines across matching hunks with hunk headers", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/service.ts", side: "head", startLine: 11, endLine: 42 },
      [contextFile()],
    );

    expect(resolution.kind).toBe("resolved");

    if (resolution.kind !== "resolved") {
      return;
    }

    expect(resolution.filePath).toBe("src/service.ts");
    expect(resolution.segments).toHaveLength(2);
    expect(resolution.segments[0]?.hunkHeader).toBe("@@ -10,4 +10,5 @@");
    expect(resolution.segments[0]?.lines.map((line) => line.content)).toEqual([
      "  return one();",
      "  return two();",
      "}",
    ]);
    expect(resolution.segments[1]?.lines.map((line) => line.content)).toEqual([
      "export {};",
      "export default 1;",
    ]);
  });

  it("resolves base-side ranges against old line numbers", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/service.ts", side: "base", startLine: 11, endLine: 11 },
      [contextFile()],
    );

    expect(resolution.kind).toBe("resolved");

    if (resolution.kind !== "resolved") {
      return;
    }

    expect(resolution.segments[0]?.lines).toEqual([
      { type: "deletion", oldLineNumber: 11, newLineNumber: null, content: "  return old();" },
    ]);
  });

  it("matches renamed files through oldPath", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/legacy.ts", side: "base", startLine: 11, endLine: 11 },
      [contextFile({ oldPath: "src/legacy.ts" })],
    );

    expect(resolution.kind).toBe("resolved");
  });

  it("falls back when the file is not in the context pack", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/missing.ts", side: "head", startLine: 1, endLine: 2 },
      [contextFile()],
    );

    expect(resolution).toEqual({
      kind: "unresolved",
      label: "src/missing.ts:1-2 (head)",
      reason: "The file is not part of the approved teaching context.",
    });
  });

  it("falls back when the range misses every hunk", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/service.ts", side: "head", startLine: 900, endLine: 950 },
      [contextFile()],
    );

    expect(resolution.kind).toBe("unresolved");

    if (resolution.kind !== "unresolved") {
      return;
    }

    expect(resolution.label).toBe("src/service.ts:900-950 (head)");
  });

  it("falls back for binary files", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "lines", filePath: "src/service.ts", side: "head", startLine: 1, endLine: 1 },
      [contextFile({ isBinary: true, hunks: [] })],
    );

    expect(resolution.kind).toBe("unresolved");
  });
});

describe("resolveTeachingExcerpt with anchors", () => {
  it("resolves the anchored line with surrounding context", () => {
    const resolution = resolveTeachingExcerpt({ kind: "anchor", anchor: anchor() }, [
      contextFile(),
    ]);

    expect(resolution.kind).toBe("resolved");

    if (resolution.kind !== "resolved") {
      return;
    }

    expect(resolution.side).toBe("head");
    expect(resolution.segments).toHaveLength(1);
    expect(resolution.segments[0]?.lines.map((line) => line.content)).toEqual([
      "function main() {",
      "  return old();",
      "  return one();",
      "  return two();",
      "}",
    ]);
  });

  it("resolves base-side anchors against old line numbers", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "anchor", anchor: anchor({ side: "base", lineNumber: 11, lineType: "deletion" }) },
      [contextFile()],
    );

    expect(resolution.kind).toBe("resolved");

    if (resolution.kind !== "resolved") {
      return;
    }

    expect(resolution.segments[0]?.lines.some((line) => line.content === "  return old();")).toBe(
      true,
    );
  });

  it("falls back when the anchored line is missing from the context", () => {
    const resolution = resolveTeachingExcerpt(
      { kind: "anchor", anchor: anchor({ lineNumber: 999 }) },
      [contextFile()],
    );

    expect(resolution).toEqual({
      kind: "unresolved",
      label: "src/service.ts:999 (head)",
      reason: "The anchored line was not found in the teaching context.",
    });
  });
});
