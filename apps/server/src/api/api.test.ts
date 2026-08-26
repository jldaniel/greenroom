import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  threadAnchorLineKey as anchorLineKey,
  type IdFactory,
  type IdPrefix,
} from "@greenroom/core";
import { emptyTreeSha } from "@greenroom/git";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import { callGreenroomTool, createGreenroomHttpClient } from "@greenroom/mcp";
import type {
  DiffFile,
  DiffLine,
  HarnessRunRequest,
  HarnessRunResponse,
  ThreadAnchor,
  WorkflowRunId,
} from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { openGreenroomDatabase } from "../storage/database";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices, type GreenroomApiServiceOptions } from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix | "diff_file" | "diff_hunk", number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createApiFixture(
  storage: TestStorage,
  options: Omit<GreenroomApiServiceOptions, "domain"> = {},
) {
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    ...options,
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
  });
  const app = createGreenroomApp({ services });
  const adminToken = services.tokens.create({ name: "Test admin", scopes: ["admin"] });
  const request = createAuthedRequester(app, adminToken.plaintextToken);

  return { app, services, request, adminToken: adminToken.plaintextToken };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function waitForApiResult<T>(
  read: () => Promise<T>,
  predicate: (payload: T) => boolean,
  description: string,
): Promise<T> {
  let latest: T | null = null;

  for (let poll = 0; poll < 100; poll += 1) {
    latest = await read();

    if (predicate(latest)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}; latest=${JSON.stringify(latest)}`);
}

async function waitForSpotlightRunPayload(
  request: (path: string, init?: RequestInit) => Response | Promise<Response>,
  reviewId: string,
  runId: string,
  predicate: (payload: { run: { status: string; pendingOutline?: unknown } }) => boolean,
  description: string,
): Promise<{ run: Record<string, unknown> }> {
  return waitForApiResult(
    async () =>
      (await json(await request(`/api/reviews/${reviewId}/spotlight/runs/${runId}`))) as {
        run: Record<string, unknown> & { status: string; pendingOutline?: unknown };
      },
    predicate,
    description,
  );
}

async function waitForSpotlightViewsPayload(
  request: (path: string, init?: RequestInit) => Response | Promise<Response>,
  reviewId: string,
  predicate: (payload: { views: unknown[] }) => boolean,
  description: string,
): Promise<{ views: Array<Record<string, unknown>> }> {
  return waitForApiResult(
    async () =>
      (await json(await request(`/api/reviews/${reviewId}/spotlight/views`))) as {
        views: Array<Record<string, unknown>>;
      },
    predicate,
    description,
  );
}

function createAuthedRequester(app: ReturnType<typeof createGreenroomApp>, token: string) {
  return (path: string, init: RequestInit = {}) => app.request(path, withAuth(token, init));
}

function createAppFetch(app: ReturnType<typeof createGreenroomApp>) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    return await app.request(`${url.pathname}${url.search}`, init);
  };
}

function withAuth(token: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);

  return {
    ...init,
    headers,
  };
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

async function createLargeDiffRepository(lineCount: number): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/large-diff", { create: true });
  repository.writeFile(
    "src/generated.ts",
    Array.from(
      { length: lineCount },
      (_value, index) => `export const value${index + 1} = ${index + 1};`,
    )
      .join("\n")
      .concat("\n"),
  );
  await repository.stage();
  await repository.commit("Add generated fixture");

  return repository;
}

function findFirstChangedLine(files: readonly DiffFile[]): {
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

function completedHarnessResponse(request: HarnessRunRequest, output: unknown): HarnessRunResponse {
  return {
    workflow: request.workflow,
    runId: request.runId,
    status: "completed",
    output,
    execution: {
      command: "fake-harness",
      exitCode: 0,
      durationMs: 1,
      stderrTail: "",
      timeoutMs: null,
      timeoutBudgetMs: null,
      timeoutClamped: false,
      timedOut: false,
      repositoryAccessMode: "mcp_only",
      repositoryWorkspaceStrategy: null,
      workspaceSetupStatus: "not_required",
      workspaceCleanupStatus: "not_required",
      workspaceErrorMessage: null,
      repositoryChanged: false,
      repositoryFingerprintBefore: null,
      repositoryFingerprintAfter: null,
      outputCapture: "structured_stdout",
    },
  };
}

function firstAnchorKeyFromDiff(
  reviewDisplayId: string,
  revisionId: string,
  files: readonly DiffFile[],
): string {
  const { file, line } = findFirstChangedLine(files);
  return anchorLineKey(anchorForChangedLine(reviewDisplayId, revisionId, file, line));
}

function additionAnchorsFromDiff(
  reviewDisplayId: string,
  revisionId: string,
  files: readonly DiffFile[],
): ThreadAnchor[] {
  return files.flatMap((file) =>
    file.hunks.flatMap((hunk) =>
      hunk.lines
        .filter(
          (line): line is DiffLine & { type: "addition"; newLineNumber: number } =>
            line.type === "addition" && line.newLineNumber !== null,
        )
        .map((line) => anchorForChangedLine(reviewDisplayId, revisionId, file, line)),
    ),
  );
}

async function createSpotlightEvolutionFixture() {
  const storage = createTestStorage();
  storages.push(storage);
  const repository = await createReviewRepository();
  const { request } = createApiFixture(storage);

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
      title: "Spotlight evolution review",
      baseRef: "main",
      headRef: "feature/review",
    }),
  });
  const profile = (await json(
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Immediate mock spotlight",
        workflowType: "spotlight",
        provider: "mock",
        model: "mock-spotlight",
        systemPrompt: null,
        modelSettings: {},
        allowedTools: [],
        contextPreferences: {},
        // Trusted consent: runs for this profile start without explicit consent.
        privacy: { persistTranscript: false, consentMode: "trusted" },
      }),
    }),
  )) as { profile: { id: string } };
  const generated = (await json(
    await request("/api/reviews/GR-1/spotlight/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate",
        trigger: "manual",
        gated: false,
        revisionId: "revision_1",
        profileId: profile.profile.id,
      }),
    }),
  )) as { run: { id: string; status: string; type: string } };
  await waitForSpotlightRunPayload(
    request,
    "GR-1",
    generated.run.id,
    (payload) => payload.run.status === "completed",
    "trusted generate Spotlight completion",
  );
  const generatedViews = (await waitForSpotlightViewsPayload(
    request,
    "GR-1",
    (payload) => payload.views.length > 0,
    "trusted generated Spotlight views",
  )) as {
    views: Array<{ displayRef: string; title: string; description: string; health: string }>;
  };
  const initialView = generatedViews.views[0];

  if (initialView === undefined) {
    throw new Error("Expected mock Spotlight generation to create a view");
  }

  return {
    generated,
    initialView,
    profileId: profile.profile.id,
    repository,
    request,
  };
}

async function prepareDriftedSpotlight(
  fixture: Awaited<ReturnType<typeof createSpotlightEvolutionFixture>>,
) {
  fixture.repository.writeFile(
    "src/index.ts",
    "export function answer() {\n  const value = 42;\n  return 42;\n}\n",
  );
  await fixture.repository.stage();
  await fixture.repository.commit("Adjust answer implementation");

  const remapped = await fixture.request("/api/reviews/GR-1/refresh", { method: "POST" });
  const remappedPayload = (await json(remapped)) as {
    revision: { id: string };
    spotlightRemap: { remapped: number; stale: number; driftedViews: number };
  };
  const remappedView = (await json(
    await fixture.request(`/api/spotlight/views/${fixture.initialView.displayRef}`),
  )) as {
    view: {
      displayRef: string;
      health: string;
      lastReconciledRevisionId: string;
      regions: Array<{ stale: boolean; anchors: ThreadAnchor[] }>;
    };
  };

  fixture.repository.writeFile(
    "src/index.ts",
    'export const replacement = "changed";\nconsole.log(replacement);\n',
  );
  await fixture.repository.stage();
  await fixture.repository.commit("Replace answer implementation");

  const drifted = await fixture.request("/api/reviews/GR-1/refresh", { method: "POST" });
  const driftedPayload = (await json(drifted)) as {
    revision: { id: string };
    spotlightRemap: { remapped: number; stale: number; driftedViews: number };
  };
  const driftedView = (await json(
    await fixture.request(`/api/spotlight/views/${fixture.initialView.displayRef}`),
  )) as {
    view: {
      displayRef: string;
      health: string;
      lastReconciledRevisionId: string;
      regions: Array<{ stale: boolean; anchors: ThreadAnchor[] }>;
    };
  };

  return { drifted, driftedPayload, driftedView, remapped, remappedPayload, remappedView };
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

describe("Greenroom HTTP API", () => {
  it("bootstraps authentication and rejects missing or non-loopback setup credentials", async () => {
    const storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    });
    storages.push(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
    });
    const app = createGreenroomApp({ services });

    const missingToken = await app.request("/api/repositories");
    const setup = await app.request("/api/setup/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Local admin" }),
    });
    const setupPayload = (await json(setup)) as {
      token: { id: string; scopes: string[]; tokenHash?: string };
      plaintextToken: string;
    };
    // Post-bootstrap setup minting requires a loopback client address; test
    // requests dispatched via app.request have no socket, so the address is
    // unknown and the endpoint fails closed.
    const unknownClientSetup = await app.request("/api/setup/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second admin" }),
    });
    expect(missingToken.status).toBe(401);
    expect(await json(missingToken)).toMatchObject({ error: { code: "unauthorized" } });
    expect(setup.status).toBe(201);
    expect(setupPayload.token).toMatchObject({ id: "token_1", scopes: ["admin"] });
    expect(setupPayload.token.tokenHash).toBeUndefined();
    expect(setupPayload.plaintextToken).toMatch(/^grt_/u);
    expect(unknownClientSetup.status).toBe(403);
  });

  it("enforces token scopes independently of request validation", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const { app, request: adminRequest } = createApiFixture(storage);
    const readToken = (await json(
      await adminRequest("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Read only", scopes: ["read"] }),
      }),
    )) as { plaintextToken: string };
    const commentToken = (await json(
      await adminRequest("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Comment writer", scopes: ["comment:write"] }),
      }),
    )) as { plaintextToken: string };
    const resolverToken = (await json(
      await adminRequest("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Resolver", scopes: ["thread:resolve"] }),
      }),
    )) as { plaintextToken: string };
    const readRequest = createAuthedRequester(app, readToken.plaintextToken);
    const commentRequest = createAuthedRequester(app, commentToken.plaintextToken);
    const resolverRequest = createAuthedRequester(app, resolverToken.plaintextToken);

    const readAllowed = await readRequest("/api/repositories");
    const readWriteDenied = await readRequest("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: "/tmp/not-needed" }),
    });
    const commentReadDenied = await commentRequest("/api/reviews");
    const commentResolveDenied = await commentRequest("/api/threads/GT-1/resolve", {
      method: "POST",
    });
    const resolverCommentDenied = await resolverRequest("/api/threads/GT-1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Denied before body validation matters.",
      }),
    });
    const adminOnlyDenied = await readRequest("/api/tokens");
    const readAgentEventDenied = await readRequest("/api/agent-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "attempted_fix",
        source: { kind: "mcp_client", displayName: "Codex" },
        summary: "Denied by scope.",
      }),
    });

    expect(readAllowed.status).toBe(200);
    expect(readWriteDenied.status).toBe(403);
    expect(commentReadDenied.status).toBe(403);
    expect(commentResolveDenied.status).toBe(403);
    expect(resolverCommentDenied.status).toBe(403);
    expect(adminOnlyDenied.status).toBe(403);
    expect(readAgentEventDenied.status).toBe(403);
  });

  it("administers and revokes tokens without exposing token hashes", async () => {
    const storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    });
    storages.push(storage);
    const { app, request: adminRequest } = createApiFixture(storage);
    const readToken = (await json(
      await adminRequest("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Read only", scopes: ["read"] }),
      }),
    )) as { token: { id: string; tokenHash?: string }; plaintextToken: string };
    const readRequest = createAuthedRequester(app, readToken.plaintextToken);
    const listedTokens = (await json(await adminRequest("/api/tokens"))) as {
      tokens: Array<{ id: string; tokenHash?: string; revokedAt: string | null }>;
    };
    const revoked = await adminRequest(`/api/tokens/${readToken.token.id}/revoke`, {
      method: "POST",
    });
    const revokedPayload = (await json(revoked)) as {
      token: { id: string; revokedAt: string | null; tokenHash?: string };
    };
    const revokedRead = await readRequest("/api/repositories");

    expect(readToken.token.tokenHash).toBeUndefined();
    expect(listedTokens.tokens.every((token) => token.tokenHash === undefined)).toBe(true);
    expect(revoked.status).toBe(200);
    expect(revokedPayload.token).toMatchObject({
      id: readToken.token.id,
      revokedAt: fixedNow,
    });
    expect(revokedPayload.token.tokenHash).toBeUndefined();
    expect(revokedRead.status).toBe(401);
  });

  it("publishes OpenAPI security metadata for protected operations", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const { request } = createApiFixture(storage);
    const openApi = await request("/api/openapi.json");
    const openApiPayload = (await json(openApi)) as {
      paths: Record<string, { post?: Record<string, unknown>; get?: Record<string, unknown> }>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }>;
      };
    };

    expect(openApi.status).toBe(200);
    expect(openApiPayload.components.securitySchemes).toHaveProperty("bearerAuth");
    expect(
      openApiPayload.components.schemas.ReviewCreateRequest?.properties?.comparisonMode?.enum,
    ).toEqual(["worktree", "refs", "whole_repository"]);
    expect(openApiPayload.components.schemas.ReviewCreateRequest?.properties?.kind?.enum).toEqual([
      "default_branch",
      "branch_to_branch",
      "commit_to_commit",
      "tag_or_ref",
      "same_branch_slice",
      "worktree",
      "whole_repository",
      "custom",
    ]);
    expect(openApiPayload.paths["/api/tokens"]?.get?.["x-greenroom-required-scope"]).toBe("admin");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/threads"]?.post?.["x-greenroom-required-scope"],
    ).toBe("comment:write");
    expect(openApiPayload.paths["/api/agent-events"]?.post?.["x-greenroom-required-scope"]).toBe(
      "comment:write",
    );
    expect(openApiPayload.paths["/api/profiles"]?.get?.["x-greenroom-required-scope"]).toBe("read");
    expect(openApiPayload.paths["/api/profiles"]?.post?.["x-greenroom-required-scope"]).toBe(
      "admin",
    );
    expect(openApiPayload.paths["/api/harness/status"]?.get?.["x-greenroom-required-scope"]).toBe(
      "read",
    );
    expect(
      openApiPayload.paths["/api/harness/models/{kind}"]?.get?.["x-greenroom-required-scope"],
    ).toBe("read");
    expect(
      openApiPayload.paths["/api/harness/skills/{kind}"]?.get?.["x-greenroom-required-scope"],
    ).toBe("read");
    expect(
      openApiPayload.paths["/api/harness/skills/{kind}/install"]?.post?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("admin");
    expect(
      openApiPayload.paths["/api/harness/setup-smoke"]?.post?.["x-greenroom-required-scope"],
    ).toBe("read");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/teaching/consent"]?.post?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("review:write");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/teaching/promote"]?.post?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("comment:write");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/handoff"]?.post?.["x-greenroom-required-scope"],
    ).toBe("read");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/spotlight/views"]?.get?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("read");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/spotlight/runs"]?.post?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("review:write");
    expect(
      openApiPayload.paths["/api/reviews/{reviewId}/spotlight/runs/{runId}/approve-plan"]?.post?.[
        "x-greenroom-required-scope"
      ],
    ).toBe("review:write");
    expect(openApiPayload.components.schemas.Profile?.properties?.workflowType?.enum).toContain(
      "spotlight",
    );
  });

  it("refuses setup token creation when the endpoint is disabled and honors pre-provisioned tokens", async () => {
    const storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    });
    storages.push(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
    });
    const app = createGreenroomApp({ services, setupTokenEndpointEnabled: false });

    const setup = await app.request("/api/setup/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "LAN admin" }),
    });
    const setupPayload = (await json(setup)) as { error: { code: string; message: string } };

    expect(setup.status).toBe(403);
    expect(setupPayload.error.code).toBe("forbidden");
    expect(setupPayload.error.message).toContain("GREENROOM_BOOTSTRAP_ADMIN_TOKEN");

    const plaintextToken = "pre-provisioned-admin-token-value";
    const provisioned = services.tokens.provision(plaintextToken, {
      name: "Pre-provisioned admin",
      scopes: ["admin"],
    });
    const reprovisioned = services.tokens.provision(plaintextToken, {
      name: "Pre-provisioned admin",
      scopes: ["admin"],
    });
    const provisionedRequest = createAuthedRequester(app, plaintextToken);
    const provisionedRead = await provisionedRequest("/api/repositories");

    expect(provisioned.scopes).toEqual(["admin"]);
    expect(reprovisioned.id).toBe(provisioned.id);
    expect(services.tokens.activeCount()).toBe(1);
    expect(provisionedRead.status).toBe(200);
    expect(() =>
      services.tokens.provision("too-short", { name: "Weak", scopes: ["admin"] }),
    ).toThrow(/at least/u);
  });

  it("allows post-bootstrap setup token minting for loopback clients only (V2-028)", async () => {
    const storage = createTestStorage({
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    });
    storages.push(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
    });
    let clientAddress: string | null = "127.0.0.1";
    const app = createGreenroomApp({
      services,
      setupTokenClientAddress: () => clientAddress,
    });
    const mintSetupToken = (body: Record<string, unknown>) =>
      app.request("/api/setup/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // Bootstrap the first token (the `greenroom up` supervisor does this at
    // startup), then mint again from a loopback browser client.
    const bootstrap = await mintSetupToken({ name: "Supervisor admin" });
    const browserMint = await mintSetupToken({ name: "Browser", scopes: ["admin"] });
    const browserPayload = (await json(browserMint)) as {
      token: { name: string; scopes: string[] };
      plaintextToken: string;
    };
    const browserRequest = createAuthedRequester(app, browserPayload.plaintextToken);
    const browserRead = await browserRequest("/api/repositories");
    const browserAdmin = await browserRequest("/api/tokens");

    // IPv6 loopback and the IPv6-mapped IPv4 form Bun reports on dual-stack
    // sockets are also loopback clients.
    clientAddress = "::1";
    const ipv6Mint = await mintSetupToken({ name: "IPv6 browser" });
    clientAddress = "::ffff:127.0.0.1";
    const mappedMint = await mintSetupToken({ name: "Mapped browser" });

    // Non-loopback and unknown client addresses fail closed after bootstrap.
    clientAddress = "192.168.1.50";
    const lanMint = await mintSetupToken({ name: "LAN intruder" });
    const lanPayload = (await json(lanMint)) as { error: { code: string; message: string } };
    clientAddress = null;
    const unknownMint = await mintSetupToken({ name: "Unknown client" });

    // Setup tokens must always carry admin scope (the SPA manages tokens and
    // config), even post-bootstrap.
    clientAddress = "127.0.0.1";
    const underScoped = await mintSetupToken({ name: "Read only", scopes: ["read"] });

    expect(bootstrap.status).toBe(201);
    expect(browserMint.status).toBe(201);
    expect(browserPayload.token).toMatchObject({ name: "Browser", scopes: ["admin"] });
    expect(browserPayload.plaintextToken).toMatch(/^grt_/u);
    expect(browserRead.status).toBe(200);
    expect(browserAdmin.status).toBe(200);
    expect(ipv6Mint.status).toBe(201);
    expect(mappedMint.status).toBe(201);
    expect(lanMint.status).toBe(403);
    expect(lanPayload.error.code).toBe("forbidden");
    expect(lanPayload.error.message).toContain("loopback clients");
    expect(unknownMint.status).toBe(403);
    expect(underScoped.status).toBe(400);
  });

  it("reports health and registers local Git repositories", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { app, request } = createApiFixture(storage);

    const health = await app.request("/health");
    const created = await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory, displayName: "Fixture" }),
    });
    const listed = await request("/api/repositories");
    const refs = await request("/api/repositories/repo_1/refs?kind=branches");
    const commits = await request("/api/repositories/repo_1/commits?search=feature&limit=5");
    const candidates = await request("/api/repositories/repo_1/base-candidates");

    expect(health.status).toBe(200);
    expect(await json(health)).toMatchObject({ status: "ok", databasePath: storage.databasePath });
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      repository: {
        id: "repo_1",
        rootPath: repository.directory,
        displayName: "Fixture",
      },
    });
    expect(await json(listed)).toMatchObject({ repositories: [{ id: "repo_1" }] });
    expect(await json(refs)).toMatchObject({
      refs: [{ name: "feature/review" }, { name: "main" }],
    });
    expect(await json(commits)).toMatchObject({
      commits: [{ subject: "Add feature implementation" }],
    });
    expect(await json(candidates)).toMatchObject({
      candidates: [{ ref: "main", reason: "local_default_name" }],
    });
  });

  it("reports harness bridge status", async () => {
    const disabledStorage = createTestStorage();
    const healthyStorage = createTestStorage();
    storages.push(disabledStorage, healthyStorage);
    const disabled = createApiFixture(disabledStorage, { harnessClient: null });
    const healthy = createApiFixture(healthyStorage, {
      harnessClient: {
        config: {
          baseUrl: "http://127.0.0.1:49343",
          token: "bridge-token",
          timeoutMs: 180000,
        },
        async health() {
          return {
            status: "ok",
            runtimeMode: "bridge",
            defaultKind: "claude-code",
            commandConfigured: true,
            availableKinds: [
              {
                kind: "claude-code",
                label: "Claude Code",
                commandConfigured: true,
              },
            ],
            pathMappings: 1,
            capabilities: ["run_jobs", "heartbeat"],
          };
        },
        async detectedHarnesses() {
          return {
            probedAt: "2026-07-01T00:00:00.000Z",
            harnesses: [
              {
                kind: "claude-code",
                label: "Claude Code",
                command: "claude",
                found: true,
                path: "/usr/local/bin/claude",
                version: "2.1.0 (Claude Code)",
                lastVerifiedVersion: "2.0.0 (Claude Code)",
                recommendSmoke: true,
                probedAt: "2026-07-01T00:00:00.000Z",
                message: null,
              },
            ],
          };
        },
        async models(kind) {
          return {
            kind,
            source: "built_in",
            refreshedAt: "2026-07-01T00:00:00.000Z",
            diagnostics: [],
            models: [
              {
                id: "claude-code",
                label: "Claude Code default",
                isDefault: true,
                reasoningLevels: [{ id: "high", label: "High" }],
              },
            ],
          };
        },
        async run(harnessRequest) {
          return completedHarnessResponse(harnessRequest, {});
        },
      },
    });

    const disabledStatus = await disabled.request("/api/harness/status");
    const healthyStatus = await healthy.request("/api/harness/status");
    const models = await healthy.request("/api/harness/models/claude-code");
    const createdMockProfile = await disabled.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Explicit mock teaching",
        workflowType: "teaching",
        provider: "mock",
        model: "mock-teaching",
      }),
    });
    const nonHarnessProfiles = await disabled.request("/api/profiles");
    const smoke = await disabled.request("/api/harness/setup-smoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "codex" }),
    });

    expect(await json(disabledStatus)).toMatchObject({
      configured: false,
      healthy: false,
      runtimeMode: "disabled",
      availableKinds: [],
      detectedHarnesses: [],
      errorMessage: "Harness bridge is not configured",
    });
    expect(await json(healthyStatus)).toMatchObject({
      configured: true,
      baseUrl: "http://127.0.0.1:49343",
      healthy: true,
      runtimeMode: "bridge",
      availableKinds: [
        {
          kind: "claude-code",
          label: "Claude Code",
          defaultModel: "claude-code",
          defaultModelDisplay: "Claude Code default",
          supportedWorkflows: ["teaching", "spotlight", "builtin_review"],
        },
      ],
      detectedHarnesses: [
        {
          kind: "claude-code",
          found: true,
          path: "/usr/local/bin/claude",
          version: "2.1.0 (Claude Code)",
          lastVerifiedVersion: "2.0.0 (Claude Code)",
          recommendSmoke: true,
        },
      ],
      errorMessage: null,
    });
    expect(await json(models)).toMatchObject({
      kind: "claude-code",
      source: "built_in",
      models: [
        {
          id: "claude-code",
          reasoningLevels: [{ id: "high" }],
        },
      ],
    });
    expect(createdMockProfile.status).toBe(201);
    expect(nonHarnessProfiles.status).toBe(200);
    expect(await json(nonHarnessProfiles)).toMatchObject({
      profiles: expect.arrayContaining([
        expect.objectContaining({ provider: "mock", model: "mock-teaching" }),
      ]),
    });
    expect(await json(smoke)).toMatchObject({
      workflowKind: "setup_smoke",
      harnessKind: "codex",
      status: "failed",
      message: expect.stringContaining("Harness bridge is not configured"),
    });
  });

  it("runs the setup smoke through the bridge and records a passed run", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const smokeRuns: HarnessRunRequest[] = [];
    const recordedSmokeKinds: string[] = [];
    const fixture = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          smokeRuns.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "setup_smoke_report",
            status: "passed",
            checks: [{ name: "harness-echo", status: "passed", summary: "Prompt received." }],
          });
        },
        async recordSmoke(kind) {
          recordedSmokeKinds.push(kind);
          return { recorded: true, harness: null };
        },
      },
    });

    const smoke = await fixture.request("/api/harness/setup-smoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "claude-code" }),
    });

    expect(smoke.status).toBe(200);
    expect(await json(smoke)).toMatchObject({
      workflowKind: "setup_smoke",
      harnessKind: "claude-code",
      status: "passed",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "harness", status: "passed" }),
      ]),
    });
    // The passed smoke marks the detected CLI version verified on the
    // bridge, clearing the re-smoke recommendation.
    expect(recordedSmokeKinds).toEqual(["claude-code"]);
    expect(smokeRuns).toHaveLength(1);
    expect(smokeRuns[0]).toMatchObject({
      workflow: "setup_smoke",
      profile: { provider: "harness", model: "claude-code" },
    });
  });

  it("creates committed-ref reviews and exposes review metadata with structured diffs", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

    await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory }),
    });

    const preview = await request("/api/reviews/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Feature review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    const beforeCreate = await request("/api/reviews");

    expect(preview.status).toBe(200);
    expect(await json(preview)).toMatchObject({
      title: "Feature review",
      diffSummary: { fileCount: 1, additions: 3, deletions: 0 },
      files: [{ path: "src/index.ts", status: "added" }],
    });
    expect(await json(beforeCreate)).toMatchObject({ reviews: [] });

    const created = await request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Feature review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    const createdPayload = (await json(created)) as {
      review: { displayId: string; currentRevisionId: string };
      revision: { id: string };
    };
    const listed = await request("/api/reviews");
    // Opaque review ids are no longer valid path references; only GR-n works.
    const readByOpaqueId = await request("/api/reviews/review_1");
    const readByDisplayId = await request(`/api/reviews/${createdPayload.review.displayId}`);
    const diff = await request(`/api/reviews/${createdPayload.review.displayId}/diff`);
    const pathDiff = await request(
      `/api/reviews/${createdPayload.review.displayId}/diff?path=${encodeURIComponent("src/index.ts")}`,
    );
    const revisionPathDiff = await request(
      `/api/reviews/${createdPayload.review.displayId}/revisions/${createdPayload.revision.id}?path=${encodeURIComponent("src/index.ts")}`,
    );
    const missingPathDiff = await request(
      `/api/reviews/${createdPayload.review.displayId}/diff?path=${encodeURIComponent("src/missing.ts")}`,
    );
    const closed = await request(`/api/reviews/${createdPayload.review.displayId}/close`, {
      method: "POST",
    });
    const defaultAfterClose = await request("/api/reviews");
    const closedList = await request("/api/reviews?state=CLOSED");
    const allList = await request("/api/reviews?state=all");
    const reopened = await request(`/api/reviews/${createdPayload.review.displayId}/reopen`, {
      method: "POST",
    });
    const defaultAfterReopen = await request("/api/reviews");

    expect(created.status).toBe(201);
    expect(createdPayload).toMatchObject({
      review: {
        displayId: "GR-1",
        title: "Feature review",
        currentRevisionId: "revision_1",
      },
      revision: {
        id: "revision_1",
        diffSummary: { fileCount: 1, additions: 3, deletions: 0 },
      },
    });
    expect(createdPayload.review).not.toHaveProperty("id");
    expect(await json(listed)).toMatchObject({
      reviews: [{ review: { displayId: "GR-1" }, repository: { id: "repo_1" } }],
    });
    expect(readByOpaqueId.status).toBe(400);
    expect(await json(readByDisplayId)).toMatchObject({
      review: { displayId: "GR-1" },
      currentRevision: { id: "revision_1" },
    });
    expect(await json(diff)).toMatchObject({
      files: [
        {
          path: "src/index.ts",
          status: "added",
          hunks: [{ id: expect.any(String) }],
        },
      ],
    });
    expect(await json(pathDiff)).toMatchObject({
      files: [{ path: "src/index.ts", hunks: [{ id: expect.any(String) }] }],
    });
    expect(await json(revisionPathDiff)).toMatchObject({
      files: [{ path: "src/index.ts", hunks: [{ id: expect.any(String) }] }],
    });
    expect(missingPathDiff.status).toBe(404);
    expect(closed.status).toBe(200);
    expect(await json(closed)).toMatchObject({
      review: { displayId: "GR-1", status: "closed" },
    });
    expect(await json(defaultAfterClose)).toMatchObject({ reviews: [] });
    expect(await json(closedList)).toMatchObject({
      reviews: [{ review: { displayId: "GR-1", status: "closed" } }],
    });
    expect(await json(allList)).toMatchObject({
      reviews: [{ review: { displayId: "GR-1", status: "closed" } }],
    });
    expect(await json(reopened)).toMatchObject({
      review: { displayId: "GR-1", status: "open" },
    });
    expect(await json(defaultAfterReopen)).toMatchObject({
      reviews: [{ review: { displayId: "GR-1", status: "open" } }],
    });
  });

  it("creates whole-repository reviews and refreshes when the selected head moves", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

    await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory }),
    });

    const preview = await request("/api/reviews/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        comparisonMode: "whole_repository",
        headRef: "main",
      }),
    });
    const previewPayload = (await json(preview)) as {
      title: string;
      baseSha: string;
      worktreeFingerprint: unknown;
      range: {
        kind: string;
        baseRef: { kind: string; value: string; displayName: string };
        headRef: { kind: string; value: string; displayName?: string };
      };
      diffSummary: { fileCount: number; additions: number; deletions: number };
      files: Array<{ path: string; status: string }>;
    };

    expect(preview.status).toBe(200);
    expect(previewPayload).toMatchObject({
      title: "empty repository..main",
      baseSha: emptyTreeSha,
      worktreeFingerprint: null,
      range: {
        kind: "whole_repository",
        baseRef: {
          kind: "empty_tree",
          value: emptyTreeSha,
          displayName: "empty repository",
        },
        headRef: { kind: "branch", value: "main" },
      },
      diffSummary: { fileCount: 1, additions: 1, deletions: 0 },
      files: [{ path: "README.md", status: "added" }],
    });

    const created = await request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Explore full codebase",
        comparisonMode: "whole_repository",
        headRef: "main",
      }),
    });
    const reused = await request("/api/reviews/GR-1/refresh", { method: "POST" });
    const worktreeStatus = await request("/api/reviews/GR-1/worktree-status");

    await repository.checkout("main");
    repository.writeFile("docs/guide.md", "Guide\n");
    await repository.stage();
    await repository.commit("Add guide");

    const refreshed = await request("/api/reviews/GR-1/refresh", { method: "POST" });
    const refreshedDiff = await request("/api/reviews/GR-1/diff");

    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      review: {
        title: "Explore full codebase",
        range: {
          kind: "whole_repository",
          baseRef: { kind: "empty_tree", value: emptyTreeSha },
          headRef: { kind: "branch", value: "main" },
        },
      },
      revision: {
        id: "revision_1",
        baseSha: emptyTreeSha,
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/u),
        worktreeFingerprint: null,
      },
    });
    expect(reused.status).toBe(200);
    expect(await json(reused)).toMatchObject({
      revision: { id: "revision_1", baseSha: emptyTreeSha },
      reused: true,
    });
    expect(await json(worktreeStatus)).toMatchObject({
      applicable: false,
      dirty: false,
      snapshotFingerprint: null,
      currentFingerprint: null,
    });
    expect(refreshed.status).toBe(201);
    expect(await json(refreshed)).toMatchObject({
      revision: {
        id: "revision_2",
        baseSha: emptyTreeSha,
        worktreeFingerprint: null,
        diffSummary: { fileCount: 2, additions: 2, deletions: 0 },
      },
      reused: false,
    });
    expect(await json(refreshedDiff)).toMatchObject({
      files: [
        { path: "README.md", status: "added" },
        { path: "docs/guide.md", status: "added" },
      ],
    });
  });

  it("timestamps initial reviews when no domain clock is injected", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: { idFactory: deterministicIds() },
      autoResumeQueuedWorkflowRuns: false,
    });
    const app = createGreenroomApp({ services });
    const adminToken = services.tokens.create({ name: "Real-clock admin", scopes: ["admin"] });
    const request = createAuthedRequester(app, adminToken.plaintextToken);

    await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory }),
    });
    const created = await request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Default clock review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    const payload = (await json(created)) as { review: { updatedAt: string } };

    expect(created.status).toBe(201);
    expect(Number.isNaN(Date.parse(payload.review.updatedAt))).toBe(false);
  });

  it("strips orchestrator-reserved client metadata without revoking unrelated tokens", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request, services, app } = createApiFixture(storage);

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
        title: "Reserved metadata review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });

    const teachingProfile = services.profiles
      .list()
      .find((profile) => profile.workflowType === "teaching");

    if (teachingProfile === undefined) {
      throw new Error("Fixture did not seed a teaching profile");
    }

    const victim = services.tokens.create({ name: "Unrelated read token", scopes: ["read"] });
    const reviewer = services.tokens.create({
      name: "Workflow reviewer",
      scopes: ["review:write"],
    });
    const reviewerRequest = createAuthedRequester(app, reviewer.plaintextToken);
    const created = await reviewerRequest("/api/reviews/GR-1/workflow-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKind: "teaching_generate",
        profileId: teachingProfile.id,
        idleTimeoutMs: 2_000,
        absoluteTimeoutMs: 3_000,
        metadata: {
          clientDiagnostic: "preserved",
          mcpGrantId: victim.token.id,
          mcpGrantScopes: ["admin"],
          mcpGrantCreatedAt: "attacker-controlled",
          mcpGrantRevokedAt: "attacker-controlled",
          repairAttemptCount: 99,
          maxRepairAttempts: 99,
          repairAttempts: [{ attemptNumber: 99 }],
          lastRepairContext: { issueCodes: ["attacker-controlled"] },
          timeoutMs: 1,
          idleTimeoutMs: 1,
          absoluteTimeoutMs: 1,
          timeoutBudgetMs: 1,
          currentStepId: "attacker-controlled",
          lastCompletedStepId: "attacker-controlled",
          definitionVersion: "attacker-controlled",
        },
      }),
    });
    const createdPayload = (await json(created)) as {
      run: { id: string; metadata: Record<string, unknown> };
    };
    const cancelled = await reviewerRequest(`/api/workflow-runs/${createdPayload.run.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const cancelledPayload = (await json(cancelled)) as {
      run: { metadata: Record<string, unknown> };
    };

    expect(created.status).toBe(201);
    expect(createdPayload.run.metadata).toMatchObject({
      clientDiagnostic: "preserved",
      definitionVersion: expect.any(String),
      idleTimeoutMs: 2_000,
      absoluteTimeoutMs: 3_000,
    });
    expect(createdPayload.run.metadata.definitionVersion).not.toBe("attacker-controlled");
    expect(createdPayload.run.metadata).not.toHaveProperty("mcpGrantId");
    expect(createdPayload.run.metadata).not.toHaveProperty("mcpGrantScopes");
    expect(createdPayload.run.metadata).not.toHaveProperty("mcpGrantCreatedAt");
    expect(createdPayload.run.metadata).not.toHaveProperty("mcpGrantRevokedAt");
    expect(createdPayload.run.metadata).not.toHaveProperty("repairAttemptCount");
    expect(createdPayload.run.metadata).not.toHaveProperty("maxRepairAttempts");
    expect(createdPayload.run.metadata).not.toHaveProperty("repairAttempts");
    expect(createdPayload.run.metadata).not.toHaveProperty("lastRepairContext");
    expect(createdPayload.run.metadata).not.toHaveProperty("timeoutMs");
    expect(createdPayload.run.metadata).not.toHaveProperty("timeoutBudgetMs");
    expect(createdPayload.run.metadata).not.toHaveProperty("currentStepId");
    expect(createdPayload.run.metadata).not.toHaveProperty("lastCompletedStepId");
    expect(cancelled.status).toBe(200);
    expect(cancelledPayload.run.metadata).not.toHaveProperty("mcpGrantRevokedAt");
    expect(services.tokens.authenticate(victim.plaintextToken)).toMatchObject({
      id: victim.token.id,
      revokedAt: null,
    });
  });

  it("creates worktree reviews, refreshes revisions, and remaps or outdates anchors", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

    await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory }),
    });

    const created = await request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Worktree review",
      }),
    });
    const initialDiff = (await json(await request("/api/reviews/GR-1/diff"))) as {
      files: DiffFile[];
    };
    const file = initialDiff.files.find((candidate) => candidate.path === "src/index.ts");
    const line = file?.hunks
      .flatMap((hunk) => hunk.lines)
      .find(
        (candidate): candidate is DiffLine & { type: "addition"; newLineNumber: number } =>
          candidate.type === "addition" &&
          candidate.newLineNumber !== null &&
          candidate.content.includes("return 42"),
      );

    if (file === undefined || line === undefined) {
      throw new Error("Fixture diff did not include the return line");
    }

    const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);

    await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Keep tracking this line.",
        },
      }),
    });
    const lowConfidenceThread = await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor: {
          ...anchor,
          originalLineText: "an unrelated line that should not remap confidently",
          contextBefore: [],
          contextAfter: [],
        },
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Do not guess when the surrounding evidence no longer matches.",
        },
      }),
    });

    repository.writeFile(
      "src/index.ts",
      "export function answer() {\n  const value = 42;\n  return 42;\n}\n",
    );
    const remapped = await request("/api/reviews/GR-1/refresh", { method: "POST" });
    const remappedThread = await request("/api/threads/GT-1");
    const lowConfidenceThreadAfterRefresh = (await json(await request("/api/threads/GT-2"))) as {
      thread: { outdated: boolean; remapConfidence: number | null };
    };
    const revisionsAfterRemap = await request("/api/reviews/GR-1/revisions");
    const revisionsAfterRemapPayload = (await json(revisionsAfterRemap)) as {
      revisions: Array<{ id: string }>;
    };

    repository.removePath("src/index.ts");
    const outdated = await request("/api/reviews/GR-1/refresh", { method: "POST" });
    const outdatedThread = await request("/api/threads/GT-1");
    const revisionRead = await request("/api/reviews/GR-1/revisions/revision_2");

    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      review: { range: { kind: "worktree" } },
      revision: {
        id: "revision_1",
        worktreeFingerprint: {
          headSha: expect.stringMatching(/^[0-9a-f]{40}$/u),
          stagedDiffHash: null,
          unstagedDiffHash: null,
        },
      },
    });
    expect(remapped.status).toBe(201);
    expect(await json(remapped)).toMatchObject({
      revision: { id: "revision_2", refreshReason: "manual_refresh" },
      reused: false,
      remap: { remapped: 1, outdated: 1 },
    });
    expect(await json(remappedThread)).toMatchObject({
      thread: {
        shortRef: "GT-1",
        outdated: false,
        anchor: { revisionId: "revision_2", lineNumber: 3 },
      },
    });
    expect(lowConfidenceThread.status).toBe(201);
    expect(lowConfidenceThreadAfterRefresh.thread).toMatchObject({ outdated: true });
    expect(lowConfidenceThreadAfterRefresh.thread.remapConfidence).not.toBeNull();
    expect(lowConfidenceThreadAfterRefresh.thread.remapConfidence!).toBeGreaterThan(0);
    expect(revisionsAfterRemapPayload.revisions.map((revision) => revision.id).sort()).toEqual([
      "revision_1",
      "revision_2",
    ]);
    expect(outdated.status).toBe(201);
    expect(await json(outdated)).toMatchObject({
      revision: { id: "revision_3" },
      remap: { remapped: 0, outdated: 2 },
    });
    expect(await json(outdatedThread)).toMatchObject({
      thread: {
        shortRef: "GT-1",
        outdated: true,
        anchor: { revisionId: "revision_2", lineNumber: 3 },
      },
    });
    expect(await json(revisionRead)).toMatchObject({
      revision: { id: "revision_2" },
      files: [{ path: "src/index.ts" }],
    });
  });

  it("creates, reads, replies to, and transitions anchored review threads", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { app, request, adminToken } = createApiFixture(storage);

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

    const diff = (await json(await request("/api/reviews/GR-1/diff"))) as {
      files: DiffFile[];
    };
    const { file, line } = findFirstChangedLine(diff.files);
    const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);
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

    const secondAnchor = anchorForChangedLine("GR-1", "revision_1", file, secondLine);
    const created = await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        anchors: [anchor, secondAnchor],
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Can this return a named constant?",
        },
      }),
    });
    const reply = await request("/api/threads/GT-1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authorKind: "human",
        authorDisplayName: "Author",
        body: "Yes, I can make that clearer.",
      }),
    });
    const resolved = await request("/api/threads/GT-1/resolve", {
      method: "POST",
    });
    const dismissed = await request("/api/threads/GT-1/dismiss", {
      method: "POST",
    });
    const reopened = await request("/api/threads/GT-1/reopen", {
      method: "POST",
    });
    const listed = await request("/api/reviews/GR-1/threads");
    const read = await request("/api/threads/GT-1");
    const client = createGreenroomHttpClient({
      baseUrl: "http://greenroom.test",
      token: adminToken,
      fetch: createAppFetch(app),
    });
    const mcpCreated = await callGreenroomTool(client, "greenroom_create_thread", {
      reviewDisplayId: "GR-1",
      type: "question",
      source: { kind: "mcp_client", displayName: "AI Reviewer", clientName: "codex" },
      anchor: secondAnchor,
      firstComment: {
        authorKind: "mcp_client",
        authorDisplayName: "AI Reviewer",
        body: "This thread intentionally relies on the primary-anchor fallback.",
      },
    });

    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      thread: {
        shortRef: "GT-1",
        anchors: [{ lineNumber: anchor.lineNumber }, { lineNumber: secondAnchor.lineNumber }],
        comments: [{ id: "comment_1" }],
      },
    });
    expect(reply.status).toBe(201);
    expect(await json(reply)).toMatchObject({ comment: { id: "comment_2", sortOrder: 2 } });
    expect(await json(resolved)).toMatchObject({ thread: { status: "resolved" } });
    expect(await json(dismissed)).toMatchObject({ thread: { status: "dismissed" } });
    expect(await json(reopened)).toMatchObject({ thread: { status: "open" } });
    expect(await json(listed)).toMatchObject({ threads: [{ shortRef: "GT-1" }] });
    expect(await json(read)).toMatchObject({
      thread: {
        shortRef: "GT-1",
        anchors: [{ lineNumber: anchor.lineNumber }, { lineNumber: secondAnchor.lineNumber }],
        comments: [{ id: "comment_1" }, { id: "comment_2" }],
      },
    });
    expect(mcpCreated).toMatchObject({
      thread: {
        shortRef: "GT-2",
        anchors: [{ lineNumber: secondAnchor.lineNumber }],
      },
    });
  });

  it("creates handoff bundles and records attempted-fix agent events", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request, services } = createApiFixture(storage);

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

    const diff = (await json(await request("/api/reviews/GR-1/diff"))) as {
      files: DiffFile[];
    };
    const { file, line } = findFirstChangedLine(diff.files);
    const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);

    await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "issue",
        severity: "major",
        source: { kind: "mcp_client", displayName: "AI Reviewer", clientName: "codex" },
        anchor,
        firstComment: {
          authorKind: "mcp_client",
          authorDisplayName: "AI Reviewer",
          body: "Please hand this off.",
        },
      }),
    });

    const handoff = await request("/api/reviews/GR-1/handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        threadRefs: ["GT-1"],
        desiredOutcome: "Address the selected review issue.",
      }),
    });
    const event = await request("/api/agent-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        eventType: "attempted_fix",
        source: { kind: "mcp_client", displayName: "Codex", clientName: "codex" },
        threadRefs: ["GT-1"],
        summary: "Attempted to address GR-1.",
        metadata: { command: "manual-test" },
      }),
    });

    expect(handoff.status).toBe(200);
    expect(await json(handoff)).toMatchObject({
      handoff: {
        reviewDisplayId: "GR-1",
        review: { displayId: "GR-1" },
        repository: { id: "repo_1" },
        currentRevision: { id: "revision_1" },
        selectedThreadRefs: ["GT-1"],
        desiredOutcome: "Address the selected review issue.",
        threads: [
          {
            thread: { shortRef: "GT-1" },
            anchor: { filePath: "src/index.ts" },
            comments: [{ body: "Please hand this off." }],
            snippets: expect.arrayContaining([expect.stringContaining("src/index.ts")]),
          },
        ],
      },
    });
    expect(event.status).toBe(201);
    expect(await json(event)).toMatchObject({
      event: {
        id: "event_1",
        reviewDisplayId: "GR-1",
        eventType: "attempted_fix",
        threadRefs: ["GT-1"],
      },
    });
    expect(services.agentEvents.listByReview("review_1")).toMatchObject([
      { id: "event_1", summary: "Attempted to address GR-1." },
    ]);
  });

  it("manages profiles and runs consent-gated teaching with mock provider promotion", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

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
        title: "Teaching review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });

    const profilesBeforeCreate = await request("/api/profiles");
    const createdProfile = await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mock teaching",
        workflowType: "teaching",
        provider: "mock",
        model: "mock-teacher",
        systemPrompt: "Teach this review.",
        modelSettings: {},
        allowedTools: [],
        contextPreferences: { includeQuiz: true },
        privacy: { persistTranscript: false },
      }),
    });
    const updatedProfile = await request("/api/profiles/profile_3", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-teacher-v2" }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Custom teaching",
        workflowType: "teaching",
        provider: "custom",
        model: "custom-teacher",
      }),
    });
    const consent = await request("/api/reviews/GR-1/teaching/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: "profile_3",
        revisionId: "revision_1",
      }),
    });
    const consentPayload = (await json(consent)) as {
      run: { id: string; status: string; output: null };
    };
    const prematureFollowUp = await request(
      `/api/teaching/runs/${consentPayload.run.id}/follow-up`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What changed?" }),
      },
    );
    const failingConsent = await request("/api/reviews/GR-1/teaching/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: "profile_4",
        revisionId: "revision_1",
      }),
    });
    const failingConsentPayload = (await json(failingConsent)) as { run: { id: string } };
    const failingApproval = await request(
      `/api/teaching/runs/${failingConsentPayload.run.id}/approve`,
      { method: "POST" },
    );
    const approved = await request(`/api/teaching/runs/${consentPayload.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = (await json(approved)) as {
      run: {
        id: string;
        status: string;
        output: {
          changeSummary: string;
          walkthrough: Array<{
            title: string;
            body: string;
            anchor: unknown;
          }>;
          quiz: Array<{ prompt: string }>;
        } | null;
      };
    };
    const completedPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/teaching/runs/${consentPayload.run.id}`))) as {
          run: {
            id: string;
            status: string;
            output: {
              changeSummary: string;
              walkthrough: Array<{
                title: string;
                body: string;
                anchor: unknown;
              }>;
              quiz: Array<{ prompt: string }>;
            } | null;
          };
        },
      (payload) => payload.run.status === "completed",
      "teaching run completion",
    );
    const followUp = await request(`/api/teaching/runs/${consentPayload.run.id}/follow-up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What should I inspect first?" }),
    });
    const followUpPayload = (await json(followUp)) as {
      followUp: { followUpRunId: string; status: string; answer: string | null };
    };
    const answeredEvents = await waitForApiResult(
      async () =>
        (await json(await request(`/api/workflow-runs/${consentPayload.run.id}/events`))) as {
          events: Array<{ metadata: Record<string, unknown> }>;
        },
      (payload) =>
        payload.events.some(
          (event) =>
            event.metadata.followUpWorkflowRunId === followUpPayload.followUp.followUpRunId &&
            typeof event.metadata.answer === "string",
        ),
      "teaching follow-up answer event",
    );
    const point = completedPayload.run.output?.walkthrough[0];

    if (point === undefined || point.anchor === null) {
      throw new Error("Mock teaching output did not include a promotable point");
    }

    const promoted = await request("/api/reviews/GR-1/teaching/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: "profile_3",
        title: point?.title,
        body: point?.body,
        anchor: point?.anchor,
      }),
    });

    expect(await json(profilesBeforeCreate)).toMatchObject({
      profiles: [
        { id: "profile_2", name: "Default spotlight", workflowType: "spotlight" },
        { id: "profile_1", name: "Default teaching", workflowType: "teaching" },
      ],
    });
    expect(createdProfile.status).toBe(201);
    expect(await json(createdProfile)).toMatchObject({
      profile: {
        id: "profile_3",
        provider: "mock",
        privacy: { persistTranscript: false },
      },
    });
    expect(await json(updatedProfile)).toMatchObject({
      profile: { id: "profile_3", model: "mock-teacher-v2" },
    });
    expect(consent.status).toBe(201);
    expect(consentPayload.run).toMatchObject({
      id: expect.stringMatching(/^workflow_run_/u),
      status: "pending_consent",
      output: null,
    });
    expect(prematureFollowUp.status).toBe(409);
    expect(failingApproval.status).toBe(400);
    expect(await json(failingApproval)).toMatchObject({
      error: { code: "bad_request", message: "Provider custom is not configured" },
    });
    expect(approvedPayload.run).toMatchObject({
      id: consentPayload.run.id,
      status: "approved",
      output: null,
    });
    expect(completedPayload.run).toMatchObject({
      id: consentPayload.run.id,
      status: "completed",
      output: {
        changeSummary: "Mock teaching summary for Teaching review.",
        quiz: [{ prompt: expect.stringContaining("inspect first") }],
      },
    });
    expect(followUpPayload).toMatchObject({
      followUp: {
        runId: consentPayload.run.id,
        followUpRunId: expect.stringMatching(/^workflow_run_/u),
        status: "queued",
        answer: null,
      },
    });
    expect(answeredEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUpWorkflowRunId: followUpPayload.followUp.followUpRunId,
            answer: expect.stringContaining("What should I inspect first?"),
          }),
        }),
      ]),
    );
    expect(promoted.status).toBe(201);
    expect(await json(promoted)).toMatchObject({
      thread: {
        shortRef: "GT-1",
        source: { kind: "teaching", profileId: "profile_3" },
        comments: [{ body: expect.stringContaining(point.body) }],
      },
    });
  });

  it("runs harness-backed teaching approval and follow-up through the bridge client", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          if (harnessRequest.workflow === "teaching.follow_up") {
            const followUpAttemptCount = calls.filter(
              (call) => call.workflow === "teaching.follow_up",
            ).length;

            return completedHarnessResponse(
              harnessRequest,
              followUpAttemptCount === 1
                ? {
                    kind: "teaching_follow_up_answer",
                    answer: "Inspect the changed function and its callers first.",
                  }
                : {
                    answer: "Then confirm the callers preserve the approved behavior.",
                  },
            );
          }

          const changedFile = services.reviews.listDiffFiles("revision_1")[0];

          if (changedFile === undefined) {
            throw new Error("Fixture diff did not include a changed file");
          }

          return completedHarnessResponse(harnessRequest, {
            changeSummary: "Harness teaching summary.",
            architectureExplanation:
              "The harness explains the reviewed diff using approved context.",
            walkthrough: [
              {
                id: "walkthrough-1",
                title: "Changed implementation",
                body: "Read the changed function before widening scope.",
                filePath: null,
                lineNumber: null,
                anchor: null,
                diagramId: "diagram-1",
                excerpts: [
                  {
                    kind: "lines",
                    filePath: changedFile.path,
                    side: "head",
                    startLine: 1,
                    endLine: 2,
                  },
                ],
              },
            ],
            diagrams: [
              {
                id: "diagram-1",
                title: "Teaching flow",
                mermaidSource: "graph TD; Diff --> Walkthrough;",
              },
            ],
            quiz: [
              {
                id: "quiz-1",
                prompt: "Where should review learning begin?",
                choices: [
                  { id: "diff", label: "The approved diff" },
                  { id: "global", label: "Unrelated files" },
                ],
                correctChoiceId: "diff",
                explanation: "The approved diff is the consented context.",
                missedConcept: "Stay inside approved context.",
                anchor: null,
              },
            ],
            missedConcepts: ["Stay inside approved context."],
          });
        },
      },
    });

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
        title: "Harness teaching review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness teaching",
        workflowType: "teaching",
        provider: "harness",
        model: "codex",
        modelSettings: { harness: { kind: "codex", idleTimeoutMs: 120000 } },
      }),
    });

    const consent = (await json(
      await request("/api/reviews/GR-1/teaching/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "profile_3", revisionId: "revision_1" }),
      }),
    )) as { run: { id: string } };
    const approved = await request(`/api/teaching/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = await json(approved);
    const completedPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/teaching/runs/${consent.run.id}`))) as {
          run: { status: string; output: unknown };
        },
      (payload) => payload.run.status === "completed",
      "harness-backed teaching completion",
    );
    const followUp = await request(`/api/teaching/runs/${consent.run.id}/follow-up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Where should I start?" }),
    });
    const followUpPayload = (await json(followUp)) as {
      followUp: { followUpRunId: string; status: string; answer: string | null };
    };
    const answeredEvents = await waitForApiResult(
      async () =>
        (await json(await request(`/api/workflow-runs/${consent.run.id}/events`))) as {
          events: Array<{ metadata: Record<string, unknown> }>;
        },
      (payload) =>
        payload.events.some(
          (event) =>
            event.metadata.followUpWorkflowRunId === followUpPayload.followUp.followUpRunId &&
            event.metadata.answer === "Inspect the changed function and its callers first.",
        ),
      "harness-backed teaching follow-up answer event",
    );
    const legacyFollowUp = (await json(
      await request(`/api/teaching/runs/${consent.run.id}/follow-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What should I confirm next?" }),
      }),
    )) as { followUp: { followUpRunId: string } };
    const legacyAnsweredEvents = await waitForApiResult(
      async () =>
        (await json(await request(`/api/workflow-runs/${consent.run.id}/events`))) as {
          events: Array<{ metadata: Record<string, unknown> }>;
        },
      (payload) =>
        payload.events.some(
          (event) =>
            event.metadata.followUpWorkflowRunId === legacyFollowUp.followUp.followUpRunId &&
            event.metadata.answer === "Then confirm the callers preserve the approved behavior.",
        ),
      "kindless harness Teaching follow-up answer event",
    );
    const { file: promotionFile, line: promotionLine } = findFirstChangedLine(
      services.reviews.listDiffFiles("revision_1"),
    );
    const promotionAnchor = anchorForChangedLine(
      "GR-1",
      "revision_1",
      promotionFile,
      promotionLine,
    );
    const promoted = await request("/api/reviews/GR-1/teaching/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: consent.run.id,
        profileId: "profile_3",
        title: "Promoted harness teaching point",
        body: "Keep this hunk-specific teaching point visible in the workspace.",
        anchor: promotionAnchor,
      }),
    });
    const promotedPayload = (await json(promoted)) as {
      thread: { anchor: { hunkId: string | null } };
    };

    expect(calls.map((call) => call.workflow)).toEqual([
      "teaching.generate",
      "teaching.follow_up",
      "teaching.follow_up",
    ]);
    expect(calls[0]).toMatchObject({
      runId: consent.run.id,
      cwd: repository.directory,
      outputMode: "teaching_draft",
    });
    expect(calls[0]?.timeoutMs).toBeUndefined();
    expect(calls[0]?.mcp?.allowedTools).toContain("greenroom_submit_teaching_draft");
    expect(calls[0]?.mcp?.allowedResources).toContain(
      `greenroom://runs/${consent.run.id}/instructions`,
    );
    expect(calls[1]).toMatchObject({
      outputMode: "teaching_follow_up_answer",
      outputCapture: "structured_stdout",
    });
    expect(calls[1]?.mcp?.allowedTools).not.toContain("greenroom_submit_teaching_draft");
    expect(approved.status).toBe(200);
    expect(approvedPayload).toMatchObject({
      run: {
        status: "approved",
        output: null,
      },
    });
    expect(completedPayload).toMatchObject({
      run: {
        status: "completed",
        output: {
          changeSummary: "Harness teaching summary.",
          diagrams: [{ id: "diagram-1", title: "Teaching flow" }],
          walkthrough: [
            expect.objectContaining({
              diagramId: "diagram-1",
              excerpts: [expect.objectContaining({ kind: "lines", side: "head" })],
            }),
          ],
          // Quiz questions omitted excerpts in the harness draft; the schema
          // defaults the field so drafts without excerpts still parse.
          quiz: [expect.objectContaining({ excerpts: [] })],
        },
      },
    });
    expect(followUpPayload).toMatchObject({
      followUp: {
        followUpRunId: expect.stringMatching(/^workflow_run_/u),
        status: "queued",
        answer: null,
      },
    });
    expect(answeredEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUpWorkflowRunId: followUpPayload.followUp.followUpRunId,
            answer: "Inspect the changed function and its callers first.",
          }),
        }),
      ]),
    );
    expect(legacyAnsweredEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUpWorkflowRunId: legacyFollowUp.followUp.followUpRunId,
            answer: "Then confirm the callers preserve the approved behavior.",
          }),
        }),
      ]),
    );
    expect(promoted.status).toBe(201);
    expect(promotedPayload.thread.anchor.hunkId).toBe(promotionAnchor.hunkId);
  });

  it("rejects view-scoped Teaching drafts anchored outside the Spotlight View", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          const anchors = additionAnchorsFromDiff(
            "GR-1",
            "revision_1",
            services.reviews.listDiffFiles("revision_1"),
          );
          const outsideAnchor = anchors[1];

          if (outsideAnchor === undefined) {
            throw new Error("Fixture diff did not include an outside anchor");
          }

          return completedHarnessResponse(harnessRequest, {
            kind: "teaching_draft",
            changeSummary: "Invalid View-scoped teaching summary.",
            architectureExplanation:
              "This intentionally anchors outside the selected Spotlight View.",
            walkthrough: [
              {
                id: "walkthrough-1",
                title: "Outside anchor",
                body: "This point uses an anchor outside the approved View scope.",
                filePath: outsideAnchor.filePath,
                lineNumber: outsideAnchor.lineNumber,
                anchor: outsideAnchor,
                diagramId: "diagram-missing",
                excerpts: [
                  {
                    kind: "lines",
                    filePath: "docs/never-changed.md",
                    side: "head",
                    startLine: 1,
                    endLine: 4,
                  },
                ],
              },
            ],
            quiz: [
              {
                id: "quiz-1",
                prompt: "What scope should Teaching stay inside?",
                choices: [
                  { id: "view", label: "The selected Spotlight View" },
                  { id: "outside", label: "Any changed line" },
                ],
                correctChoiceId: "view",
                explanation: "View-scoped Teaching may only use anchors from lit View regions.",
                missedConcept: "Stay inside the approved Spotlight View.",
                anchor: null,
              },
            ],
            missedConcepts: ["Stay inside the approved Spotlight View."],
          });
        },
      },
    });

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
        title: "Invalid View-scoped Teaching review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness teaching",
        workflowType: "teaching",
        provider: "harness",
        model: "codex",
      }),
    });
    const anchors = additionAnchorsFromDiff(
      "GR-1",
      "revision_1",
      services.reviews.listDiffFiles("revision_1"),
    );
    const allowedAnchor = anchors[0];

    if (allowedAnchor === undefined) {
      throw new Error("Fixture diff did not include an allowed anchor");
    }

    const spotlightRun = services.spotlight.createRun({
      reviewDisplayId: "GR-1",
      type: "generate",
      trigger: "manual",
      gated: false,
      status: "completed",
      revisionId: "revision_1",
      profileId: "profile_2",
    });
    const view = services.spotlight.createView({
      reviewDisplayId: "GR-1",
      title: "One changed line",
      description: "Only the first changed line is lit for Teaching.",
      intent: "feature",
      orderIndex: 0,
      health: "current",
      originRunId: spotlightRun.id,
      lastReconciledRevisionId: "revision_1",
    });
    services.spotlight.replaceRegions(view.displayRef, [
      {
        filePath: allowedAnchor.filePath,
        oldPath: allowedAnchor.oldFilePath,
        anchors: [allowedAnchor],
        remapConfidence: null,
        stale: false,
      },
    ]);
    const consent = (await json(
      await request("/api/reviews/GR-1/teaching/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: "profile_3",
          revisionId: "revision_1",
          scope: { kind: "spotlight_view", viewRef: view.displayRef },
        }),
      }),
    )) as { run: { id: string } };
    const approval = await request(`/api/teaching/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const completedPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/teaching/runs/${consent.run.id}`))) as {
          run: { status: string; output: unknown | null };
        },
      (payload) => payload.run.status === "failed",
      "view-scoped Teaching workflow failure",
    );
    const workflow = services.workflowRunner.readRun(consent.run.id as WorkflowRunId);

    expect(approval.status).toBe(200);
    // Initial run plus two repair attempts (default maxRepairAttempts is 2).
    expect(calls.map((call) => call.workflow)).toEqual([
      "teaching.generate",
      "teaching.generate",
      "teaching.generate",
    ]);
    expect(workflow).toMatchObject({
      status: "failed",
      validationIssues: expect.arrayContaining([
        expect.objectContaining({ code: "anchor-outside-approved-scope" }),
        expect.objectContaining({ code: "unknown-diagram-id" }),
        expect.objectContaining({ code: "excerpt-file-outside-scope" }),
      ]),
    });
    expect(completedPayload).toMatchObject({ run: { status: "failed", output: null } });
  });

  it("generates deterministic Spotlight views and derives coverage and line membership", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

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
        title: "Spotlight review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });

    const coverageBefore = (await json(await request("/api/reviews/GR-1/spotlight/coverage"))) as {
      unlitAnchors: ThreadAnchor[];
    };
    const membershipBefore = (await json(
      await request("/api/reviews/GR-1/spotlight/line-membership"),
    )) as {
      memberships: Array<{ anchor: ThreadAnchor; views: unknown[] }>;
    };
    await request("/api/profiles", {
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
        privacy: { persistTranscript: false },
      }),
    });
    const run = await request("/api/reviews/GR-1/spotlight/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate",
        trigger: "manual",
        gated: true,
        revisionId: "revision_1",
        profileId: "profile_3",
      }),
    });
    const runPayload = (await json(run)) as {
      run: {
        id: string;
        status: string;
        completedAt: string | null;
        pendingOutline: Array<{ title: string; description: string; intent: string }> | null;
        contextSummary: { fileCount: number; hunkCount: number; changedLineCount: number };
      };
    };
    const listedWhilePending = (await json(await request("/api/reviews/GR-1/spotlight/views"))) as {
      views: Array<{
        displayRef: string;
        title: string;
        description: string;
        intent: string;
        health: string;
        associatedFiles: Array<{ path: string; oldPath: string | null }>;
      }>;
    };
    const planning = (await json(
      await request(`/api/reviews/GR-1/spotlight/runs/${runPayload.run.id}/approve-context`, {
        method: "POST",
      }),
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string; intent: string }>;
      };
    };
    const planned = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      runPayload.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "Spotlight plan outline",
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string; intent: string }>;
      };
    };
    const refining = (await json(
      await request(`/api/reviews/GR-1/spotlight/runs/${runPayload.run.id}/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Call out runtime shape" }),
      }),
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string; intent: string }>;
        refinementCount: number;
      };
    };
    const refined = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      runPayload.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "Spotlight refined outline",
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string; intent: string }>;
        refinementCount: number;
      };
    };
    const completed = await request(
      `/api/reviews/GR-1/spotlight/runs/${runPayload.run.id}/approve-plan`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedOutline: refined.run.pendingOutline }),
      },
    );
    const generatingPayload = (await json(completed)) as {
      run: { id: string; status: string; completedAt: string | null };
    };
    const completedPayload = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      runPayload.run.id,
      (payload) => payload.run.status === "completed",
      "Spotlight membership completion",
    )) as { run: { id: string; status: string; completedAt: string | null } };
    const readRun = await request(`/api/reviews/GR-1/spotlight/runs/${runPayload.run.id}`);
    const listed = (await waitForSpotlightViewsPayload(
      request,
      "GR-1",
      (payload) => payload.views.length > 0,
      "Spotlight generated views",
    )) as {
      views: Array<{
        displayRef: string;
        title: string;
        description: string;
        intent: string;
        health: string;
        associatedFiles: Array<{ path: string; oldPath: string | null }>;
      }>;
    };
    const view = listed.views[0];

    if (view === undefined) {
      throw new Error("Mock Spotlight run did not create a view");
    }

    const readView = await request(`/api/spotlight/views/${view.displayRef}`);
    const viewDiff = await request(`/api/spotlight/views/${view.displayRef}/diff`);
    const coverageAfter = (await json(await request("/api/reviews/GR-1/spotlight/coverage"))) as {
      unlitAnchors: ThreadAnchor[];
    };
    const membershipAfter = (await json(
      await request("/api/reviews/GR-1/spotlight/line-membership"),
    )) as {
      memberships: Array<{
        anchor: ThreadAnchor;
        views: Array<{ displayRef: string; title: string }>;
      }>;
    };
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mock teaching for Spotlight",
        workflowType: "teaching",
        provider: "mock",
        model: "mock-teacher",
        systemPrompt: null,
        modelSettings: {},
        allowedTools: [],
        contextPreferences: {},
        privacy: { persistTranscript: false },
      }),
    });
    const viewTeachingConsent = await request("/api/reviews/GR-1/teaching/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileId: "profile_4",
        revisionId: "revision_1",
        scope: { kind: "spotlight_view", viewRef: view.displayRef },
        maxApproximateTokens: 16_000,
      }),
    });
    const viewTeachingConsentPayload = (await json(viewTeachingConsent)) as {
      run: {
        id: string;
        context: {
          scope: {
            kind: string;
            viewRef: string;
            title: string;
            health: string;
          };
          files: Array<{ path: string; hunks: unknown[] }>;
          spotlightRegions: unknown[];
          omittedRegions: unknown[];
        };
      };
    };
    await request(`/api/teaching/runs/${viewTeachingConsentPayload.run.id}/approve`, {
      method: "POST",
    });
    const approvedViewTeaching = (await waitForApiResult(
      async () =>
        (await json(await request(`/api/teaching/runs/${viewTeachingConsentPayload.run.id}`))) as {
          run: {
            status: string;
            output: {
              walkthrough: Array<{
                title: string;
                body: string;
                anchor: ThreadAnchor | null;
              }>;
            } | null;
          };
        },
      (payload) => payload.run.status === "completed" && payload.run.output !== null,
      "view-scoped Teaching output",
    )) as {
      run: {
        output: {
          walkthrough: Array<{
            title: string;
            body: string;
            anchor: ThreadAnchor | null;
          }>;
        };
      };
    };
    const viewTeachingPoint = approvedViewTeaching.run.output.walkthrough[0];

    if (viewTeachingPoint === undefined || viewTeachingPoint.anchor === null) {
      throw new Error("View-scoped teaching output did not include a promotable point");
    }

    const promotedViewTeaching = await request("/api/reviews/GR-1/teaching/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: viewTeachingConsentPayload.run.id,
        title: viewTeachingPoint.title,
        body: viewTeachingPoint.body,
        anchor: viewTeachingPoint.anchor,
      }),
    });

    expect(coverageBefore.unlitAnchors).toHaveLength(3);
    expect(membershipBefore.memberships).toHaveLength(3);
    expect(membershipBefore.memberships.every((entry) => entry.views.length === 0)).toBe(true);
    expect(run.status).toBe(201);
    expect(runPayload.run).toMatchObject({
      id: "spotlight_run_1",
      status: "pending_consent",
      completedAt: null,
      pendingOutline: null,
      contextSummary: { fileCount: 1, hunkCount: 1, changedLineCount: 3 },
    });
    expect(listedWhilePending.views).toEqual([]);
    expect(planning.run).toMatchObject({
      id: "spotlight_run_1",
      status: "planning",
      pendingOutline: null,
    });
    expect(planned.run).toMatchObject({
      id: "spotlight_run_1",
      status: "awaiting_plan_approval",
      pendingOutline: [{ title: "Implementation changes" }],
    });
    expect(refining.run).toMatchObject({
      id: "spotlight_run_1",
      status: "planning",
    });
    expect(refined.run).toMatchObject({
      id: "spotlight_run_1",
      status: "awaiting_plan_approval",
      refinementCount: 1,
      pendingOutline: [{ description: expect.stringContaining("Call out runtime shape") }],
    });
    expect(generatingPayload.run).toMatchObject({
      id: "spotlight_run_1",
      status: "generating",
      completedAt: null,
    });
    expect(completedPayload.run).toMatchObject({
      id: "spotlight_run_1",
      status: "completed",
      completedAt: fixedNow,
    });
    expect(await json(readRun)).toMatchObject({
      run: { id: "spotlight_run_1", approvedOutline: [{ title: "Implementation changes" }] },
    });
    expect(listed.views).toMatchObject([
      {
        displayRef: "SV-1",
        title: "Implementation changes",
        description: expect.stringContaining("Spotlight review"),
        intent: "feature",
        health: "current",
        associatedFiles: [{ path: "src/index.ts", oldPath: null }],
      },
    ]);
    expect(await json(readView)).toMatchObject({
      view: {
        displayRef: "SV-1",
        regions: [
          {
            id: "spotlight_region_1",
            filePath: "src/index.ts",
            anchors: [
              { lineNumber: 1, lineType: "addition" },
              { lineNumber: 2, lineType: "addition" },
              { lineNumber: 3, lineType: "addition" },
            ],
          },
        ],
      },
    });
    expect(await json(viewDiff)).toMatchObject({
      view: { displayRef: "SV-1", associatedFiles: [{ path: "src/index.ts" }] },
      revision: { id: "revision_1" },
      files: [{ path: "src/index.ts" }],
      regions: [{ id: "spotlight_region_1" }],
    });
    expect(coverageAfter.unlitAnchors).toEqual([]);
    expect(membershipAfter.memberships).toHaveLength(3);
    expect(
      membershipAfter.memberships.every((entry) =>
        entry.views.some((membershipView) => membershipView.displayRef === "SV-1"),
      ),
    ).toBe(true);
    expect(viewTeachingConsent.status).toBe(201);
    expect(viewTeachingConsentPayload.run.context).toMatchObject({
      scope: {
        kind: "spotlight_view",
        viewRef: "SV-1",
        title: "Implementation changes",
        health: "current",
      },
      files: [{ path: "src/index.ts", hunks: expect.arrayContaining([expect.any(Object)]) }],
      spotlightRegions: [expect.any(Object)],
      omittedRegions: [],
    });
    expect(await json(promotedViewTeaching)).toMatchObject({
      thread: {
        source: {
          kind: "teaching",
          metadata: {
            teachingRunId: viewTeachingConsentPayload.run.id,
            spotlightViewRef: "SV-1",
            spotlightViewTitle: "Implementation changes",
            spotlightViewHealth: "current",
          },
        },
      },
    });
  });

  it("reconstructs Spotlight pending plan state after API service restart", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const idFactory = deterministicIds();
    const createRestartableFixture = () => {
      const services = createGreenroomApiServices(storage.database, {
        defaultAiBackend: "mock",
        domain: { clock: () => fixedNow, idFactory },
      });
      const app = createGreenroomApp({ services });
      const adminToken = services.tokens.create({ name: "Test admin", scopes: ["admin"] });
      return {
        services,
        request: createAuthedRequester(app, adminToken.plaintextToken),
      };
    };
    const first = createRestartableFixture();

    await first.request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: repository.directory }),
    });
    await first.request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Restartable Spotlight review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await first.request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mock spotlight",
        workflowType: "spotlight",
        provider: "mock",
        model: "mock-spotlight",
        privacy: { persistTranscript: false },
      }),
    });
    const created = (await json(
      await first.request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };

    await first.request(`/api/reviews/GR-1/spotlight/runs/${created.run.id}/approve-context`, {
      method: "POST",
    });
    const planned = await waitForSpotlightRunPayload(
      first.request,
      "GR-1",
      created.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "pre-restart Spotlight outline",
    );
    const second = createRestartableFixture();

    expect(first.services.spotlightPlanStates.has(created.run.id as never)).toBe(true);
    expect(second.services.spotlightPlanStates.has(created.run.id as never)).toBe(false);
    expect(planned.run.pendingOutline).toMatchObject([{ title: "Implementation changes" }]);

    const refining = (await json(
      await second.request(`/api/reviews/GR-1/spotlight/runs/${created.run.id}/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Restart-safe refinement" }),
      }),
    )) as { run: { status: string } };
    const refined = (await waitForSpotlightRunPayload(
      second.request,
      "GR-1",
      created.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "post-restart refined Spotlight outline",
    )) as { run: { pendingOutline: unknown[] } };
    const approved = (await json(
      await second.request(`/api/reviews/GR-1/spotlight/runs/${created.run.id}/approve-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedOutline: refined.run.pendingOutline }),
      }),
    )) as { run: { status: string } };
    const completed = await waitForSpotlightRunPayload(
      second.request,
      "GR-1",
      created.run.id,
      (payload) => payload.run.status === "completed",
      "post-restart Spotlight completion",
    );
    const views = await waitForSpotlightViewsPayload(
      second.request,
      "GR-1",
      (payload) => payload.views.length > 0,
      "post-restart Spotlight views",
    );

    expect(refining.run.status).toBe("planning");
    expect(approved.run.status).toBe("generating");
    expect(completed.run).toMatchObject({ status: "completed" });
    expect(views.views).toMatchObject([{ title: "Implementation changes" }]);
  });

  it("runs harness-backed Spotlight planning, refinement, and membership generation", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          if (harnessRequest.workflow === "spotlight.plan") {
            const longIntent =
              "Implementation changes that touch the end-to-end runtime startup path and require a concise Spotlight label";

            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_outline",
              views: [
                {
                  key: "implementation",
                  title: "Harness implementation",
                  intent: longIntent,
                  description:
                    "Changed implementation lines selected by the harness in src/index.ts.",
                  rationale: "Keep the review centered on the runtime implementation.",
                  anchorKeyHints: [" anchor-key ", "", 42, "x".repeat(241)],
                },
              ],
            });
          }

          if (harnessRequest.workflow === "spotlight.refine") {
            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_outline",
              views: [
                {
                  key: "implementation",
                  title: "Harness runtime implementation",
                  intent: "runtime",
                  description: "Refined runtime-focused implementation lines in src/index.ts.",
                },
              ],
            });
          }

          return completedHarnessResponse(harnessRequest, {
            kind: "spotlight_membership",
            memberships: [],
            uncoveredAnchorKeys: [],
          });
        },
      },
    });

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
        title: "Harness Spotlight review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    const { file: existingThreadFile, line: existingThreadLine } = findFirstChangedLine(
      services.reviews.listDiffFiles("revision_1"),
    );
    const existingThread = await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor: anchorForChangedLine("GR-1", "revision_1", existingThreadFile, existingThreadLine),
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Keep existing review context visible to Spotlight.",
        },
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "fallback-model",
        modelSettings: { harness: { kind: "claude-code" } },
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`, {
      method: "POST",
    });
    const planned = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "harness Spotlight outline",
    )) as {
      run: {
        pendingOutline: Array<{
          anchorKeyHints: string[];
          intent: string;
          rationale: string | null;
        }>;
      };
    };
    const refining = await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "Call out runtime shape" }),
    });
    const refined = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        JSON.stringify(payload.run.pendingOutline).includes("Harness runtime implementation"),
      "refined harness Spotlight outline",
    )) as { run: { pendingOutline: unknown[] } };
    const completed = await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedOutline: refined.run.pendingOutline }),
    });
    const views = (await waitForSpotlightViewsPayload(
      request,
      "GR-1",
      (payload) => payload.views.length > 0,
      "harness Spotlight generated views",
    )) as {
      views: Array<{ title: string; associatedFiles: Array<{ path: string }> }>;
    };

    expect(existingThread.status).toBe(201);
    expect(calls.map((call) => call.workflow)).toEqual([
      "spotlight.plan",
      "spotlight.refine",
      "spotlight.generate",
    ]);
    expect(calls[0]).toMatchObject({
      cwd: repository.directory,
      profile: { harnessKind: "claude-code", model: "fallback-model" },
    });
    expect(services.workflowRunner.readRun(calls[0]!.runId)?.metadata).toMatchObject({
      existingThreadCount: 1,
      existingThreads: [expect.objectContaining({ shortRef: "GT-1", filePath: "src/index.ts" })],
    });
    expect(calls[0]?.runId).toMatch(/^workflow_run_/u);
    expect(calls[0]?.mcp?.allowedTools).toContain("greenroom_submit_spotlight_outline_draft");
    expect(calls[0]?.schema).toMatchObject({
      properties: {
        views: {
          items: {
            properties: {
              intent: { maxLength: 80 },
            },
          },
        },
      },
    });
    expect(calls[1]?.prompt).toContain("Reviewer refinement instruction: Call out runtime shape");
    expect(calls[1]?.prompt).toContain("Current outline items:");
    expect(calls[2]?.mcp?.allowedTools).toContain("greenroom_submit_spotlight_membership_draft");
    expect(calls[2]?.schema).toMatchObject({
      properties: {
        memberships: {
          items: {
            properties: {
              anchorKeys: {
                items: {
                  description: expect.stringContaining("not a file path"),
                },
              },
              filePaths: {
                items: {
                  description: expect.stringContaining("assign every changed-line anchor"),
                },
              },
            },
          },
        },
      },
    });
    expect(planned.run.pendingOutline[0]?.intent.length).toBeLessThanOrEqual(80);
    expect(services.workflowRunner.readRun(calls[0]!.runId)?.draftOutput).toMatchObject({
      views: [
        {
          rationale: "Keep the review centered on the runtime implementation.",
          anchorKeyHints: ["anchor-key"],
        },
      ],
    });
    expect(refining.status).toBe(200);
    expect(completed.status).toBe(200);
    expect(views.views).toMatchObject([
      {
        title: "Harness runtime implementation",
        associatedFiles: [{ path: "src/index.ts" }],
      },
    ]);
  });

  it("splits large file-path Spotlight memberships into valid regions", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createLargeDiffRepository(650);
    const { request } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          if (harnessRequest.workflow === "spotlight.plan") {
            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_outline",
              views: [
                {
                  key: "generated-file",
                  title: "Generated file",
                  intent: "generated",
                  description: "Review the generated file changes in src/generated.ts.",
                },
              ],
            });
          }

          return completedHarnessResponse(harnessRequest, {
            kind: "spotlight_membership",
            memberships: [
              {
                viewKey: "generated-file",
                anchorKeys: [],
                filePaths: ["src/generated.ts"],
                rationale: null,
              },
            ],
            uncoveredAnchorKeys: [],
            uncoveredFiles: [],
          });
        },
      },
    });

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
        title: "Large Spotlight review",
        baseRef: "main",
        headRef: "feature/large-diff",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "codex",
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`, {
      method: "POST",
    });
    const planned = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "large Spotlight outline",
    )) as { run: { pendingOutline: unknown[] } };
    const completed = await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedOutline: planned.run.pendingOutline }),
    });
    const views = (await waitForSpotlightViewsPayload(
      request,
      "GR-1",
      (payload) => payload.views.length > 0,
      "large Spotlight generated views",
    )) as {
      views: Array<{ displayRef: string; associatedFiles: Array<{ path: string }> }>;
    };
    const view = (await json(
      await request(`/api/spotlight/views/${views.views[0]!.displayRef}`),
    )) as {
      view: { regions: Array<{ filePath: string; anchors: unknown[] }> };
    };

    expect(completed.status).toBe(200);
    expect(views.views).toMatchObject([{ associatedFiles: [{ path: "src/generated.ts" }] }]);
    expect(view.view.regions).toHaveLength(4);
    expect(view.view.regions.map((region) => region.anchors.length)).toEqual([200, 200, 200, 50]);
    expect(view.view.regions.every((region) => region.filePath === "src/generated.ts")).toBe(true);
  });

  it("repairs Spotlight membership drafts that leave anchors unaccounted", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createLargeDiffRepository(5);
    const calls: HarnessRunRequest[] = [];
    const firstAnchorKey = "GR-1:revision_1:src/generated.ts::head:addition:1";
    const { request } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          if (harnessRequest.workflow === "spotlight.plan") {
            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_outline",
              views: [
                {
                  key: "first-constant",
                  title: "First generated constant",
                  intent: "first constant",
                  // No file path here: path recovery must not mask the
                  // unassigned-anchor completeness check.
                  description: "Review the first generated constant only.",
                },
              ],
            });
          }

          const membershipAttempt = calls.filter(
            (call) => call.workflow === "spotlight.generate",
          ).length;

          if (membershipAttempt === 1) {
            // Lazy draft: one anchor assigned, four silently dropped.
            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_membership",
              memberships: [
                { viewKey: "first-constant", anchorKeys: [firstAnchorKey], rationale: null },
              ],
              uncoveredAnchorKeys: [],
            });
          }

          // Repaired draft: the remaining anchors are accounted for through
          // the whole-file shorthand in uncoveredAnchorKeys.
          return completedHarnessResponse(harnessRequest, {
            kind: "spotlight_membership",
            memberships: [
              { viewKey: "first-constant", anchorKeys: [firstAnchorKey], rationale: null },
            ],
            uncoveredAnchorKeys: ["src/generated.ts"],
          });
        },
      },
    });

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
        title: "Unaccounted membership review",
        baseRef: "main",
        headRef: "feature/large-diff",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "codex",
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`, {
      method: "POST",
    });
    const planned = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "repair Spotlight outline",
    )) as { run: { pendingOutline: unknown[] } };
    const completed = await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedOutline: planned.run.pendingOutline }),
    });

    expect(completed.status).toBe(200);

    // The auto-repair relaunch is asynchronous; wait for the repaired draft
    // to land before asserting on the resulting views.
    let views: { views: Array<{ associatedFiles: Array<{ path: string }> }> } = { views: [] };
    for (let poll = 0; poll < 100; poll += 1) {
      views = (await json(await request("/api/reviews/GR-1/spotlight/views"))) as {
        views: Array<{ associatedFiles: Array<{ path: string }> }>;
      };

      if (views.views[0]?.associatedFiles.length) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const membershipCalls = calls.filter((call) => call.workflow === "spotlight.generate");

    expect(membershipCalls).toHaveLength(2);
    expect(membershipCalls[1]?.repairAttemptNumber).toBe(1);
    expect(views.views).toMatchObject([{ associatedFiles: [{ path: "src/generated.ts" }] }]);
  });

  it("rejects invalid Spotlight outline drafts before plan approval", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          return completedHarnessResponse(harnessRequest, {
            kind: "spotlight_outline",
            views: [
              {
                key: "implementation",
                title: "Implementation",
                intent: "feature",
                description: "First duplicate outline.",
              },
              {
                key: "implementation",
                title: "Implementation",
                intent: "feature",
                description: "Second duplicate outline.",
              },
            ],
          });
        },
      },
    });

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
        title: "Invalid Spotlight outline review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "codex",
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    const approval = await request(
      `/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`,
      { method: "POST" },
    );
    const workflow = await waitForApiResult(
      async () =>
        services.workflowRunner
          .listRunsByReview("review_1")
          .find((candidate) => candidate.workflowKind === "spotlight_plan"),
      (candidate) => candidate?.status === "failed",
      "invalid Spotlight outline workflow failure",
    );
    const runFailure = await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) => payload.run.status === "failed",
      "invalid Spotlight outline run failure",
    );
    const views = (await json(await request("/api/reviews/GR-1/spotlight/views"))) as {
      views: unknown[];
    };

    expect(approval.status).toBe(200);
    // Initial run plus two repair attempts (default maxRepairAttempts is 2).
    expect(calls.map((call) => call.workflow)).toEqual([
      "spotlight.plan",
      "spotlight.plan",
      "spotlight.plan",
    ]);
    expect(workflow).toMatchObject({
      status: "failed",
      validationIssues: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-view-key" }),
        expect.objectContaining({ code: "duplicate-view-title" }),
      ]),
    });
    expect(runFailure).toMatchObject({ run: { status: "failed" } });
    expect(views.views).toEqual([]);
  });

  it("rejects invalid Spotlight membership anchor keys before persistence", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);

          if (harnessRequest.workflow === "spotlight.plan") {
            return completedHarnessResponse(harnessRequest, {
              kind: "spotlight_outline",
              views: [
                {
                  key: "implementation",
                  title: "Harness implementation",
                  intent: "feature",
                  description: "Changed implementation lines selected by the harness.",
                },
              ],
            });
          }

          return completedHarnessResponse(harnessRequest, {
            kind: "spotlight_membership",
            memberships: [
              {
                viewKey: "implementation",
                anchorKeys: ["GR-1:revision_1:src/index.ts::head:addition:999"],
                rationale: "Invalid anchor for validation.",
              },
            ],
            uncoveredAnchorKeys: [
              firstAnchorKeyFromDiff(
                "GR-1",
                "revision_1",
                services.reviews.listDiffFiles("revision_1"),
              ),
              "GR-1:revision_1:src/index.ts::head:addition:998",
            ],
          });
        },
      },
    });

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
        title: "Invalid Spotlight membership review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "codex",
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`, {
      method: "POST",
    });
    const planned = (await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "invalid membership Spotlight outline",
    )) as { run: { pendingOutline: unknown[] } };
    const approved = await request(`/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedOutline: planned.run.pendingOutline }),
    });
    const workflow = await waitForApiResult(
      async () =>
        services.workflowRunner
          .listRunsByReview("review_1")
          .find((candidate) => candidate.workflowKind === "spotlight_membership"),
      (candidate) => candidate?.status === "failed",
      "invalid Spotlight membership workflow failure",
    );
    const runFailure = await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) => payload.run.status === "failed",
      "invalid Spotlight membership run failure",
    );
    const views = (await json(await request("/api/reviews/GR-1/spotlight/views"))) as {
      views: unknown[];
    };

    expect(approved.status).toBe(200);
    // Plan run, then the membership run plus two repair attempts (default
    // maxRepairAttempts is 2).
    expect(calls.map((call) => call.workflow)).toEqual([
      "spotlight.plan",
      "spotlight.generate",
      "spotlight.generate",
      "spotlight.generate",
    ]);
    expect(workflow).toMatchObject({
      status: "failed",
      validationIssues: expect.arrayContaining([
        expect.objectContaining({ code: "unknown-anchor-key" }),
        expect.objectContaining({ code: "unknown-uncovered-anchor-key" }),
      ]),
    });
    expect(runFailure).toMatchObject({ run: { status: "failed" } });
    expect(views.views).toEqual([]);
  });

  it("creates built-in AI review threads from validated harness findings", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    let servicesRef: ReturnType<typeof createGreenroomApiServices> | null = null;
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);
          if (servicesRef === null) {
            throw new Error("Fixture services were not initialized");
          }

          const run = servicesRef.workflowRunner.readRun(harnessRequest.runId as WorkflowRunId);

          if (run === null) {
            throw new Error("Workflow run was not found");
          }

          const anchorKey = firstAnchorKeyFromDiff(
            run.reviewDisplayId,
            run.revisionId,
            servicesRef.reviews.listDiffFiles(run.revisionId),
          );

          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Harness review summary.",
            findings: [
              {
                id: "finding-1",
                title: "Check the returned value",
                body: "The changed return path should be reviewed with its callers.",
                type: "issue",
                severity: "major",
                anchorKey,
                confidence: 0.84,
              },
            ],
            nonFindings: ["No omitted files were reviewed."],
          });
        },
      },
    });
    servicesRef = services;

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
        title: "Built-in review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
        modelSettings: { harness: { kind: "codex" } },
        contextPreferences: { autoCreateThreads: true },
      }),
    });
    const consent = (await json(
      await request("/api/reviews/GR-1/builtin-review/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "profile_3", revisionId: "revision_1" }),
      }),
    )) as {
      run: {
        id: string;
        status: string;
        context: { files: Array<{ hunks: unknown[] }> };
      };
    };
    const workflowRun = services.workflowRunner.readRun(consent.run.id as WorkflowRunId);
    const approved = await request(`/api/builtin-review/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = await json(approved);
    const completedPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/builtin-review/runs/${consent.run.id}`))) as {
          run: { status: string; output: unknown; createdThreadRefs: string[] };
        },
      (payload) => payload.run.status === "completed",
      "built-in review completion",
    );
    const threads = await request("/api/reviews/GR-1/threads");
    const events = services.agentEvents.listByReview("review_1");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workflow: "builtin_review",
      runId: consent.run.id,
      cwd: repository.directory,
      outputMode: "builtin_review_findings",
      mcp: {
        allowedTools: expect.arrayContaining([
          "greenroom_read_diff_file",
          "greenroom_submit_review_findings_draft",
        ]),
      },
    });
    expect(consent.run.status).toBe("pending_consent");
    expect(consent.run.id).toMatch(/^workflow_run_/u);
    expect(consent.run.context.files.every((file) => file.hunks.length === 0)).toBe(true);
    expect(JSON.stringify(consent.run.context)).not.toContain("return 42");
    expect(calls[0]?.prompt).not.toContain("return 42");
    expect(workflowRun).toMatchObject({
      consentSummary: {
        expectedOutputMode: "builtin_review_findings",
        threadCreationGate: { mode: "auto_create_after_validation" },
        expectedMcpResources: expect.arrayContaining([
          "greenroom://reviews/GR-1/manifest",
          "greenroom://reviews/GR-1/files/{path}",
          "greenroom://reviews/GR-1/anchors/{path}",
          "greenroom://reviews/GR-1/threads",
        ]),
      },
    });
    expect(approvedPayload).toMatchObject({
      run: {
        status: "approved",
        output: null,
        createdThreadRefs: [],
      },
    });
    expect(completedPayload).toMatchObject({
      run: {
        status: "completed",
        output: { summary: "Harness review summary.", findings: [{ id: "finding-1" }] },
        createdThreadRefs: ["GT-1"],
      },
    });
    expect(await json(threads)).toMatchObject({
      threads: [
        {
          shortRef: "GT-1",
          type: "issue",
          severity: "major",
          source: {
            kind: "builtin_reviewer",
            displayName: "Harness reviewer",
            profileId: "profile_3",
            metadata: {
              workflowRunId: consent.run.id,
              builtinReviewRunId: consent.run.id,
              harnessKind: "codex",
              profileId: "profile_3",
              confidence: 0.84,
              findingId: "finding-1",
            },
          },
          comments: [
            {
              authorKind: "builtin_reviewer",
              body: expect.stringContaining("The changed return path"),
            },
          ],
        },
      ],
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Built-in review run started",
          metadata: expect.objectContaining({ workflowRunId: consent.run.id }),
        }),
        expect.objectContaining({
          summary: "Built-in review created review threads",
          threadRefs: ["GT-1"],
          metadata: expect.objectContaining({ createdThreadCount: 1 }),
        }),
      ]),
    );
  });

  it("holds built-in AI review draft findings until explicit draft approval by default", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    let servicesRef: ReturnType<typeof createGreenroomApiServices> | null = null;
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          if (servicesRef === null) {
            throw new Error("Fixture services were not initialized");
          }

          const run = servicesRef.workflowRunner.readRun(harnessRequest.runId as WorkflowRunId);

          if (run === null) {
            throw new Error("Workflow run was not found");
          }

          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Validated draft summary.",
            findings: [
              {
                id: "finding-1",
                title: "Review the changed return",
                body: "This finding should wait for explicit draft approval.",
                type: "issue",
                severity: "minor",
                anchorKey: firstAnchorKeyFromDiff(
                  run.reviewDisplayId,
                  run.revisionId,
                  servicesRef.reviews.listDiffFiles(run.revisionId),
                ),
                confidence: 0.7,
              },
            ],
          });
        },
      },
    });
    servicesRef = services;

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
        title: "Draft-gated built-in review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
        modelSettings: { harness: { kind: "codex" } },
      }),
    });
    const consent = (await json(
      await request("/api/reviews/GR-1/builtin-review/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "profile_3" }),
      }),
    )) as { run: { id: string } };
    const approved = await request(`/api/builtin-review/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = (await json(approved)) as {
      run: {
        status: string;
        output: null;
        createdThreadRefs: string[];
      };
    };
    const awaitingDraftPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/builtin-review/runs/${consent.run.id}`))) as {
          run: {
            status: string;
            output: { findings: Array<{ id: string }> } | null;
            createdThreadRefs: string[];
          };
        },
      (payload) => payload.run.status === "awaiting_user",
      "built-in review draft approval gate",
    );
    const threadsBeforeDraftApproval = await request("/api/reviews/GR-1/threads");
    const draftApproval = await request(
      `/api/builtin-review/runs/${consent.run.id}/approve-draft`,
      {
        method: "POST",
      },
    );
    const workflowRun = services.workflowRunner.readRun(consent.run.id as WorkflowRunId);
    const threadsAfterDraftApproval = await request("/api/reviews/GR-1/threads");

    expect(approvedPayload).toMatchObject({
      run: {
        status: "approved",
        output: null,
        createdThreadRefs: [],
      },
    });
    expect(awaitingDraftPayload).toMatchObject({
      run: {
        status: "awaiting_user",
        output: { findings: [{ id: "finding-1" }] },
        createdThreadRefs: [],
      },
    });
    expect(await json(threadsBeforeDraftApproval)).toMatchObject({ threads: [] });
    expect(await json(draftApproval)).toMatchObject({
      run: {
        status: "completed",
        createdThreadRefs: ["GT-1"],
      },
    });
    expect(await json(threadsAfterDraftApproval)).toMatchObject({
      threads: [
        {
          shortRef: "GT-1",
          source: {
            kind: "builtin_reviewer",
            metadata: expect.objectContaining({ workflowRunId: consent.run.id }),
          },
        },
      ],
    });
    expect(workflowRun).toMatchObject({
      consentSummary: {
        threadCreationGate: { mode: "draft_approval_required", autoCreateThreads: false },
      },
    });
  });

  it("rejects built-in AI review findings with unknown anchor keys without creating threads", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const calls: HarnessRunRequest[] = [];
    const { request, services } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Invalid harness review summary.",
            findings: [
              {
                id: "finding-1",
                title: "Unknown anchor",
                body: "This finding points outside the approved context.",
                type: "issue",
                severity: "major",
                anchorKey: "unknown-anchor",
                confidence: 0.5,
              },
            ],
          });
        },
      },
    });

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
        title: "Invalid built-in review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Harness reviewer",
        workflowType: "builtin_review",
        provider: "harness",
        model: "codex",
      }),
    });
    const consent = (await json(
      await request("/api/reviews/GR-1/builtin-review/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "profile_3" }),
      }),
    )) as { run: { id: string } };
    const approval = await request(`/api/builtin-review/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const approvalPayload = await json(approval);
    const failedPayload = await waitForApiResult(
      async () =>
        (await json(await request(`/api/builtin-review/runs/${consent.run.id}`))) as {
          run: { status: string; output: unknown; createdThreadRefs: string[] };
        },
      (payload) => payload.run.status === "failed",
      "built-in review validation failure",
    );
    const threads = await request("/api/reviews/GR-1/threads");

    expect(approval.status).toBe(200);
    expect(approvalPayload).toMatchObject({
      run: { status: "approved", output: null, createdThreadRefs: [] },
    });
    expect(failedPayload).toMatchObject({
      run: { status: "failed", output: null, createdThreadRefs: [] },
    });
    expect(await json(threads)).toMatchObject({ threads: [] });
    // Initial run plus two repair attempts (default maxRepairAttempts is 2).
    expect(calls).toHaveLength(3);
    expect(services.workflowRunner.readRun(consent.run.id as WorkflowRunId)).toMatchObject({
      status: "failed",
      validationIssues: expect.arrayContaining([
        expect.objectContaining({ code: "unknown-anchor-key" }),
      ]),
    });
  });

  it("remaps and marks stale Spotlight regions on refresh", async () => {
    const fixture = await createSpotlightEvolutionFixture();
    const { generated, initialView } = fixture;
    const { drifted, driftedPayload, driftedView, remapped, remappedPayload, remappedView } =
      await prepareDriftedSpotlight(fixture);
    expect(generated.run).toMatchObject({ status: "planning", type: "generate" });
    expect(remapped.status).toBe(201);
    expect(remappedPayload).toMatchObject({
      revision: { id: "revision_2" },
      spotlightRemap: { remapped: 1, stale: 0, driftedViews: 0 },
    });
    expect(remappedView.view).toMatchObject({
      displayRef: initialView.displayRef,
      health: "current",
      lastReconciledRevisionId: "revision_2",
      regions: [{ stale: false }],
    });
    expect(
      remappedView.view.regions.every((region) =>
        region.anchors.every((anchor) => anchor.revisionId === "revision_2"),
      ),
    ).toBe(true);
    expect(drifted.status).toBe(201);
    expect(driftedPayload).toMatchObject({
      revision: { id: "revision_3" },
      spotlightRemap: { remapped: 0, stale: 1, driftedViews: 1 },
    });
    expect(driftedView.view).toMatchObject({
      displayRef: initialView.displayRef,
      health: "drifted",
      lastReconciledRevisionId: "revision_3",
      regions: [{ stale: true }],
    });
    expect(
      driftedView.view.regions.every((region) =>
        region.anchors.every((anchor) => anchor.revisionId === "revision_2"),
      ),
    ).toBe(true);
  });

  it("updates drifted Spotlight regions against the current revision", async () => {
    const fixture = await createSpotlightEvolutionFixture();
    const { driftedPayload } = await prepareDriftedSpotlight(fixture);
    const updated = (await json(
      await fixture.request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "update",
          trigger: "manual",
          gated: false,
          revisionId: driftedPayload.revision.id,
          profileId: fixture.profileId,
        }),
      }),
    )) as { run: { id: string; status: string; type: string } };
    await waitForSpotlightRunPayload(
      fixture.request,
      "GR-1",
      updated.run.id,
      (payload) => payload.run.status === "completed",
      "trusted update Spotlight completion",
    );
    const updatedView = (await json(
      await fixture.request(`/api/spotlight/views/${fixture.initialView.displayRef}`),
    )) as {
      view: {
        displayRef: string;
        health: string;
        regions: Array<{ stale: boolean; anchors: ThreadAnchor[] }>;
      };
    };

    expect(updated.run).toMatchObject({ status: "planning", type: "update" });
    expect(updatedView.view).toMatchObject({
      displayRef: fixture.initialView.displayRef,
      health: "current",
      regions: [{ stale: false }],
    });
    expect(
      updatedView.view.regions.every((region) =>
        region.anchors.every(
          (anchor) =>
            anchor.revisionId === driftedPayload.revision.id && anchor.lineType === "addition",
        ),
      ),
    ).toBe(true);
  });

  it("regenerates Spotlight views as independent replacements", async () => {
    const fixture = await createSpotlightEvolutionFixture();
    const regenerated = (await json(
      await fixture.request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "regenerate",
          trigger: "manual",
          gated: false,
          revisionId: "revision_1",
          profileId: fixture.profileId,
          confirmed: true,
        }),
      }),
    )) as { run: { id: string; status: string; type: string } };
    await waitForSpotlightRunPayload(
      fixture.request,
      "GR-1",
      regenerated.run.id,
      (payload) => payload.run.status === "completed",
      "trusted regenerate Spotlight completion",
    );
    const regeneratedViews = (await waitForSpotlightViewsPayload(
      fixture.request,
      "GR-1",
      (payload) =>
        payload.views.some(
          (view) =>
            typeof view === "object" &&
            view !== null &&
            "displayRef" in view &&
            view.displayRef !== fixture.initialView.displayRef,
        ),
      "trusted regenerated Spotlight views",
    )) as {
      views: Array<{ displayRef: string; title: string; description: string; health: string }>;
    };
    const regeneratedView = regeneratedViews.views[0];

    if (regeneratedView === undefined) {
      throw new Error("Expected regenerate to create a replacement view");
    }

    expect(regenerated.run).toMatchObject({ status: "planning", type: "regenerate" });
    expect(regeneratedView.displayRef).not.toBe(fixture.initialView.displayRef);
    expect(regeneratedView).toMatchObject({ health: "current" });
  });

  it("refines a Spotlight view through plan approval", async () => {
    const fixture = await createSpotlightEvolutionFixture();
    const refineRun = (await json(
      await fixture.request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "refine_view",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: fixture.profileId,
          targetViewId: fixture.initialView.displayRef,
        }),
      }),
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string }>;
      };
    };
    const refinePlan = (await waitForSpotlightRunPayload(
      fixture.request,
      "GR-1",
      refineRun.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "refine-view initial outline",
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string }>;
      };
    };
    const refining = (await json(
      await fixture.request(`/api/reviews/GR-1/spotlight/runs/${refineRun.run.id}/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Narrow this to deletion fallout" }),
      }),
    )) as { run: { status: string } };
    const refined = (await waitForSpotlightRunPayload(
      fixture.request,
      "GR-1",
      refineRun.run.id,
      (payload) =>
        payload.run.status === "awaiting_plan_approval" &&
        Array.isArray(payload.run.pendingOutline),
      "refine-view refined outline",
    )) as {
      run: {
        id: string;
        status: string;
        pendingOutline: Array<{ title: string; description: string }>;
      };
    };
    const approvedRefine = (await json(
      await fixture.request(`/api/reviews/GR-1/spotlight/runs/${refineRun.run.id}/approve-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedOutline: refined.run.pendingOutline }),
      }),
    )) as { run: { status: string; type: string } };
    await waitForSpotlightRunPayload(
      fixture.request,
      "GR-1",
      refineRun.run.id,
      (payload) => payload.run.status === "completed",
      "refine-view membership completion",
    );
    const refinedViews = (await waitForSpotlightViewsPayload(
      fixture.request,
      "GR-1",
      (payload) => payload.views.length > 0,
      "refine-view generated views",
    )) as {
      views: Array<{ displayRef: string; description: string; health: string }>;
    };

    expect(refineRun.run).toMatchObject({ status: "planning" });
    expect(refinePlan.run).toMatchObject({
      status: "awaiting_plan_approval",
      pendingOutline: [{ title: fixture.initialView.title }],
    });
    expect(refining.run).toMatchObject({ status: "planning" });
    expect(approvedRefine.run).toMatchObject({ status: "updating", type: "refine_view" });
    expect(refinedViews.views).toMatchObject([
      {
        displayRef: fixture.initialView.displayRef,
        description: expect.stringContaining("Narrow this to deletion fallout"),
        health: "current",
      },
    ]);
  });

  it("records Spotlight provider failures on the run and agent event stream", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      spotlightProviders: {
        custom: {
          kind: "custom",
          async planViews() {
            throw new Error("Stage Manager provider failed");
          },
          async refinePlan() {
            throw new Error("Stage Manager provider failed");
          },
          async generateViews() {
            throw new Error("Stage Manager provider failed");
          },
        },
      },
    });
    const app = createGreenroomApp({ services });
    const adminToken = services.tokens.create({ name: "Test admin", scopes: ["admin"] });
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
        title: "Failing Spotlight review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });
    await request("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Failing spotlight",
        workflowType: "spotlight",
        provider: "custom",
        model: "failing-stage-manager",
        systemPrompt: null,
        modelSettings: {},
        allowedTools: [],
        contextPreferences: {},
        privacy: { persistTranscript: false },
      }),
    });
    const run = (await json(
      await request("/api/reviews/GR-1/spotlight/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          trigger: "manual",
          gated: true,
          revisionId: "revision_1",
          profileId: "profile_3",
        }),
      }),
    )) as { run: { id: string } };
    const approval = await request(
      `/api/reviews/GR-1/spotlight/runs/${run.run.id}/approve-context`,
      { method: "POST" },
    );
    const failedRun = await waitForSpotlightRunPayload(
      request,
      "GR-1",
      run.run.id,
      (payload) => payload.run.status === "failed",
      "failing Spotlight provider run",
    );
    const events = services.agentEvents.listByReview("review_1");

    expect(approval.status).toBe(200);
    expect(failedRun).toMatchObject({
      run: {
        id: "spotlight_run_1",
        status: "failed",
        errorMessage: "Stage Manager provider failed",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Spotlight run failed",
          metadata: expect.objectContaining({
            runId: "spotlight_run_1",
            errorMessage: "Stage Manager provider failed",
          }),
        }),
      ]),
    );
  });

  it("persists anchored threads and replies across API restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "greenroom-api-restart-"));
    const databasePath = join(directory, "greenroom.sqlite");
    let firstDatabase: ReturnType<typeof openGreenroomDatabase> | null = null;
    let secondDatabase: ReturnType<typeof openGreenroomDatabase> | null = null;

    try {
      const repository = await createReviewRepository();
      firstDatabase = openGreenroomDatabase({ databasePath });
      const firstServices = createGreenroomApiServices(firstDatabase, {
        domain: {
          clock: () => fixedNow,
          idFactory: deterministicIds(),
        },
      });
      const adminToken = firstServices.tokens.create({
        name: "Restart admin",
        scopes: ["admin"],
      }).plaintextToken;
      const firstApp = createGreenroomApp({
        services: firstServices,
      });
      const firstRequest = createAuthedRequester(firstApp, adminToken);

      await firstRequest("/api/repositories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: repository.directory }),
      });
      await firstRequest("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: "repo_1",
          title: "Restart review",
          baseRef: "main",
          headRef: "feature/review",
        }),
      });

      const diff = (await json(await firstRequest("/api/reviews/GR-1/diff"))) as {
        files: DiffFile[];
      };
      const { file, line } = findFirstChangedLine(diff.files);
      const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);

      await firstRequest("/api/reviews/GR-1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewDisplayId: "GR-1",
          type: "issue",
          severity: "major",
          source: { kind: "human", displayName: "Reviewer" },
          anchor,
          firstComment: {
            authorKind: "human",
            authorDisplayName: "Reviewer",
            body: "This needs a restart-safe thread.",
          },
        }),
      });
      await firstRequest("/api/threads/GT-1/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorKind: "human",
          authorDisplayName: "Author",
          body: "Reply before restart.",
        }),
      });
      await firstRequest("/api/threads/GT-1/resolve", {
        method: "POST",
      });

      firstDatabase.close();
      firstDatabase = null;

      secondDatabase = openGreenroomDatabase({ databasePath });
      const secondApp = createGreenroomApp({
        services: createGreenroomApiServices(secondDatabase),
      });
      const secondRequest = createAuthedRequester(secondApp, adminToken);
      const listed = await secondRequest("/api/reviews/GR-1/threads");
      const read = await secondRequest("/api/threads/GT-1");

      expect(listed.status).toBe(200);
      expect(await json(listed)).toMatchObject({
        threads: [{ shortRef: "GT-1", status: "resolved", comments: [{}, {}] }],
      });
      expect(await json(read)).toMatchObject({
        thread: {
          shortRef: "GT-1",
          type: "issue",
          severity: "major",
          status: "resolved",
          comments: [
            { body: "This needs a restart-safe thread." },
            { body: "Reply before restart." },
          ],
        },
      });
    } finally {
      firstDatabase?.close();
      secondDatabase?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("serves display refs as the only external identifiers and rejects opaque ids", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request, services } = createApiFixture(storage);

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
        title: "Identifier contract review",
        baseRef: "main",
        headRef: "feature/review",
      }),
    });

    const diff = (await json(await request("/api/reviews/GR-1/diff"))) as { files: DiffFile[] };
    const { file, line } = findFirstChangedLine(diff.files);
    const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);
    await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor,
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "Pinning the identifier contract.",
        },
      }),
    });

    const spotlightRun = services.spotlight.createRun({
      reviewDisplayId: "GR-1",
      type: "generate",
      trigger: "manual",
      gated: false,
      status: "completed",
      revisionId: "revision_1",
      profileId: "profile_2",
    });
    const view = services.spotlight.createView({
      reviewDisplayId: "GR-1",
      title: "Identifier contract view",
      description: "Serialization regression fixture.",
      intent: "feature",
      orderIndex: 0,
      health: "current",
      originRunId: spotlightRun.id,
      lastReconciledRevisionId: "revision_1",
    });
    services.spotlight.replaceRegions(view.displayRef, [
      {
        filePath: anchor.filePath,
        oldPath: anchor.oldFilePath,
        anchors: [anchor],
        remapConfidence: null,
        stale: false,
      },
    ]);

    // The anchor round-trips through persistence with its display ref intact.
    const readThread = (await json(await request("/api/threads/GT-1"))) as {
      thread: { reviewDisplayId: string; anchor: { reviewDisplayId: string } };
    };
    expect(readThread.thread.reviewDisplayId).toBe("GR-1");
    expect(readThread.thread.anchor.reviewDisplayId).toBe("GR-1");

    // Walk every entity-serving response: no opaque review/thread/view id may
    // appear anywhere in the payload. Comments, revisions, profiles, and runs
    // keep opaque ids by design and are not matched by this pattern.
    const forbiddenOpaqueId = /^(review_|thread_|spotlight_view_)/u;
    const collectOpaqueIds = (value: unknown, path: string, hits: string[]): void => {
      if (typeof value === "string") {
        if (forbiddenOpaqueId.test(value)) {
          hits.push(`${path} = ${value}`);
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((entry, index) => collectOpaqueIds(entry, `${path}[${index}]`, hits));
        return;
      }

      if (typeof value === "object" && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
          collectOpaqueIds(entry, `${path}.${key}`, hits);
        }
      }
    };

    const endpoints = [
      "/api/reviews",
      "/api/reviews/GR-1",
      "/api/reviews/GR-1/diff",
      "/api/reviews/GR-1/revisions",
      "/api/reviews/GR-1/threads",
      "/api/threads/GT-1",
      "/api/reviews/GR-1/spotlight/views",
      "/api/spotlight/views/SV-1",
      "/api/spotlight/views/SV-1/diff",
      "/api/reviews/GR-1/spotlight/coverage",
      "/api/reviews/GR-1/spotlight/line-membership",
      "/api/reviews/GR-1/workflow-runs",
      "/api/reviews/GR-1/worktree-status",
    ];

    for (const endpoint of endpoints) {
      const response = await request(endpoint);
      expect(response.status, endpoint).toBe(200);
      const hits: string[] = [];
      collectOpaqueIds(await json(response), endpoint, hits);
      expect(hits, endpoint).toEqual([]);
    }

    // Opaque ids are rejected at the path-parameter boundary for all three
    // entity types.
    expect((await request("/api/reviews/review_1")).status).toBe(400);
    expect((await request("/api/threads/thread_1")).status).toBe(400);
    expect((await request("/api/spotlight/views/spotlight_view_1")).status).toBe(400);
    // Unknown display refs are a clean 404.
    expect((await request("/api/reviews/GR-99")).status).toBe(404);
    expect((await request("/api/threads/GT-99")).status).toBe(404);
    expect((await request("/api/spotlight/views/SV-99")).status).toBe(404);
  });

  it("returns typed errors for invalid request bodies and invalid thread anchors", async () => {
    const storage = createTestStorage();
    storages.push(storage);
    const repository = await createReviewRepository();
    const { request } = createApiFixture(storage);

    const invalidRepository = await request("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: "relative/path" }),
    });
    const invalidWholeRepositoryReview = await request("/api/reviews/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        comparisonMode: "whole_repository",
        baseRef: "main",
        headRef: "main",
      }),
    });

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

    const diff = (await json(await request("/api/reviews/GR-1/diff"))) as {
      files: DiffFile[];
    };
    const { file, line } = findFirstChangedLine(diff.files);
    const anchor = anchorForChangedLine("GR-1", "revision_1", file, line);
    const invalidThread = await request("/api/reviews/GR-1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewDisplayId: "GR-1",
        type: "question",
        source: { kind: "human", displayName: "Reviewer" },
        anchor: { ...anchor, lineNumber: 999 },
        firstComment: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body: "This anchor should fail.",
        },
      }),
    });

    expect(invalidRepository.status).toBe(400);
    expect(await json(invalidRepository)).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(invalidWholeRepositoryReview.status).toBe(400);
    expect(await json(invalidWholeRepositoryReview)).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(invalidThread.status).toBe(400);
    expect(await json(invalidThread)).toMatchObject({
      error: { code: "bad_request", message: "Thread anchor must target a changed diff line" },
    });
  });
});
