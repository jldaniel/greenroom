import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type { DiffFile, DiffLine, ThreadAnchor } from "@greenroom/schemas";
import {
  callGreenroomTool,
  createGreenroomHttpClient,
  createGreenroomMcpServer,
  listGreenroomResources,
  listGreenroomResourceTemplates,
  listGreenroomTools,
  readGreenroomResource,
  type ReviewDiffResource,
} from "@greenroom/mcp";

import { createGreenroomApp } from "../apps/server/src/api/app";
import { createGreenroomApiServices } from "../apps/server/src/api/services";
import { createTestStorage, type TestStorage } from "../apps/server/src/testing/storage";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function waitForResult<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  description: string,
): Promise<T> {
  let latest: T;

  for (let poll = 0; poll < 100; poll += 1) {
    latest = read();

    if (predicate(latest)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

async function createReviewRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/review", { create: true });
  repository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await repository.stage();
  await repository.commit("Add feature implementation");

  return repository;
}

function createAuthedRequester(app: ReturnType<typeof createGreenroomApp>, token: string) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);

    return app.request(path, {
      ...init,
      headers,
    });
  };
}

function createAppFetch(app: ReturnType<typeof createGreenroomApp>) {
  return (input: string, init?: RequestInit) => {
    const url = new URL(input);
    return app.request(`${url.pathname}${url.search}`, init);
  };
}

function findFirstChangedLine(files: DiffFile[]): {
  file: DiffFile;
  line: DiffLine & { type: "addition"; newLineNumber: number };
} {
  for (const file of files) {
    for (const hunk of file.hunks) {
      const line = hunk.lines.find(
        (candidate): candidate is DiffLine & { type: "addition"; newLineNumber: number } =>
          candidate.type === "addition" && candidate.newLineNumber !== null,
      );

      if (line !== undefined) {
        return { file, line };
      }
    }
  }

  throw new Error("Fixture diff did not include an addition line");
}

function anchorForChangedLine(
  reviewDisplayId: string,
  revisionId: string,
  file: DiffFile,
  line: DiffLine & { type: "addition"; newLineNumber: number },
): ThreadAnchor {
  const hunk = file.hunks.find((candidate) => candidate.lines.includes(line));

  if (hunk === undefined) {
    throw new Error("Fixture line did not belong to a hunk");
  }

  return {
    reviewDisplayId,
    revisionId,
    filePath: file.path,
    oldFilePath: file.oldPath,
    side: "head",
    lineNumber: line.newLineNumber,
    lineType: line.type,
    hunkId: hunk.id,
    hunkHeader: hunk.header,
    contextBefore: [],
    contextAfter: [],
    originalLineText: line.content,
  };
}

async function createMcpReviewFixture() {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
  });
  storages.push(storage);
  const repository = await createReviewRepository();
  const services = createGreenroomApiServices(storage.database, {
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
  });
  const app = createGreenroomApp({ services });
  const adminToken = services.tokens.create({ name: "MCP admin", scopes: ["admin"] });
  const request = createAuthedRequester(app, adminToken.plaintextToken);

  await request("/api/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: repository.directory }),
  });
  await request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repositoryId: "repo_1",
      title: "Feature review",
      baseRef: "main",
      headRef: "feature/review",
    }),
  });

  const client = createGreenroomHttpClient({
    baseUrl: "http://greenroom.test",
    token: adminToken.plaintextToken,
    fetch: createAppFetch(app),
  });

  return { app, client, request, services };
}

async function generateSpotlightView(fixture: Awaited<ReturnType<typeof createMcpReviewFixture>>) {
  const spotlightProfile = await fixture.request("/api/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Mock spotlight",
      workflowType: "spotlight",
      provider: "mock",
      model: "mock-spotlight",
      systemPrompt: null,
      modelSettings: {},
      allowedTools: [],
      contextPreferences: {},
      // Trusted consent: the run below starts without an explicit approval.
      privacy: { persistTranscript: false, consentMode: "trusted" },
    }),
  });
  const spotlightProfilePayload = (await json(spotlightProfile)) as { profile: { id: string } };
  const spotlightRun = await fixture.request("/api/reviews/GR-1/spotlight/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "generate",
      trigger: "manual",
      gated: false,
      revisionId: "revision_1",
      profileId: spotlightProfilePayload.profile.id,
    }),
  });
  const spotlightRunPayload = (await json(spotlightRun)) as { run: { id: string } };
  const storedReview = fixture.services.reviews.getByDisplayId("GR-1");

  if (storedReview === null) {
    throw new Error("Fixture review GR-1 was not found");
  }

  await waitForResult(
    () => fixture.services.spotlight.listViewsWithRegionsByReview(storedReview.id),
    (views) => views.length > 0,
    `fixture Spotlight views for ${spotlightRunPayload.run.id}`,
  );

  const listedViews = (await callGreenroomTool(fixture.client, "greenroom_get_spotlight_views", {
    reviewId: "GR-1",
  })) as {
    views: Array<{ displayRef: string; title: string; associatedFiles: Array<{ path: string }> }>;
  };
  const firstView = listedViews.views[0];

  if (firstView === undefined) {
    throw new Error("Fixture Spotlight run did not create a view");
  }

  return { firstView, listedViews, spotlightProfile, spotlightRun };
}

async function createMcpThread(fixture: Awaited<ReturnType<typeof createMcpReviewFixture>>) {
  const diff = (await callGreenroomTool(fixture.client, "greenroom_get_diff", {
    reviewId: "GR-1",
  })) as ReviewDiffResource;
  const { file, line } = findFirstChangedLine(diff.files);
  const secondLine = file.hunks
    .flatMap((hunk) => hunk.lines)
    .find(
      (candidate): candidate is DiffLine & { type: "addition"; newLineNumber: number } =>
        candidate.type === "addition" &&
        candidate.newLineNumber !== null &&
        candidate.newLineNumber !== line.newLineNumber,
    );

  if (secondLine === undefined) {
    throw new Error("Fixture diff did not include a second addition line");
  }

  const anchor = anchorForChangedLine("GR-1", diff.revision.id, file, line);
  const secondAnchor = anchorForChangedLine("GR-1", diff.revision.id, file, secondLine);
  const createdThread = await callGreenroomTool(fixture.client, "greenroom_create_thread", {
    reviewDisplayId: "GR-1",
    type: "issue",
    severity: "major",
    source: { kind: "mcp_client", displayName: "AI Reviewer", clientName: "codex" },
    anchor,
    anchors: [anchor, secondAnchor],
    firstComment: {
      authorKind: "mcp_client",
      authorDisplayName: "AI Reviewer",
      body: "Please extract this magic value.",
    },
  });

  return { anchor, createdThread, file, secondAnchor };
}

const storages: TestStorage[] = [];
const repositories: TestGitRepository[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }

  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

describe("Greenroom MCP adapter", () => {
  it("reads reviews, diffs, anchors, and Spotlight resources", async () => {
    const fixture = await createMcpReviewFixture();
    const { firstView, listedViews, spotlightProfile, spotlightRun } =
      await generateSpotlightView(fixture);
    const listed = await callGreenroomTool(fixture.client, "greenroom_list_reviews", {});
    const read = await callGreenroomTool(fixture.client, "greenroom_get_review", {
      reviewId: "GR-1",
    });
    const diff = (await callGreenroomTool(fixture.client, "greenroom_get_diff", {
      reviewId: "GR-1",
    })) as ReviewDiffResource;
    const readView = await callGreenroomTool(fixture.client, "greenroom_get_view", {
      viewRef: firstView.displayRef,
    });
    const viewDiff = await callGreenroomTool(fixture.client, "greenroom_get_view_diff", {
      viewRef: firstView.displayRef,
    });
    const lineMembership = await callGreenroomTool(
      fixture.client,
      "greenroom_get_line_membership",
      { reviewId: "GR-1" },
    );
    const spotlightViewsResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/spotlight/views",
    );
    const spotlightViewDiffResource = await readGreenroomResource(
      fixture.client,
      `greenroom://spotlight/views/${firstView.displayRef}/diff`,
    );
    const manifestResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/manifest",
    );
    const diffSummaryResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/diff-summary",
    );
    const changedFilesResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/files",
    );
    const spotlightCoverageResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/spotlight/coverage",
    );
    const { file } = findFirstChangedLine(diff.files);
    const pathScopedFileResource = await readGreenroomResource(
      fixture.client,
      `greenroom://reviews/GR-1/files/${encodeURIComponent(file.path)}`,
    );
    const anchorRegistryResource = await readGreenroomResource(
      fixture.client,
      `greenroom://reviews/GR-1/anchors/${encodeURIComponent(file.path)}`,
    );
    const listedChangedFiles = await callGreenroomTool(
      fixture.client,
      "greenroom_list_changed_files",
      { reviewId: "GR-1", limit: 1 },
    );
    const readDiffFile = await callGreenroomTool(fixture.client, "greenroom_read_diff_file", {
      reviewId: "GR-1",
      path: file.path,
    });
    const searchedDiff = await callGreenroomTool(fixture.client, "greenroom_search_diff", {
      reviewId: "GR-1",
      query: "return 42",
    });
    const anchorRegistry = await callGreenroomTool(
      fixture.client,
      "greenroom_get_anchor_registry",
      {
        reviewId: "GR-1",
        path: file.path,
      },
    );
    const anchorRegistryAgain = await callGreenroomTool(
      fixture.client,
      "greenroom_get_anchor_registry",
      { reviewId: "GR-1", path: file.path },
    );
    const spotlightViewsRead = await callGreenroomTool(
      fixture.client,
      "greenroom_get_spotlight_views",
      { reviewId: "GR-1" },
    );
    const viewDiffRead = await callGreenroomTool(fixture.client, "greenroom_get_view_diff", {
      viewRef: firstView.displayRef,
      path: file.path,
    });
    expect(spotlightProfile.status).toBe(201);
    expect(spotlightRun.status).toBe(201);
    expect(listed).toMatchObject({ reviews: [{ review: { displayId: "GR-1" } }] });
    expect(read).toMatchObject({
      review: { displayId: "GR-1" },
      currentRevision: { id: "revision_1" },
    });
    expect(diff.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "src/index.ts" })]),
    );
    expect(listedViews).toMatchObject({
      views: [
        {
          displayRef: "SV-1",
          title: "Implementation changes",
          associatedFiles: [{ path: "src/index.ts" }],
        },
      ],
    });
    expect(readView).toMatchObject({
      view: {
        displayRef: "SV-1",
        regions: [{ id: "spotlight_region_1", filePath: "src/index.ts" }],
      },
    });
    expect(viewDiff).toMatchObject({
      view: { displayRef: "SV-1" },
      revision: { id: "revision_1" },
      files: [{ path: "src/index.ts" }],
    });
    expect(lineMembership).toMatchObject({
      memberships: expect.arrayContaining([
        expect.objectContaining({
          views: expect.arrayContaining([expect.objectContaining({ displayRef: "SV-1" })]),
        }),
      ]),
    });
    expect(JSON.parse(spotlightViewsResource.text)).toMatchObject({
      views: [{ displayRef: "SV-1" }],
    });
    expect(JSON.parse(spotlightViewDiffResource.text)).toMatchObject({
      view: { displayRef: "SV-1" },
      files: [{ path: "src/index.ts" }],
    });
    expect(JSON.parse(manifestResource.text)).toMatchObject({
      schemaVersion: "greenroom.mcp.review-manifest.v1",
      repository: { displayName: expect.any(String) },
      resources: { files: "greenroom://reviews/GR-1/files" },
    });
    expect(JSON.stringify(JSON.parse(manifestResource.text))).not.toContain("identityKey");
    expect(JSON.parse(diffSummaryResource.text)).toMatchObject({
      diffSummary: { fileCount: 1 },
      currentRevisionOnly: true,
    });
    expect(JSON.parse(changedFilesResource.text)).toMatchObject({
      files: [{ path: "src/index.ts", resourceUri: "greenroom://reviews/GR-1/files/src/index.ts" }],
    });
    expect(JSON.parse(pathScopedFileResource.text)).toMatchObject({
      file: {
        path: "src/index.ts",
        hunks: [
          {
            lines: expect.arrayContaining([
              expect.objectContaining({
                anchorKey: expect.stringContaining("GR-1:revision_1:src/index.ts"),
              }),
            ]),
          },
        ],
      },
    });
    expect(JSON.parse(anchorRegistryResource.text)).toMatchObject({
      anchors: expect.arrayContaining([
        expect.objectContaining({
          anchorKey: expect.stringContaining("GR-1:revision_1:src/index.ts"),
        }),
      ]),
    });
    expect(JSON.parse(spotlightCoverageResource.text)).toMatchObject({
      reviewDisplayId: "GR-1",
      revisionId: "revision_1",
    });
    expect(listedChangedFiles).toMatchObject({ files: [{ path: "src/index.ts" }] });
    expect(readDiffFile).toMatchObject({ file: { path: "src/index.ts" } });
    expect(searchedDiff).toMatchObject({
      matches: [expect.objectContaining({ matchType: "line" })],
    });
    expect(anchorRegistry).toEqual(anchorRegistryAgain);
    expect(anchorRegistry).toMatchObject({
      anchors: expect.arrayContaining([
        expect.objectContaining({
          anchorKey: expect.stringContaining("GR-1:revision_1:src/index.ts"),
        }),
      ]),
    });
    expect(spotlightViewsRead).toMatchObject({ views: [{ displayRef: "SV-1" }] });
    expect(viewDiffRead).toMatchObject({ file: { path: "src/index.ts" } });
  });

  it("exposes discovery catalogs and JSON-RPC contracts", async () => {
    const fixture = await createMcpReviewFixture();
    const toolNames = listGreenroomTools().map((tool) => tool.name);
    const resourceTemplates = listGreenroomResourceTemplates().map(
      (resource) => resource.uriTemplate,
    );
    const concreteResources = listGreenroomResources().map((resource) => resource.uri);
    const server = createGreenroomMcpServer({ client: fixture.client });
    const initialized = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    const rpcToolCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "greenroom_get_review",
        arguments: { reviewId: "GR-1" },
      },
    });
    const rpcResourceRead = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "greenroom://reviews/GR-1/manifest" },
    });

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "greenroom_list_reviews",
        "greenroom_get_diff",
        "greenroom_list_changed_files",
        "greenroom_read_diff_file",
        "greenroom_search_diff",
        "greenroom_get_anchor_registry",
        "greenroom_get_existing_threads",
        "greenroom_get_spotlight_views",
        "greenroom_get_view",
        "greenroom_get_view_diff",
        "greenroom_get_line_membership",
        "greenroom_create_handoff",
        "greenroom_report_attempted_fix",
        "greenroom_submit_review_findings_draft",
      ]),
    );
    expect(toolNames).toEqual([...new Set(toolNames)]);
    expect(toolNames.every((name) => /^[a-zA-Z0-9_-]{1,128}$/.test(name))).toBe(true);
    expect(concreteResources).toEqual(
      expect.arrayContaining([
        "greenroom://concepts/review-model",
        "greenroom://concepts/anchors",
        "greenroom://concepts/spotlight",
        "greenroom://concepts/teaching",
      ]),
    );
    expect(resourceTemplates).toEqual(
      expect.arrayContaining([
        "greenroom://reviews/{reviewId}/manifest",
        "greenroom://reviews/{reviewId}/diff-summary",
        "greenroom://reviews/{reviewId}/files",
        "greenroom://reviews/{reviewId}/files/{path}",
        "greenroom://reviews/{reviewId}/anchors/{path}",
        "greenroom://reviews/{reviewId}/threads",
        "greenroom://reviews/{reviewId}/spotlight/views",
        "greenroom://reviews/{reviewId}/spotlight/coverage",
        "greenroom://threads/{threadRef}",
        "greenroom://spotlight/views/{viewRef}",
        "greenroom://spotlight/views/{viewRef}/diff",
        "greenroom://reviews/{reviewId}/handoff?threadRefs={threadRefs}",
        "greenroom://runs/{runId}/instructions",
        "greenroom://runs/{runId}/output-schema",
      ]),
    );
    expect(initialized).toMatchObject({
      result: { capabilities: { tools: {}, resources: {} } },
    });
    expect(rpcToolCall).toMatchObject({
      result: { content: [{ type: "text", text: expect.stringContaining("Feature review") }] },
    });
    expect(rpcResourceRead).toMatchObject({
      result: {
        contents: [{ text: expect.stringContaining("greenroom.mcp.review-manifest.v1") }],
      },
    });
  });

  it("creates, reads, replies to, and transitions threads", async () => {
    const fixture = await createMcpReviewFixture();
    const { anchor, createdThread, file, secondAnchor } = await createMcpThread(fixture);
    const threadsResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/threads",
    );
    const existingThreadsRead = await callGreenroomTool(
      fixture.client,
      "greenroom_get_existing_threads",
      { reviewId: "GR-1", path: file.path },
    );
    const threadResource = await readGreenroomResource(fixture.client, "greenroom://threads/GT-1");
    const readThread = await callGreenroomTool(fixture.client, "greenroom_get_thread", {
      threadRef: "GT-1",
    });
    const reply = await callGreenroomTool(fixture.client, "greenroom_reply_to_thread", {
      threadRef: "GT-1",
      authorKind: "external_agent",
      authorDisplayName: "Fix Agent",
      body: "I will address this in the local worktree.",
    });
    const resolved = await callGreenroomTool(fixture.client, "greenroom_resolve_thread", {
      threadRef: "GT-1",
    });
    const dismissed = await callGreenroomTool(fixture.client, "greenroom_dismiss_thread", {
      threadRef: "GT-1",
    });

    expect(createdThread).toMatchObject({
      thread: {
        shortRef: "GT-1",
        anchors: [{ lineNumber: anchor.lineNumber }, { lineNumber: secondAnchor.lineNumber }],
      },
    });
    expect(JSON.parse(threadsResource.text)).toMatchObject({
      threads: [{ shortRef: "GT-1", commentCount: 1 }],
    });
    expect(existingThreadsRead).toMatchObject({
      threads: [{ shortRef: "GT-1", commentCount: 1 }],
    });
    expect(JSON.parse(threadResource.text)).toMatchObject({ thread: { shortRef: "GT-1" } });
    expect(readThread).toMatchObject({
      thread: { comments: [{ body: "Please extract this magic value." }] },
    });
    expect(reply).toMatchObject({ comment: { id: "comment_2", sortOrder: 2 } });
    expect(resolved).toMatchObject({ thread: { status: "resolved" } });
    expect(dismissed).toMatchObject({ thread: { status: "dismissed" } });
    expect(await json(await fixture.request("/api/threads/GT-1"))).toMatchObject({
      thread: { status: "dismissed" },
    });
  });

  it("creates handoffs and reports agent events", async () => {
    const fixture = await createMcpReviewFixture();
    await createMcpThread(fixture);
    const handoff = await callGreenroomTool(fixture.client, "greenroom_create_handoff", {
      reviewDisplayId: "GR-1",
      threadRefs: ["GT-1"],
      desiredOutcome: "Address the selected thread.",
    });
    const handoffResource = await readGreenroomResource(
      fixture.client,
      "greenroom://reviews/GR-1/handoff?threadRefs=GT-1",
    );
    const event = await callGreenroomTool(fixture.client, "greenroom_report_attempted_fix", {
      reviewDisplayId: "GR-1",
      source: { kind: "mcp_client", displayName: "Codex", clientName: "codex" },
      threadRefs: ["GT-1"],
      summary: "Attempted to address GT-1.",
    });

    expect(handoff).toMatchObject({
      handoff: {
        selectedThreadRefs: ["GT-1"],
        threads: [{ snippets: expect.arrayContaining([expect.stringContaining("src/index.ts")]) }],
      },
    });
    expect(JSON.parse(handoffResource.text)).toMatchObject({
      handoff: { selectedThreadRefs: ["GT-1"] },
    });
    expect(event).toMatchObject({ event: { eventType: "attempted_fix" } });
  });
});
