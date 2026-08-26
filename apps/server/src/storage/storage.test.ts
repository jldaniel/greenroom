import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { resetDatabase, runMigrations } from "./migrations";
import { createWorkflowPersistenceService, type WorkflowStorageIdFactory } from "./workflows";
import { createTestStorage, type TestStorage } from "../testing/storage";
import type { IdFactory, IdPrefix } from "@greenroom/core";
import type { ThreadAnchor, WorkflowConsentSummary } from "@greenroom/schemas";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function deterministicWorkflowIds(): WorkflowStorageIdFactory {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createStorage(): TestStorage {
  return createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
  });
}

function reviewRange() {
  return {
    kind: "branch_to_branch",
    baseRef: { kind: "branch", value: "main" },
    headRef: { kind: "branch", value: "feature/review" },
  } as const;
}

function threadAnchor(reviewDisplayId: string, revisionId: string): ThreadAnchor {
  return {
    reviewDisplayId,
    revisionId,
    filePath: "src/index.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 10,
    lineType: "addition",
    hunkId: null,
    hunkHeader: "@@ -1,1 +1,2 @@",
    contextBefore: ["export function main() {"],
    contextAfter: ["}"],
    originalLineText: "  return true;",
  };
}

function workflowConsentSummary(
  revisionId: string,
  profile: { id: string; name: string; workflowType: string; provider: string; model: string },
): WorkflowConsentSummary {
  return {
    workflowKind: "builtin_review",
    selectedHarness: "claude-code",
    profile: {
      id: profile.id,
      name: profile.name,
      workflowType: "builtin_review",
      provider: "harness",
      model: profile.model,
    },
    reviewDisplayId: "GR-1",
    revisionId,
    scopeLabel: "All changed files",
    changedFiles: {
      fileCount: 1,
      additions: 1,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
      files: [
        {
          path: "src/index.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          isBinary: false,
        },
      ],
      omittedFileCount: 0,
    },
    allowedMcpCapabilities: ["review:read", "revision:read", "diff:read", "draft:submit"],
    expectedMcpResources: [],
    expectedOutputMode: "builtin_review_findings",
    repositoryAccess: {
      mode: "mcp_only",
      readScopeLabel: "Greenroom MCP context only",
      revisionId: null,
      baseSha: null,
      headSha: null,
      workspaceStrategy: null,
    },
    threadCreationGate: null,
    tracingStatus: "disabled",
  };
}

let storage: TestStorage | null = null;

afterEach(() => {
  storage?.cleanup();
  storage = null;
});

describe("SQLite storage", () => {
  it("migrates and resets the initial schema", () => {
    storage = createStorage();

    const tableNames = storage.database.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    expect(tableNames).toEqual([
      "agent_events",
      "capability_tokens",
      "comments",
      "diff_files",
      "diff_hunks",
      "greenroom_migrations",
      "profiles",
      "ref_counters",
      "repositories",
      "review_prs",
      "review_revisions",
      "spotlight_runs",
      "spotlight_view_regions",
      "spotlight_views",
      "threads",
      "workflow_run_events",
      "workflow_run_harness_events",
      "workflow_run_transcripts",
      "workflow_runs",
    ]);

    resetDatabase(storage.database.sqlite);

    const remainingTables = storage.database.sqlite
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get();

    expect(remainingTables?.count).toBe(0);
  });

  it("throws on a database with unknown applied migrations", () => {
    const sqlite = new Database(":memory:");

    try {
      runMigrations(sqlite);
      sqlite
        .query("INSERT INTO greenroom_migrations (id, applied_at) VALUES (?, ?)")
        .run("0002_review_display_ids", fixedNow);

      expect(() => runMigrations(sqlite)).toThrowError(
        "This database was created by an incompatible pre-release version of Greenroom. Delete the Greenroom data directory and restart.",
      );
    } finally {
      sqlite.close();
    }
  });

  it("creates, lists, updates, and de-duplicates repositories by identity", () => {
    storage = createStorage();

    const first = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
      displayName: "Greenroom",
    });
    const duplicate = storage.repositories.create({
      rootPath: "/work/greenroom-copy",
      gitCommonDir: "/work/greenroom/.git",
      displayName: "Copy",
    });
    const updated = storage.repositories.update(first.id, {
      defaultBranchCandidate: "main",
      lastOpenedAt: "2026-06-25T12:30:00.000Z",
    });

    expect(duplicate.id).toBe(first.id);
    expect(updated).toMatchObject({
      id: first.id,
      defaultBranchCandidate: "main",
      lastOpenedAt: "2026-06-25T12:30:00.000Z",
    });
    expect(storage.repositories.list()).toHaveLength(1);
  });

  it("supports profile CRUD without seeded defaults", () => {
    storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    });

    expect(storage.profiles.list()).toEqual([]);

    const custom = storage.profiles.create({
      name: "Mock teaching",
      workflowType: "teaching",
      provider: "mock",
      model: "mock-teacher",
      systemPrompt: "Explain the diff.",
      modelSettings: { temperature: 0 },
      allowedTools: [],
      contextPreferences: { includeQuiz: true },
      privacy: { persistTranscript: false },
    });
    const updated = storage.profiles.update(custom.id, {
      model: "mock-teacher-v2",
      privacy: { persistTranscript: true },
    });
    const listed = storage.profiles.list();
    const deleted = storage.profiles.delete(custom.id);

    expect(custom).toMatchObject({ id: "profile_1", provider: "mock" });
    expect(updated).toMatchObject({
      id: custom.id,
      model: "mock-teacher-v2",
      privacy: { persistTranscript: true },
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: custom.id, model: "mock-teacher-v2" });
    expect(deleted).toMatchObject({ id: custom.id });
    expect(storage.profiles.get(custom.id)).toBeNull();
  });

  it("seeds mock and Claude Code harness default profiles when requested", () => {
    const mockStorage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
      defaultAiBackend: "mock",
    });
    const harnessStorage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
      defaultAiBackend: "harness:claude-code",
    });

    try {
      expect(mockStorage.profiles.ensureDefaults()).toMatchObject([
        {
          name: "Default teaching",
          workflowType: "teaching",
          provider: "mock",
          model: "mock-teacher",
        },
        {
          name: "Default spotlight",
          workflowType: "spotlight",
          provider: "mock",
          model: "mock-spotlight",
        },
      ]);
      expect(harnessStorage.profiles.ensureDefaults()).toMatchObject([
        {
          name: "Default teaching (Claude Code)",
          workflowType: "teaching",
          provider: "harness",
          model: "claude-code",
          description:
            "Seeded from the configured default AI backend override (harness:claude-code).",
          modelSettings: { harness: { kind: "claude-code" } },
        },
        {
          name: "Default spotlight (Claude Code)",
          workflowType: "spotlight",
          provider: "harness",
          model: "claude-code",
          modelSettings: { harness: { kind: "claude-code" } },
        },
        {
          name: "Default AI review (Claude Code)",
          workflowType: "builtin_review",
          provider: "harness",
          model: "claude-code",
          modelSettings: { harness: { kind: "claude-code" } },
        },
      ]);
      expect(JSON.stringify(harnessStorage.profiles.list())).not.toContain("apiKey");
    } finally {
      mockStorage.cleanup();
      harnessStorage.cleanup();
    }
  });

  it("does not seed default profiles when no default AI backend override is configured", () => {
    storage = createStorage();

    expect(storage.profiles.ensureDefaults()).toEqual([]);
    expect(storage.profiles.list()).toEqual([]);
  });

  it("creates review PRs with initial revisions and persisted diff hunks", () => {
    storage = createStorage();
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });

    const created = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
      diffFiles: [
        {
          path: "src/index.ts",
          oldPath: "src/old-index.ts",
          status: "modified",
          isBinary: false,
          additions: 1,
          deletions: 0,
          oldMode: null,
          newMode: null,
          renameMetadata: null,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
              header: "@@ -1,1 +1,2 @@",
              lines: [
                { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "context" },
                { type: "addition", oldLineNumber: null, newLineNumber: 2, content: "added" },
              ],
              sortOrder: 1,
            },
          ],
        },
      ],
    });

    expect(created.review.currentRevisionId).toBe(created.revision.id);
    expect(created.review.displayId).toBe("GR-1");
    expect(storage.reviews.get(created.review.id)).toMatchObject({
      displayId: "GR-1",
      title: "Feature review",
      currentRevisionId: created.revision.id,
    });
    expect(storage.reviews.listRevisions(created.review.id)).toHaveLength(1);
    expect(storage.reviews.listDiffFiles(created.revision.id)[0]?.hunks[0]?.lines).toHaveLength(2);
    expect(storage.reviews.getDiffFile(created.revision.id, "src/index.ts")).toMatchObject({
      path: "src/index.ts",
      oldPath: "src/old-index.ts",
      hunks: [{ lines: [{ content: "context" }, { content: "added" }] }],
    });
    expect(storage.reviews.getDiffFile(created.revision.id, "src/old-index.ts")).toMatchObject({
      path: "src/index.ts",
    });
    expect(storage.reviews.getDiffFile(created.revision.id, "src/missing.ts")).toBeNull();

    const second = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Second review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/second",
      },
      revision: {
        baseSha: "c".repeat(40),
        headSha: "d".repeat(40),
        diffSummary: {
          fileCount: 0,
          additions: 0,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });

    expect(second.review.displayId).toBe("GR-2");

    const closed = storage.reviews.update(second.review.id, { status: "closed" });

    expect(closed).toMatchObject({ id: second.review.id, status: "closed" });
    expect(storage.reviews.list()).toMatchObject([{ id: created.review.id, status: "open" }]);
    expect(storage.reviews.list("closed")).toMatchObject([
      { id: second.review.id, status: "closed" },
    ]);
    expect(storage.reviews.list("all")).toHaveLength(2);
  });

  it("allocates monotonic review display ids and never reuses them", () => {
    storage = createStorage();
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });

    const createReview = (title: string) =>
      storage!.reviews.createWithInitialRevision({
        review: {
          repositoryId: repository.id,
          title,
          range: reviewRange(),
          baseRefDisplay: "main",
          headRefDisplay: "feature/review",
        },
        revision: {
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          diffSummary: {
            fileCount: 0,
            additions: 0,
            deletions: 0,
            binaryFileCount: 0,
            renameCount: 0,
          },
        },
      });

    const first = createReview("First");
    const second = createReview("Second");

    expect(first.review.displayId).toBe("GR-1");
    expect(second.review.displayId).toBe("GR-2");

    // No review-delete path exists in the storage API; remove the row directly
    // to prove the ref counter does not hand the number out again.
    storage.database.sqlite.query("DELETE FROM review_prs WHERE id = ?").run(second.review.id);

    expect(createReview("Third").review.displayId).toBe("GR-3");
  });

  it("stores Spotlight runs, views, regions, health, and review-wide replacement", () => {
    storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
      defaultAiBackend: "mock",
    });
    const [teachingProfile, spotlightProfile] = storage.profiles.ensureDefaults();
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });
    const { review, revision } = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });

    if (teachingProfile === undefined || spotlightProfile === undefined) {
      throw new Error("Default profiles were not created");
    }

    const run = storage.spotlight.createRun({
      reviewDisplayId: review.displayId,
      type: "generate",
      trigger: "manual",
      gated: true,
      revisionId: revision.id,
      profileId: spotlightProfile.id,
    });
    const view = storage.spotlight.createView({
      reviewDisplayId: review.displayId,
      title: "API contract",
      description: "Schema and service changes that define the API surface.",
      intent: "feature",
      orderIndex: 0,
      originRunId: run.id,
      lastReconciledRevisionId: revision.id,
    });
    const regions = storage.spotlight.replaceRegions(view.displayRef, [
      {
        filePath: "src/index.ts",
        oldPath: null,
        anchors: [threadAnchor(review.displayId, revision.id)],
        remapConfidence: 0.95,
      },
    ]);
    const updatedRun = storage.spotlight.updateRun(run.id, {
      status: "awaiting_plan_approval",
      approvedOutline: [
        {
          title: "API contract",
          intent: "feature",
          description: "Review the contract changes first.",
        },
      ],
    });
    const driftedView = storage.spotlight.updateViewHealth(view.displayRef, { health: "drifted" });
    const replaced = storage.spotlight.replaceViewsForReview(review.id, [
      {
        title: "Replacement view",
        description: "Freshly regenerated grouping.",
        intent: "refactor",
        orderIndex: 1,
        originRunId: run.id,
        lastReconciledRevisionId: revision.id,
        regions: [
          {
            filePath: "src/index.ts",
            oldPath: null,
            anchors: [threadAnchor(review.displayId, revision.id)],
            stale: true,
          },
        ],
      },
    ]);

    expect(run).toMatchObject({
      id: "spotlight_run_1",
      profileId: "profile_2",
      status: "pending_consent",
      completedAt: null,
    });
    expect(view).toMatchObject({
      displayRef: "SV-1",
      health: "current",
      originRunId: run.id,
    });
    expect(regions).toMatchObject([
      {
        id: "spotlight_region_1",
        viewRef: view.displayRef,
        anchors: [{ lineNumber: 10 }],
        remapConfidence: 0.95,
        stale: false,
      },
    ]);
    expect(updatedRun).toMatchObject({
      status: "awaiting_plan_approval",
      approvedOutline: [{ title: "API contract" }],
    });
    expect(driftedView).toMatchObject({ displayRef: view.displayRef, health: "drifted" });
    expect(storage.spotlight.getViewWithRegionsByRef(view.displayRef)).toBeNull();
    expect(replaced).toMatchObject([
      {
        displayRef: "SV-2",
        title: "Replacement view",
        regions: [{ id: "spotlight_region_2", stale: true }],
      },
    ]);
    expect(storage.spotlight.listViewsByReview(review.id)).toMatchObject([{ displayRef: "SV-2" }]);
    expect(storage.spotlight.getViewByRef("SV-2")).toMatchObject({ displayRef: "SV-2" });
    expect(storage.spotlight.getViewWithRegionsByRef("SV-2")).toMatchObject({
      displayRef: "SV-2",
      regions: [{ id: "spotlight_region_2" }],
    });
    expect(storage.spotlight.getViewByRef("SV-1")).toBeNull();
    const deletedViews = storage.spotlight.deleteViewsByReview(review.id);
    const deletedRun = storage.spotlight.deleteRun(run.id);

    expect(deletedViews).toMatchObject([{ displayRef: "SV-2" }]);
    expect(storage.spotlight.listViewsWithRegionsByReview(review.id)).toEqual([]);
    expect(deletedRun).toMatchObject({ id: run.id });
    expect(storage.spotlight.listRunsByReview(review.id)).toEqual([]);
  });

  it("allocates globally unique thread refs and stores ordered comments", () => {
    storage = createStorage();
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });
    const { review, revision } = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 0,
          additions: 0,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });

    const first = storage.threads.create({
      reviewDisplayId: review.displayId,
      type: "question",
      source: { kind: "human", displayName: "Reviewer" },
      anchor: threadAnchor(review.displayId, revision.id),
      firstComment: {
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Can this return false?",
      },
    });
    const second = storage.threads.create({
      reviewDisplayId: review.displayId,
      type: "issue",
      severity: "blocking",
      source: { kind: "mcp_client", displayName: "AI Reviewer", clientName: "codex" },
      anchor: threadAnchor(review.displayId, revision.id),
      firstComment: {
        authorKind: "mcp_client",
        authorDisplayName: "AI Reviewer",
        body: "This misses a null path.",
      },
    });
    const reply = storage.threads.addComment({
      threadRef: first.shortRef,
      authorKind: "human",
      authorDisplayName: "Reviewer",
      body: "Confirmed after a second pass.",
    });
    const resolved = storage.threads.transitionStatus(first.shortRef, "resolved");

    expect(first.shortRef).toBe("GT-1");
    expect(first.anchors).toMatchObject([{ lineNumber: 10 }]);
    expect(second.shortRef).toBe("GT-2");
    expect(reply.sortOrder).toBe(2);
    expect(resolved?.status).toBe("resolved");
    expect(storage.threads.getByRef("GT-1")?.comments.map((comment) => comment.sortOrder)).toEqual([
      1, 2,
    ]);
    // Opaque thread ids are no longer resolvable references; only GT-n refs work.
    expect(storage.threads.getByRef("thread_1")).toBeNull();
    expect(storage.threads.listByReview(review.id)).toHaveLength(2);

    // Thread numbering continues across reviews: refs resolve globally
    // without a review id and never restart their sequence for each review.
    const { review: secondReview, revision: secondRevision } =
      storage.reviews.createWithInitialRevision({
        review: {
          repositoryId: repository.id,
          title: "Second review",
          range: reviewRange(),
          baseRefDisplay: "main",
          headRefDisplay: "feature/second",
        },
        revision: {
          baseSha: "c".repeat(40),
          headSha: "d".repeat(40),
          diffSummary: {
            fileCount: 0,
            additions: 0,
            deletions: 0,
            binaryFileCount: 0,
            renameCount: 0,
          },
        },
      });
    const crossReviewThread = storage.threads.create({
      reviewDisplayId: secondReview.displayId,
      type: "note",
      source: { kind: "human", displayName: "Reviewer" },
      anchor: threadAnchor(secondReview.displayId, secondRevision.id),
      firstComment: {
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Numbering continues across reviews.",
      },
    });

    expect(crossReviewThread.shortRef).toBe("GT-3");
    expect(storage.threads.getByRef("GT-3")).toMatchObject({
      reviewDisplayId: secondReview.displayId,
    });
  });

  it("stores workflow runs, ordered events, drafts, validation issues, and final output", () => {
    storage = createStorage();
    const workflows = createWorkflowPersistenceService(storage.database.db, {
      clock: () => fixedNow,
      idFactory: deterministicWorkflowIds(),
    });
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });
    const { review, revision } = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });
    const profile = storage.profiles.create({
      name: "Harness reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code", idleTimeoutMs: 180000 } },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false },
    });
    const consentSummary = workflowConsentSummary(revision.id, profile);
    const run = workflows.createRun({
      workflowKind: "builtin_review",
      revisionId: revision.id,
      profileId: profile.id,
      harnessKind: "claude-code",
      consentSummary,
      approvedScope: {
        label: "All changed files",
        revisionId: revision.id,
        filePaths: ["src/index.ts"],
        changedFiles: consentSummary.changedFiles,
        metadata: { source: "test" },
      },
      metadata: { initiatedBy: "storage.test" },
    });
    const firstEvent = workflows.recordEvent({
      runId: run.id,
      eventType: "lifecycle",
      summary: "Workflow run created.",
    });
    const secondEvent = workflows.recordEvent({
      runId: run.id,
      eventType: "harness_launch",
      summary: "Harness launch requested.",
      metadata: { harnessKind: "claude-code" },
    });
    const queued = workflows.updateStatus(run.id, { status: "queued" });
    const running = workflows.updateStatus(run.id, { status: "running", phase: "drafting" });
    const withValidation = workflows.appendValidationIssues(run.id, [
      {
        code: "missing-test-context",
        message: "Draft should explain which validation context was used.",
        severity: "warning",
        path: ["findings", "0"],
      },
    ]);
    const draft = {
      kind: "builtin_review_findings" as const,
      summary: "Reviewed one changed file.",
      findings: [
        {
          id: "finding-1",
          title: "Missing null handling",
          body: "The changed branch returns before validating this nullable value.",
          type: "issue" as const,
          severity: "major" as const,
          anchorKey: "src/index.ts:head:10",
          confidence: 0.9,
        },
      ],
    };
    const withDraft = workflows.saveDraft(run.id, draft);
    const withFinalOutput = workflows.saveFinalOutput(run.id, draft);
    const completed = workflows.updateStatus(run.id, { status: "completed" });
    const readBack = workflows.readRun(run.id);
    const events = workflows.listEventsByRun(run.id);

    expect(run).toMatchObject({
      id: "workflow_run_1",
      workflowKind: "builtin_review",
      status: "pending_consent",
      phase: "pending_consent",
      errorMessage: null,
    });
    expect(firstEvent).toMatchObject({ id: "workflow_event_1", sequenceNumber: 1 });
    expect(secondEvent).toMatchObject({ id: "workflow_event_2", sequenceNumber: 2 });
    expect(events.map((event) => event.sequenceNumber)).toEqual([1, 2]);
    expect(queued).toMatchObject({ status: "queued", queuedAt: fixedNow });
    expect(running).toMatchObject({ status: "running", phase: "drafting", startedAt: fixedNow });
    expect(withValidation?.validationIssues).toMatchObject([
      { code: "missing-test-context", severity: "warning" },
    ]);
    expect(withDraft).toMatchObject({ draftOutput: { kind: "builtin_review_findings" } });
    expect(withFinalOutput).toMatchObject({ finalOutput: { kind: "builtin_review_findings" } });
    expect(completed).toMatchObject({
      status: "completed",
      finishedAt: fixedNow,
      completedAt: fixedNow,
    });
    expect(readBack).toMatchObject({
      id: run.id,
      status: "completed",
      draftOutput: { findings: [{ anchorKey: "src/index.ts:head:10" }] },
      finalOutput: { summary: "Reviewed one changed file." },
    });
    expect(workflows.listRunsByReview(review.id)).toMatchObject([{ id: run.id }]);
    expect(JSON.stringify(readBack)).not.toContain("token");
  });

  it("cascades workflow runs and events when a review is deleted", () => {
    storage = createStorage();
    const workflows = createWorkflowPersistenceService(storage.database.db, {
      clock: () => fixedNow,
      idFactory: deterministicWorkflowIds(),
    });
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });
    const { review, revision } = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });
    const profile = storage.profiles.create({
      name: "Harness reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code", idleTimeoutMs: 180000 } },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false },
    });
    const run = workflows.createRun({
      workflowKind: "builtin_review",
      revisionId: revision.id,
      profileId: profile.id,
      harnessKind: "claude-code",
      consentSummary: workflowConsentSummary(revision.id, profile),
    });
    const cancelled = workflows.cancelRun(run.id, "User cancelled before launch.");

    expect(cancelled).toMatchObject({
      status: "cancelled",
      phase: "cancelled",
      errorMessage: "User cancelled before launch.",
      cancelledAt: fixedNow,
    });
    workflows.recordEvent({
      runId: run.id,
      eventType: "lifecycle",
      summary: "Workflow run created.",
    });
    storage.database.sqlite.query("DELETE FROM review_prs WHERE id = ?").run(review.id);

    const runCount = storage.database.sqlite
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_runs")
      .get();
    const eventCount = storage.database.sqlite
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM workflow_run_events")
      .get();

    expect(runCount?.count).toBe(0);
    expect(eventCount?.count).toBe(0);
  });

  it("records review-scoped agent events", () => {
    storage = createStorage();
    const repository = storage.repositories.create({
      rootPath: "/work/greenroom",
      gitCommonDir: "/work/greenroom/.git",
    });
    const { review } = storage.reviews.createWithInitialRevision({
      review: {
        repositoryId: repository.id,
        title: "Feature review",
        range: reviewRange(),
        baseRefDisplay: "main",
        headRefDisplay: "feature/review",
      },
      revision: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        diffSummary: {
          fileCount: 0,
          additions: 0,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
    });

    const event = storage.agentEvents.create({
      reviewDisplayId: review.displayId,
      eventType: "attempted_fix",
      source: { kind: "mcp_client", displayName: "Codex", clientName: "codex" },
      threadRefs: ["GT-1"],
      summary: "Attempted to address selected feedback.",
      metadata: { branch: "feature/review" },
    });

    expect(event).toMatchObject({
      id: "event_1",
      reviewDisplayId: review.displayId,
      eventType: "attempted_fix",
      createdAt: fixedNow,
    });
    expect(storage.agentEvents.listByReview(review.id)).toMatchObject([
      {
        id: "event_1",
        source: { kind: "mcp_client", displayName: "Codex" },
        metadata: { branch: "feature/review" },
      },
    ]);
  });

  it("generates hashed capability tokens and revokes them", () => {
    storage = createStorage();

    const created = storage.tokens.create({
      name: "MCP reviewer",
      scopes: ["read", "comment:write"],
    });
    const row = storage.database.sqlite
      .query<
        { token_hash: string },
        [string]
      >("SELECT token_hash FROM capability_tokens WHERE id = ?")
      .get(created.token.id);
    const authenticated = storage.tokens.authenticate(created.plaintextToken);
    const listed = storage.tokens.list();
    const revoked = storage.tokens.revoke(created.token.id);
    const authenticatedAfterRevoke = storage.tokens.authenticate(created.plaintextToken);

    expect(created.plaintextToken).toMatch(/^grt_/u);
    expect(created.token).toMatchObject({
      id: "token_1",
      name: "MCP reviewer",
      scopes: ["read", "comment:write"],
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(row?.token_hash).toMatch(/^sha256:/u);
    expect(row?.token_hash).not.toContain(created.plaintextToken);
    expect(authenticated).toMatchObject({
      id: "token_1",
      lastUsedAt: fixedNow,
    });
    expect(listed).toEqual([
      {
        ...created.token,
        lastUsedAt: fixedNow,
      },
    ]);
    expect(revoked).toMatchObject({ id: "token_1", revokedAt: fixedNow });
    expect(authenticatedAfterRevoke).toBeNull();
    expect(storage.tokens.activeCount()).toBe(0);
  });

  it("rejects expired capability tokens at authentication and stamps them revoked", () => {
    storage = createStorage();

    const expired = storage.tokens.create({
      name: "Expired run grant",
      scopes: ["read"],
      expiresAt: "2026-06-25T11:00:00.000Z",
    });
    const live = storage.tokens.create({
      name: "Live run grant",
      scopes: ["read"],
      expiresAt: "2026-06-25T13:00:00.000Z",
    });
    const durable = storage.tokens.create({
      name: "Durable token",
      scopes: ["read"],
    });

    expect(expired.token).toMatchObject({ expiresAt: "2026-06-25T11:00:00.000Z" });
    expect(storage.tokens.authenticate(expired.plaintextToken)).toBeNull();
    // Lazy sweep on the failed authentication marks the expired token revoked.
    expect(storage.tokens.list().find((token) => token.id === expired.token.id)).toMatchObject({
      revokedAt: fixedNow,
      expiresAt: "2026-06-25T11:00:00.000Z",
    });
    expect(storage.tokens.authenticate(live.plaintextToken)).toMatchObject({
      id: live.token.id,
      expiresAt: "2026-06-25T13:00:00.000Z",
    });
    expect(storage.tokens.authenticate(durable.plaintextToken)).toMatchObject({
      id: durable.token.id,
      expiresAt: null,
    });
    expect(storage.tokens.activeCount()).toBe(2);
  });

  it("sweeps expired capability tokens with revokeExpired", () => {
    storage = createStorage();

    const expired = storage.tokens.create({
      name: "Expired run grant",
      scopes: ["read"],
      expiresAt: "2026-06-25T11:59:59.000Z",
    });
    storage.tokens.create({
      name: "Live run grant",
      scopes: ["read"],
      expiresAt: "2026-06-25T13:00:00.000Z",
    });
    storage.tokens.create({
      name: "Durable token",
      scopes: ["read"],
    });

    expect(storage.tokens.revokeExpired()).toBe(1);
    expect(storage.tokens.list().find((token) => token.id === expired.token.id)).toMatchObject({
      revokedAt: fixedNow,
    });
    expect(storage.tokens.activeCount()).toBe(2);
    expect(storage.tokens.revokeExpired()).toBe(0);
  });
});
