import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import {
  callGreenroomTool,
  createGreenroomHttpClient,
  type ReviewDiffFileResource,
} from "@greenroom/mcp";
import type { HarnessRunRequest, HarnessRunResponse, WorkflowRunId } from "@greenroom/schemas";

import { createGreenroomApp } from "../apps/server/src/api/app";
import {
  createGreenroomApiServices,
  type GreenroomApiServiceOptions,
} from "../apps/server/src/api/services";
import { createTestStorage, type TestStorage } from "../apps/server/src/testing/storage";

const fixedNow = "2026-06-29T12:00:00.000Z";

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

async function waitForResult<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  description: string,
): Promise<T> {
  let latest: T;

  for (let poll = 0; poll < 100; poll += 1) {
    latest = await read();

    if (predicate(latest)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

describe("large-diff harness context", () => {
  it("keeps prompts compact while MCP path reads expose diff chunks", async () => {
    const storage = createStorage();
    const repository = await createLargeDiffRepository(1_200);
    const calls: HarnessRunRequest[] = [];
    const { app, request, services, adminToken } = createApiFixture(storage, {
      harnessClient: {
        async run(harnessRequest) {
          calls.push(harnessRequest);
          return completedHarnessResponse(harnessRequest, {
            kind: "builtin_review_findings",
            summary: "Large diff reviewed through MCP path-scoped reads.",
            findings: [],
            nonFindings: ["No inline full diff was needed."],
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
        title: "Large diff context review",
        baseRef: "main",
        headRef: "feature/large-diff",
      }),
    });
    const profileId = await createProfile(request, {
      name: "Large diff harness reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code" } },
    });
    const consent = (await json(
      await request("/api/reviews/GR-1/builtin-review/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId, revisionId: "revision_1" }),
      }),
    )) as { run: { id: string } };
    const approved = await request(`/api/builtin-review/runs/${consent.run.id}/approve`, {
      method: "POST",
    });
    const client = createGreenroomHttpClient({
      baseUrl: "http://greenroom.test",
      token: adminToken,
      fetch: createAppFetch(app),
    });
    const pathScopedDiff = (await callGreenroomTool(client, "greenroom_read_diff_file", {
      reviewId: "GR-1",
      path: "src/generated.ts",
    })) as ReviewDiffFileResource;
    const serializedPathScopedDiff = JSON.stringify(pathScopedDiff);

    expect(approved.status).toBe(200);
    expect(await json(approved)).toMatchObject({
      run: { status: "approved", output: null },
    });
    await waitForResult(
      () => services.workflowRunner.readRun(consent.run.id as WorkflowRunId),
      (run) => run?.status === "completed",
      "large-diff built-in review completion",
    );
    expect(calls).toHaveLength(1);
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain("Use path-scoped file reads and searches for large reviews.");
    expect(prompt).toContain("- additions: 1200");
    expect(prompt).toContain("src/generated.ts");
    expect(prompt).not.toContain("export const value1200 = 1200;");
    expect(prompt).not.toContain("@@ -0,0 +1,1200 @@");
    expect(serializedPathScopedDiff).toContain("export const value1200 = 1200;");
  });
});

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix | "diff_file" | "diff_hunk", number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createStorage(): TestStorage {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  return storage;
}

function createApiFixture(
  storage: TestStorage,
  options: Omit<GreenroomApiServiceOptions, "domain" | "defaultAiBackend"> = {},
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
  const admin = services.tokens.create({
    name: "Large diff context test admin",
    scopes: ["admin"],
  });
  const request = createAuthedRequester(app, admin.plaintextToken);

  return { app, services, request, adminToken: admin.plaintextToken };
}

function createAuthedRequester(app: ReturnType<typeof createGreenroomApp>, token: string) {
  return (path: string, init: RequestInit = {}) => app.request(path, withAuth(token, init));
}

function createAppFetch(app: ReturnType<typeof createGreenroomApp>) {
  return (input: string, init?: RequestInit) => {
    const url = new URL(input);
    return app.request(`${url.pathname}${url.search}`, init);
  };
}

function withAuth(token: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);

  return { ...init, headers };
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

async function createProfile(
  request: ReturnType<typeof createAuthedRequester>,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await request("/api/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await json(response)) as { profile: { id: string } };

  expect(response.status).toBe(201);
  return payload.profile.id;
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

function completedHarnessResponse(request: HarnessRunRequest, output: unknown): HarnessRunResponse {
  return {
    workflow: request.workflow,
    runId: request.runId,
    status: "completed",
    output,
    execution: {
      command: "mock-harness",
      exitCode: 0,
      durationMs: 1,
      stderrTail: "",
      timeoutMs: null,
      timedOut: false,
      repositoryChanged: false,
      repositoryFingerprintBefore: null,
      repositoryFingerprintAfter: null,
      outputCapture: request.outputCapture,
    },
  };
}
