import { describe, expect, it } from "vitest";

import {
  createAgentEvent,
  createCapabilityToken,
  createComment,
  createProfile,
  createRepository,
  createReviewPr,
  createRevisionSnapshot,
  createSpotlightRun,
  createSpotlightView,
  createSpotlightViewRegion,
  createThread,
  DomainInvariantError,
  threadAnchorLineKey,
  transitionThreadStatus,
  type IdFactory,
  type IdPrefix,
} from "./domain";
import type { ThreadAnchor } from "@greenroom/schemas";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

const range = {
  kind: "branch_to_branch",
  baseRef: { kind: "branch", value: "main" },
  headRef: { kind: "branch", value: "feature/review" },
} as const;

const reviewInput = {
  repositoryId: "repo_1",
  displayId: "GR-1",
  title: "Feature review",
  range,
  baseRefDisplay: "main",
  headRefDisplay: "feature/review",
} as const;

const anchor: ThreadAnchor = {
  reviewDisplayId: "GR-1",
  revisionId: "revision_1",
  filePath: "src/index.ts",
  oldFilePath: null,
  side: "head",
  lineNumber: 5,
  lineType: "addition",
  hunkId: null,
  hunkHeader: "@@ -1 +1 @@",
  contextBefore: [],
  contextAfter: [],
  originalLineText: "export const ok = true;",
};

describe("threadAnchorLineKey", () => {
  it("builds the colon-joined per-line key every producer and consumer shares", () => {
    expect(threadAnchorLineKey(anchor)).toBe("GR-1:revision_1:src/index.ts::head:addition:5");
    expect(threadAnchorLineKey({ ...anchor, oldFilePath: "src/old.ts", side: "base" })).toBe(
      "GR-1:revision_1:src/index.ts:src/old.ts:base:addition:5",
    );
  });
});

describe("core domain factories", () => {
  it("creates repositories with derived identity and display name", () => {
    const repository = createRepository(
      { rootPath: "/work/greenroom", gitCommonDir: "/work/greenroom/.git" },
      { clock: () => fixedNow, idFactory: deterministicIds() },
    );

    expect(repository).toMatchObject({
      id: "repo_1",
      identityKey: "/work/greenroom/.git",
      displayName: "greenroom",
      createdAt: fixedNow,
    });
  });

  it("creates review PRs and initial revision snapshots", () => {
    const ids = deterministicIds();
    const review = createReviewPr(reviewInput, { clock: () => fixedNow, idFactory: ids });
    const revision = createRevisionSnapshot(
      {
        reviewDisplayId: review.displayId,
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 1,
          additions: 2,
          deletions: 1,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
      { clock: () => fixedNow, idFactory: ids },
    );

    expect(review.displayId).toBe("GR-1");
    expect(review.currentRevisionId).toBeNull();
    expect(revision).toMatchObject({ id: "revision_1", reviewDisplayId: "GR-1" });
  });

  it("creates anchored threads with first comments and global GT refs", () => {
    const secondAnchor: ThreadAnchor = {
      ...anchor,
      lineNumber: 6,
      originalLineText: "export const stillOk = true;",
    };
    const created = createThread(
      {
        reviewDisplayId: "GR-1",
        type: "issue",
        severity: "major",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        anchors: [anchor, secondAnchor],
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Please handle the failure path.",
        },
      },
      { nextThreadNumber: 12, clock: () => fixedNow, idFactory: deterministicIds() },
    );

    expect(created.thread.shortRef).toBe("GT-12");
    expect(created.thread.status).toBe("open");
    expect(created.thread.anchors.map((threadAnchor) => threadAnchor.lineNumber)).toEqual([5, 6]);
    expect(created.firstComment).toMatchObject({
      threadRef: "GT-12",
      body: "Please handle the failure path.",
      sortOrder: 1,
    });
  });

  it("rejects anchors from a different review", () => {
    expect(() =>
      createThread(
        {
          reviewDisplayId: "GR-2",
          type: "question",
          source: { kind: "human", displayName: "Reviewer" },
          anchor,
          firstComment: {
            authorKind: "human",
            authorDisplayName: "Reviewer",
            body: "Why does this move?",
          },
        },
        { nextThreadNumber: 1, idFactory: deterministicIds() },
      ),
    ).toThrow(DomainInvariantError);
  });

  it("creates ordered comments and transitions thread state", () => {
    const comment = createComment(
      {
        threadRef: "GT-1",
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Follow-up",
      },
      { clock: () => fixedNow, idFactory: deterministicIds(), sortOrder: 2 },
    );

    const { thread } = createThread(
      {
        reviewDisplayId: "GR-1",
        type: "note",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Note",
        },
      },
      { nextThreadNumber: 1, clock: () => fixedNow, idFactory: deterministicIds() },
    );

    const resolved = transitionThreadStatus(thread, "resolved", {
      clock: () => "2026-06-25T12:01:00.000Z",
    });

    expect(comment.sortOrder).toBe(2);
    expect(resolved.status).toBe("resolved");
    expect(resolved.updatedAt).toBe("2026-06-25T12:01:00.000Z");
  });

  it("creates profiles with privacy defaults", () => {
    const profile = createProfile(
      {
        name: "Teaching",
        workflowType: "teaching",
        provider: "mock",
        model: "mock-teacher",
      },
      { clock: () => fixedNow, idFactory: deterministicIds() },
    );

    expect(profile).toMatchObject({
      id: "profile_1",
      privacy: { persistTranscript: true },
    });
  });

  it("creates Spotlight runs, views, and anchored regions", () => {
    const ids = deterministicIds();
    const run = createSpotlightRun(
      {
        reviewDisplayId: "GR-1",
        type: "generate",
        trigger: "manual",
        gated: true,
        revisionId: "revision_1",
        profileId: "profile_1",
      },
      { clock: () => fixedNow, idFactory: ids },
    );
    const view = createSpotlightView(
      {
        reviewDisplayId: "GR-1",
        title: "API contract",
        description: "Schema and domain changes that define the Spotlight feature surface.",
        intent: "feature",
        orderIndex: 0,
        originRunId: run.id,
        lastReconciledRevisionId: "revision_1",
      },
      { clock: () => fixedNow, idFactory: ids, nextViewNumber: 3 },
    );
    const region = createSpotlightViewRegion(
      {
        viewRef: view.displayRef,
        filePath: "src/index.ts",
        oldPath: null,
        anchors: [anchor],
        remapConfidence: 1,
      },
      { idFactory: ids },
    );

    expect(run).toMatchObject({
      id: "spotlight_run_1",
      status: "pending_consent",
      completedAt: null,
    });
    expect(view).toMatchObject({
      id: "spotlight_view_1",
      displayRef: "SV-3",
      health: "current",
      originRunId: run.id,
      createdAt: fixedNow,
    });
    expect(region).toMatchObject({
      id: "spotlight_region_1",
      viewRef: view.displayRef,
      anchors: [{ lineNumber: 5 }],
      stale: false,
    });
  });

  it("creates capability tokens with stored hashes", () => {
    const token = createCapabilityToken(
      {
        name: "MCP reviewer",
        tokenHash: "sha256:test-hash",
        scopes: ["read", "comment:write"],
      },
      { clock: () => fixedNow, idFactory: deterministicIds() },
    );

    expect(token).toMatchObject({
      id: "token_1",
      name: "MCP reviewer",
      tokenHash: "sha256:test-hash",
      scopes: ["read", "comment:write"],
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("creates agent events with event IDs", () => {
    const event = createAgentEvent(
      {
        reviewDisplayId: "GR-1",
        eventType: "attempted_fix",
        source: { kind: "mcp_client", displayName: "Codex", clientName: "codex" },
        threadRefs: ["GT-1"],
        summary: "Attempted to address the selected thread.",
      },
      { clock: () => fixedNow, idFactory: deterministicIds() },
    );

    expect(event).toMatchObject({
      id: "event_1",
      reviewDisplayId: "GR-1",
      eventType: "attempted_fix",
      threadRefs: ["GT-1"],
      metadata: {},
      createdAt: fixedNow,
    });
  });
});
