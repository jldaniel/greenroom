import { describe, expect, it } from "vitest";

import type { ThreadWithComments } from "@greenroom/schemas";

import {
  filterThreads,
  sourceDisplayName,
  threadAnchorKey,
  threadAnchorLabel,
} from "./threadTriageUtils";

const anchor: ThreadWithComments["anchor"] = {
  reviewDisplayId: "GR-1",
  revisionId: "revision_1",
  filePath: "src/index.ts",
  oldFilePath: null,
  side: "head",
  lineNumber: 2,
  lineType: "addition",
  hunkId: "diff_hunk_1",
  hunkHeader: "@@ -0,0 +1,2 @@",
  contextBefore: ["export const value ="],
  contextAfter: ["}"],
  originalLineText: "  return 42;",
};

function thread(overrides: Partial<ThreadWithComments>): ThreadWithComments {
  const shortRef = overrides.shortRef ?? "GT-1";

  return {
    reviewDisplayId: "GR-1",
    shortRef,
    status: "open",
    type: "question",
    severity: null,
    source: { kind: "human", displayName: "Reviewer" },
    anchor,
    anchors: [anchor],
    remapConfidence: null,
    outdated: false,
    createdAt: "2026-06-25T12:00:00.000Z",
    updatedAt: "2026-06-25T12:00:00.000Z",
    comments: [
      {
        id: `comment_${shortRef.replace("GT-", "")}`,
        threadRef: shortRef,
        parentCommentId: null,
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Question body",
        sortOrder: 1,
        createdAt: "2026-06-25T12:00:00.000Z",
        editedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("thread triage helpers", () => {
  it("builds stable anchor keys from persisted thread anchors", () => {
    expect(threadAnchorKey(anchor)).toBe("revision_1:src/index.ts::head:addition:2:diff_hunk_1");
    expect(threadAnchorKey({ ...anchor, side: "base", lineType: "deletion" })).toBe(
      "revision_1:src/index.ts::base:deletion:2:diff_hunk_1",
    );
    expect(
      threadAnchorLabel(
        thread({
          anchors: [anchor, { ...anchor, lineNumber: 3, originalLineText: "}" }],
        }),
      ),
    ).toBe("src/index.ts:2-3");
  });

  it("filters threads by status, current file, source, type, severity, and dismissed state", () => {
    const threads = [
      thread({ shortRef: "GT-1" }),
      thread({
        shortRef: "GT-2",
        status: "dismissed",
        type: "issue",
        severity: "blocking",
        source: { kind: "mcp_client", displayName: "AI Reviewer", clientName: "codex" },
      }),
      thread({
        shortRef: "GT-3",
        severity: "major",
        source: { kind: "external_agent", displayName: "External Agent" },
        anchor: { ...anchor, filePath: "src/other.ts", lineNumber: 8 },
        anchors: [{ ...anchor, filePath: "src/other.ts", lineNumber: 8 }],
        outdated: true,
      }),
    ];

    expect(filterThreads(threads, ["open"], "src/index.ts").map((item) => item.shortRef)).toEqual([
      "GT-1",
      "GT-3",
    ]);
    expect(
      filterThreads(threads, ["current-file-unresolved"], "src/index.ts").map(
        (item) => item.shortRef,
      ),
    ).toEqual(["GT-1"]);
    expect(
      filterThreads(threads, ["ai-external"], "src/index.ts").map((item) => item.shortRef),
    ).toEqual(["GT-2", "GT-3"]);
    expect(
      filterThreads(threads, ["open", "ai-external", "has-severity"], "src/index.ts").map(
        (item) => item.shortRef,
      ),
    ).toEqual(["GT-3"]);
    expect(
      filterThreads(threads, ["question"], "src/index.ts").map((item) => item.shortRef),
    ).toEqual(["GT-1", "GT-3"]);
    expect(
      filterThreads(threads, ["outdated"], "src/index.ts").map((item) => item.shortRef),
    ).toEqual(["GT-3"]);
    expect(
      filterThreads(threads, ["dismissed"], "src/index.ts").map((item) => item.shortRef),
    ).toEqual(["GT-2"]);
  });

  it("includes source client and tool attribution in display names", () => {
    expect(
      sourceDisplayName({
        kind: "mcp_client",
        displayName: "AI Reviewer",
        clientName: "codex",
        toolName: "greenroom_create_thread",
      }),
    ).toBe("AI Reviewer / codex / greenroom_create_thread");
  });
});
