import { describe, expect, it } from "vitest";

import {
  callGreenroomTool,
  createGreenroomHttpClient,
  createGreenroomMcpServer,
  readGreenroomResource,
} from "./index";

const timestamp = "2026-06-25T12:00:00.000Z";

const review = {
  displayId: "GR-1",
  repositoryId: "repo_1",
  title: "Harness review",
  range: {
    kind: "branch_to_branch",
    baseRef: { kind: "branch", value: "main" },
    headRef: { kind: "branch", value: "feature" },
  },
  baseRefDisplay: "main",
  headRefDisplay: "feature",
  nextThreadNumber: 2,
  currentRevisionId: "revision_1",
  status: "open",
  spotlightConfig: { autoGenerateSpotlight: false },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const repository = {
  id: "repo_1",
  rootPath: "/tmp/greenroom-secret-path",
  gitCommonDir: "/tmp/greenroom-secret-path/.git",
  identityKey: "repo-identity-key",
  displayName: "fixture",
  defaultBranchCandidate: "main",
  spotlightConfig: { autoGenerateSpotlight: false },
  lastOpenedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const revision = {
  id: "revision_1",
  reviewDisplayId: "GR-1",
  baseSha: "1111111",
  headSha: "2222222",
  worktreeFingerprint: null,
  diffSummary: {
    fileCount: 1,
    additions: 2,
    deletions: 1,
    binaryFileCount: 0,
    renameCount: 0,
  },
  refreshReason: "initial",
  createdAt: timestamp,
};

const diffFile = {
  id: "diff_file_1",
  revisionId: "revision_1",
  path: "src/index.ts",
  oldPath: null,
  status: "modified",
  isBinary: false,
  additions: 2,
  deletions: 1,
  oldMode: null,
  newMode: null,
  renameMetadata: null,
  hunks: [
    {
      id: "diff_hunk_1",
      fileId: "diff_file_1",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: "@@ -1,3 +1,4 @@",
      sortOrder: 1,
      lines: [
        {
          type: "context",
          oldLineNumber: 1,
          newLineNumber: 1,
          content: "export function answer() {",
        },
        { type: "deletion", oldLineNumber: 2, newLineNumber: null, content: "  return 41;" },
        { type: "addition", oldLineNumber: null, newLineNumber: 2, content: "  return 42;" },
        { type: "addition", oldLineNumber: null, newLineNumber: 3, content: "  // reviewed" },
      ],
    },
  ],
};

const primaryAnchor = {
  reviewDisplayId: "GR-1",
  revisionId: "revision_1",
  filePath: "src/index.ts",
  oldFilePath: null,
  side: "head",
  lineNumber: 2,
  lineType: "addition",
  hunkId: "diff_hunk_1",
  hunkHeader: "@@ -1,3 +1,4 @@",
  contextBefore: ["export function answer() {", "  return 41;"],
  contextAfter: ["  // reviewed"],
  originalLineText: "  return 42;",
};

const thread = {
  reviewDisplayId: "GR-1",
  shortRef: "GT-1",
  status: "open",
  type: "issue",
  severity: "major",
  source: { kind: "mcp_client", displayName: "Fixture", clientName: "test" },
  anchor: primaryAnchor,
  anchors: [primaryAnchor],
  remapConfidence: null,
  outdated: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  comments: [
    {
      id: "comment_1",
      threadRef: "GT-1",
      parentCommentId: null,
      authorKind: "mcp_client",
      authorDisplayName: "Fixture",
      body: "Check this return value.",
      sortOrder: 1,
      createdAt: timestamp,
      editedAt: null,
    },
  ],
};

function fixtureClient(requests: string[] = []) {
  return createGreenroomHttpClient({
    baseUrl: "http://greenroom.test",
    token: "test-token",
    fetch: async (input) => {
      const url = new URL(input);
      requests.push(`${url.pathname}${url.search}`);
      const payloads: Record<string, unknown> = {
        "/api/reviews/GR-1": { review, repository, currentRevision: revision },
        "/api/reviews/GR-1/diff": { review, revision, files: [diffFile] },
        "/api/reviews/GR-1/threads": { threads: [thread] },
        "/api/reviews/GR-1/spotlight/views": {
          views: [
            {
              reviewDisplayId: "GR-1",
              displayRef: "SV-1",
              title: "Implementation",
              description: "Implementation changes",
              intent: "understand",
              orderIndex: 1,
              health: "current",
              originRunId: "spotlight_run_1",
              lastReconciledRevisionId: "revision_1",
              createdAt: timestamp,
              updatedAt: timestamp,
              associatedFiles: [{ path: "src/index.ts", oldPath: null }],
            },
          ],
        },
        "/api/reviews/GR-1/spotlight/coverage": {
          reviewDisplayId: "GR-1",
          revisionId: "revision_1",
          unlitAnchors: [primaryAnchor],
        },
        "/api/spotlight/views/SV-1/diff": {
          view: {
            reviewDisplayId: "GR-1",
            displayRef: "SV-1",
            title: "Implementation",
            description: "Implementation changes",
            intent: "understand",
            orderIndex: 1,
            health: "current",
            originRunId: "spotlight_run_1",
            lastReconciledRevisionId: "revision_1",
            createdAt: timestamp,
            updatedAt: timestamp,
            associatedFiles: [{ path: "src/index.ts", oldPath: null }],
          },
          revision,
          files: [diffFile],
          regions: [],
        },
      };
      const payload = payloads[url.pathname];

      if (payload === undefined) {
        return new Response(JSON.stringify({ error: { message: `Unhandled ${url.pathname}` } }), {
          status: 404,
        });
      }

      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
}

describe("Greenroom MCP harness context plane", () => {
  it("reads concept, manifest, path-scoped file, and stable anchor resources", async () => {
    const requests: string[] = [];
    const client = fixtureClient(requests);
    const concept = JSON.parse(
      (await readGreenroomResource(client, "greenroom://concepts/anchors")).text,
    ) as { schemaVersion: string };
    const manifest = JSON.parse(
      (await readGreenroomResource(client, "greenroom://reviews/GR-1/manifest")).text,
    ) as { repository: Record<string, unknown> };
    const file = JSON.parse(
      (await readGreenroomResource(client, "greenroom://reviews/GR-1/files/src/index.ts")).text,
    ) as { file: { hunks: Array<{ lines: Array<{ anchorKey: string | null }> }> } };
    const anchors = JSON.parse(
      (await readGreenroomResource(client, "greenroom://reviews/GR-1/anchors/src/index.ts")).text,
    ) as { anchors: Array<{ anchorKey: string }> };
    const anchorsAgain = JSON.parse(
      (await readGreenroomResource(client, "greenroom://reviews/GR-1/anchors/src/index.ts")).text,
    ) as { anchors: Array<{ anchorKey: string }> };
    const runOutputSchema = JSON.parse(
      (await readGreenroomResource(client, "greenroom://runs/workflow_run_1/output-schema")).text,
    ) as { status: string; outputContracts: Array<{ draftTool: string }> };

    expect(concept.schemaVersion).toBe("greenroom.mcp.concept.v1");
    expect(JSON.stringify(manifest.repository)).not.toContain("identityKey");
    expect(JSON.stringify(manifest.repository)).not.toContain("rootPath");
    expect(file.file.hunks[0]?.lines.map((line) => line.anchorKey)).toContain(
      "GR-1:revision_1:src/index.ts::head:addition:2",
    );
    expect(anchors.anchors).toEqual(anchorsAgain.anchors);
    expect(requests).toEqual(
      expect.arrayContaining(["/api/reviews/GR-1/diff?path=src%2Findex.ts"]),
    );
    expect(runOutputSchema).toMatchObject({
      status: "not_available",
      outputContracts: expect.arrayContaining([
        expect.objectContaining({ draftTool: "greenroom_submit_review_findings_draft" }),
      ]),
    });
    await expect(
      readGreenroomResource(client, "greenroom://reviews/GR-1/files?revisionId=revision_0"),
    ).rejects.toThrow("current revision");
  });

  it("uses path-scoped read tools without returning the whole diff inline", async () => {
    const requests: string[] = [];
    const client = fixtureClient(requests);
    const changedFiles = await callGreenroomTool(client, "greenroom_list_changed_files", {
      reviewId: "GR-1",
      limit: 1,
    });
    const diff = await callGreenroomTool(client, "greenroom_read_diff_file", {
      reviewId: "GR-1",
      path: "src/index.ts",
    });
    const search = await callGreenroomTool(client, "greenroom_search_diff", {
      reviewId: "GR-1",
      query: "return 42",
    });
    const anchors = await callGreenroomTool(client, "greenroom_get_anchor_registry", {
      reviewId: "GR-1",
      path: "src/index.ts",
    });
    const threads = await callGreenroomTool(client, "greenroom_get_existing_threads", {
      reviewId: "GR-1",
      path: "src/index.ts",
    });
    const views = await callGreenroomTool(client, "greenroom_get_spotlight_views", {
      reviewId: "GR-1",
    });
    const viewDiff = await callGreenroomTool(client, "greenroom_get_view_diff", {
      viewRef: "SV-1",
      path: "src/index.ts",
    });

    expect(changedFiles).toMatchObject({ files: [{ path: "src/index.ts" }] });
    expect(diff).toMatchObject({ file: { path: "src/index.ts", hunks: [{ id: "diff_hunk_1" }] } });
    expect(search).toMatchObject({
      matches: [{ matchType: "line", anchorKey: "GR-1:revision_1:src/index.ts::head:addition:2" }],
    });
    expect(anchors).toMatchObject({
      anchors: expect.arrayContaining([
        expect.objectContaining({
          anchorKey: "GR-1:revision_1:src/index.ts::base:deletion:2",
        }),
      ]),
    });
    expect(threads).toMatchObject({ threads: [{ shortRef: "GT-1", commentCount: 1 }] });
    expect(views).toMatchObject({ views: [{ displayRef: "SV-1" }] });
    expect(viewDiff).toMatchObject({ file: { path: "src/index.ts" } });
    expect(
      requests.filter((request) => request === "/api/reviews/GR-1/diff?path=src%2Findex.ts"),
    ).toHaveLength(2);
  });

  it("validates draft tool payloads without durable writes", async () => {
    const client = fixtureClient();
    const reviewDraft = await callGreenroomTool(client, "greenroom_submit_review_findings_draft", {
      runId: "workflow_run_1",
      draft: {
        kind: "builtin_review_findings",
        summary: "One finding.",
        findings: [
          {
            id: "finding-1",
            title: "Check return",
            body: "The return value should be checked.",
            type: "issue",
            severity: "major",
            anchorKey: "GR-1:revision_1:src/index.ts::head:addition:2",
            confidence: 0.8,
          },
        ],
      },
    });
    const outlineDraft = await callGreenroomTool(
      client,
      "greenroom_submit_spotlight_outline_draft",
      {
        runId: "workflow_run_1",
        draft: {
          kind: "spotlight_outline",
          views: [
            {
              key: "implementation",
              title: "Implementation",
              intent: "understand",
              description: "Implementation changes.",
            },
          ],
        },
      },
    );
    const membershipDraft = await callGreenroomTool(
      client,
      "greenroom_submit_spotlight_membership_draft",
      {
        runId: "workflow_run_1",
        draft: {
          kind: "spotlight_membership",
          memberships: [
            {
              viewKey: "implementation",
              anchorKeys: ["GR-1:revision_1:src/index.ts::head:addition:2"],
            },
          ],
        },
      },
    );
    const teachingDraft = await callGreenroomTool(client, "greenroom_submit_teaching_draft", {
      runId: "workflow_run_1",
      draft: {
        kind: "teaching_draft",
        changeSummary: "The answer changed.",
        architectureExplanation: "This module exposes a small function.",
        walkthrough: [
          {
            id: "point-1",
            title: "Return value",
            body: "The changed return value is the core behavior.",
            filePath: "src/index.ts",
            lineNumber: 2,
            anchor: primaryAnchor,
          },
        ],
        quiz: [
          {
            id: "quiz-1",
            prompt: "What changed?",
            choices: [
              { id: "a", label: "The return value" },
              { id: "b", label: "The filename" },
            ],
            correctChoiceId: "a",
            explanation: "The diff changes the returned number.",
            missedConcept: "Reading changed lines",
            anchor: primaryAnchor,
          },
        ],
        missedConcepts: [],
      },
    });
    const invalidDraft = await callGreenroomTool(client, "greenroom_submit_review_findings_draft", {
      runId: "workflow_run_1",
      draft: { kind: "builtin_review_findings", findings: [] },
    });

    expect(reviewDraft).toMatchObject({
      validation: { valid: true, issues: [] },
      persistence: { status: "pending_orchestrator", durable: false },
    });
    expect(outlineDraft).toMatchObject({ validation: { valid: true } });
    expect(membershipDraft).toMatchObject({ validation: { valid: true } });
    expect(teachingDraft).toMatchObject({ validation: { valid: true } });
    expect(invalidDraft).toMatchObject({
      validation: { valid: false, issues: [expect.objectContaining({ recoverable: true })] },
      persistence: { status: "not_available", durable: false },
    });
  });

  it("posts valid draft tool payloads to the workflow draft endpoint", async () => {
    const token = "grt_test_workflow_run_token_123456789";
    const calls: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const client = createGreenroomHttpClient({
      baseUrl: "http://greenroom.test",
      token,
      fetch: async (input, init) => {
        const url = new URL(input);
        calls.push({
          path: url.pathname,
          authorization: new Headers(init?.headers).get("authorization"),
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });

        return new Response(
          JSON.stringify({
            run: {
              id: "workflow_run_1",
              status: "completed",
              phase: "completed",
              draftOutput: { kind: "builtin_review_findings" },
              finalOutput: { kind: "builtin_review_findings" },
            },
            valid: true,
            issues: [],
            repairContext: null,
          }),
          { status: 200 },
        );
      },
    });

    const result = await callGreenroomTool(client, "greenroom_submit_review_findings_draft", {
      runId: "workflow_run_1",
      draft: {
        kind: "builtin_review_findings",
        summary: "One finding.",
        findings: [
          {
            id: "finding-1",
            title: "Check return",
            body: "The return value should be checked.",
            type: "issue",
            severity: "major",
            anchorKey: "GR-1:revision_1:src/index.ts::head:addition:2",
            confidence: 0.8,
          },
        ],
      },
    });

    expect(calls).toEqual([
      {
        path: "/api/workflow-runs/workflow_run_1/draft",
        authorization: `Bearer ${token}`,
        body: {
          draft: {
            kind: "builtin_review_findings",
            summary: "One finding.",
            findings: [
              expect.objectContaining({
                id: "finding-1",
                anchorKey: "GR-1:revision_1:src/index.ts::head:addition:2",
              }),
            ],
            nonFindings: [],
          },
        },
      },
    ]);
    expect(result).toMatchObject({
      validation: { valid: true, issues: [] },
      persistence: {
        status: "submitted",
        durable: true,
        runStatus: "completed",
        draftOutputStored: true,
        finalOutputStored: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("exposes concept resources and workflow prompts through MCP server methods", async () => {
    const server = createGreenroomMcpServer({ client: fixtureClient() });
    const resources = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
    });
    const prompts = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/list",
    });
    const prompt = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: { name: "greenroom_review_prompt", arguments: { reviewId: "GR-1" } },
    });

    expect(resources).toMatchObject({
      result: {
        resources: expect.arrayContaining([
          expect.objectContaining({ uri: "greenroom://concepts/anchors" }),
        ]),
      },
    });
    expect(prompts).toMatchObject({
      result: {
        prompts: expect.arrayContaining([
          expect.objectContaining({ name: "greenroom_review_prompt" }),
        ]),
      },
    });
    expect(prompt).toMatchObject({
      result: {
        messages: [
          {
            content: { text: expect.stringContaining("greenroom_submit_review_findings_draft") },
          },
        ],
      },
    });
  });
});
