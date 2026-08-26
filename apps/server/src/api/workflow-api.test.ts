import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices } from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createFixture() {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
  });
  const app = createGreenroomApp({ services });
  const admin = services.tokens.create({ name: "Workflow API admin", scopes: ["admin"] });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${admin.plaintextToken}`);
    return app.request(path, { ...init, headers });
  };
  const repository = services.repositories.create({
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
  });
  const { review } = services.reviews.createWithInitialRevision({
    review: {
      repositoryId: repository.id,
      title: "Workflow API review",
      range: {
        kind: "branch_to_branch",
        baseRef: { kind: "branch", value: "main" },
        headRef: { kind: "branch", value: "feature/api" },
      },
      baseRefDisplay: "main",
      headRefDisplay: "feature/api",
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
        path: "src/api.ts",
        oldPath: null,
        status: "modified",
        isBinary: false,
        additions: 1,
        deletions: 0,
        oldMode: null,
        newMode: null,
        renameMetadata: null,
      },
    ],
  });
  const profile = services.profiles.create({
    name: "Workflow API harness",
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false },
  });

  return { services, request, review, profile };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function waitForCompletedRun(
  request: ReturnType<typeof createFixture>["request"],
  runId: string,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2_000) {
    const response = await request(`/api/workflow-runs/${runId}`);
    const payload = (await json(response)) as { run: { status: string } };

    if (payload.run.status === "completed") {
      return payload.run;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for workflow API run completion");
}

const storages: TestStorage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }
});

describe("workflow HTTP API", () => {
  it("creates, lists, reads, approves, and exposes workflow events", async () => {
    const { services, request, review, profile } = createFixture();
    const created = await request(`/api/reviews/${review.displayId}/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKind: "setup_smoke",
        profileId: profile.id,
      }),
    });
    const createdPayload = (await json(created)) as {
      run: { id: string; status: string; consentSummary: { changedFiles: { fileCount: number } } };
    };
    const listed = await request(`/api/reviews/${review.displayId}/workflow-runs`);
    const listedPayload = (await json(listed)) as { runs: Array<{ id: string }> };
    const read = await request(`/api/workflow-runs/${createdPayload.run.id}`);
    const readPayload = (await json(read)) as { run: { id: string; status: string } };
    const approved = await request(`/api/workflow-runs/${createdPayload.run.id}/approve`, {
      method: "POST",
    });
    const approvedPayload = (await json(approved)) as { run: { status: string } };
    const completed = (await waitForCompletedRun(request, createdPayload.run.id)) as {
      status: string;
      finalOutput: { kind: string };
    };
    const events = await request(`/api/workflow-runs/${createdPayload.run.id}/events`);
    const eventsPayload = (await json(events)) as {
      events: Array<{ sequenceNumber: number; eventType: string }>;
    };

    expect(created.status).toBe(201);
    expect(createdPayload.run).toMatchObject({
      status: "pending_consent",
      consentSummary: { changedFiles: { fileCount: 1 } },
    });
    expect(listedPayload.runs).toMatchObject([{ id: createdPayload.run.id }]);
    expect(readPayload.run).toMatchObject({
      id: createdPayload.run.id,
      status: "pending_consent",
    });
    expect(approvedPayload.run).toMatchObject({ status: "queued" });
    expect(completed).toMatchObject({
      status: "completed",
      finalOutput: { kind: "setup_smoke_report" },
    });
    expect(eventsPayload.events.map((event) => event.sequenceNumber)).toEqual(
      eventsPayload.events.map((_event, index) => index + 1),
    );
    expect(eventsPayload.events.map((event) => event.eventType)).toContain("persistence");
    expect(services.workflowRunner.listRunsByReview(review.id)).toHaveLength(1);
  });

  it("records repository access consent and keeps worktree revisions MCP-only", async () => {
    const { request, review, services } = createFixture();
    const snapshotProfile = services.profiles.create({
      name: "Snapshot reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: {
        harness: {
          kind: "claude-code",
          repositoryAccessMode: "snapshot_readonly",
          workspaceStrategy: "git_archive",
        },
      },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false },
    });
    const committed = await request(`/api/reviews/${review.displayId}/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKind: "builtin_review",
        profileId: snapshotProfile.id,
      }),
    });
    const committedPayload = (await json(committed)) as {
      run: {
        consentSummary: {
          repositoryAccess: {
            mode: string;
            readScopeLabel: string;
            headSha: string | null;
            workspaceStrategy: string | null;
          };
        };
        metadata: Record<string, unknown>;
      };
    };

    expect(committedPayload.run.consentSummary.repositoryAccess).toMatchObject({
      mode: "snapshot_readonly",
      headSha: "b".repeat(40),
      workspaceStrategy: "git_archive",
    });
    expect(committedPayload.run.consentSummary.repositoryAccess.readScopeLabel).toContain(
      "Tracked repository files",
    );
    expect(JSON.stringify(committedPayload.run.consentSummary)).not.toContain("/work/greenroom");
    expect(committedPayload.run.metadata).toMatchObject({
      repositoryAccessMode: "snapshot_readonly",
      repositoryAccessWorkspaceStrategy: "git_archive",
    });

    services.reviews.createRevision({
      reviewId: review.id,
      revision: {
        baseSha: "c".repeat(40),
        headSha: null,
        worktreeFingerprint: {
          headSha: "b".repeat(40),
          stagedDiffHash: null,
          unstagedDiffHash: "dirty",
        },
        diffSummary: {
          fileCount: 1,
          additions: 2,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
      },
      diffFiles: [
        {
          path: "src/worktree.ts",
          oldPath: null,
          status: "modified",
          isBinary: false,
          additions: 2,
          deletions: 0,
          oldMode: null,
          newMode: null,
          renameMetadata: null,
        },
      ],
    });

    const worktree = await request(`/api/reviews/${review.displayId}/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKind: "builtin_review",
        profileId: snapshotProfile.id,
      }),
    });
    const worktreePayload = (await json(worktree)) as {
      run: { consentSummary: { repositoryAccess: { mode: string } } };
    };

    expect(worktreePayload.run.consentSummary.repositoryAccess).toMatchObject({
      mode: "mcp_only",
    });
  });

  it("lists active workflow runs across reviews for the header indicator", async () => {
    const { services, request, review, profile } = createFixture();
    const created = await request(`/api/reviews/${review.displayId}/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowKind: "setup_smoke",
        profileId: profile.id,
      }),
    });
    const createdPayload = (await json(created)) as { run: { id: string } };

    // Pending-consent runs are not yet occupying the queue, so the
    // cross-review active list stays empty.
    const whilePending = (await json(await request("/api/workflow-runs"))) as {
      runs: unknown[];
    };
    expect(whilePending.runs).toEqual([]);

    // Queue the run without letting the (auto-resume-disabled) runner pick
    // it up so the active list can be asserted deterministically.
    services.workflows.updateStatus(createdPayload.run.id as never, { status: "queued" });

    const whileQueued = (await json(await request("/api/workflow-runs"))) as {
      runs: Array<{ id: string; reviewDisplayId: string; status: string }>;
    };
    expect(whileQueued.runs).toMatchObject([
      { id: createdPayload.run.id, reviewDisplayId: review.displayId, status: "queued" },
    ]);

    // "active" is the only supported filter.
    const unsupportedFilter = await request("/api/workflow-runs?status=completed");
    expect(unsupportedFilter.status).toBe(400);
  });
});
