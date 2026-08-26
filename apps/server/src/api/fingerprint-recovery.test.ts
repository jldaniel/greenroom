import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type {
  ProfileConsentMode,
  ReviewPr,
  RevisionSnapshot,
  WorkflowRun,
} from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices, createWorkflowRunForReview } from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";
const fingerprintFailureMessage =
  "Harness modified repository state; repositoryChanged=true; output discarded";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function createWorktreeRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/recovery", { create: true });
  repository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await repository.stage();
  await repository.commit("Add feature implementation");

  return repository;
}

async function createFixture() {
  const storage = createTestStorage({
    clock: () => fixedNow,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  const repository = await createWorktreeRepository();
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
    // Replace the real built-in review definition with a no-op so recovery
    // runs approved during the test never reach a harness bridge.
    workflowDefinitions: [
      {
        kind: "builtin_review",
        version: "test-noop",
        steps: [
          {
            id: "noop",
            phase: "launching_harness",
            summary: "No-op harness step for recovery tests.",
            run: () => undefined,
          },
        ],
      },
    ],
  });
  const app = createGreenroomApp({ services });
  const admin = services.tokens.create({ name: "Recovery admin", scopes: ["admin"] });
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${admin.plaintextToken}`);
    return app.request(path, { ...init, headers });
  };

  await request("/api/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: repository.directory }),
  });
  const created = await request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryId: "repo_1", title: "Worktree recovery review" }),
  });
  expect(created.status).toBe(201);
  const { review, revision } = (await created.json()) as {
    review: ReviewPr;
    revision: RevisionSnapshot;
  };

  return { app, services, request, repository, review, revision };
}

function createProfile(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  name: string,
  consentMode: ProfileConsentMode,
) {
  return fixture.services.profiles.create({
    name,
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode },
  });
}

function createFailedRun(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  profileId: ReturnType<typeof createProfile>["id"],
  errorMessage: string = fingerprintFailureMessage,
): WorkflowRun {
  const run = createWorkflowRunForReview(fixture.services, {
    reviewDisplayId: fixture.review.displayId,
    workflowKind: "builtin_review",
    profileId,
  });
  fixture.services.workflows.updateStatus(run.id, { status: "queued" });
  fixture.services.workflows.updateStatus(run.id, { status: "running" });
  fixture.services.workflows.updateStatus(run.id, { status: "failed", errorMessage });
  fixture.services.workflows.recordEvent({
    runId: run.id,
    eventType: "failure",
    summary: errorMessage,
    severity: "error",
  });

  return fixture.services.workflowRunner.readRun(run.id) ?? run;
}

const settledStatuses = new Set(["completed", "failed", "cancelled", "awaiting_user"]);

async function waitForRunSettled(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  runId: WorkflowRun["id"],
): Promise<WorkflowRun> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = fixture.services.workflowRunner.readRun(runId);

    if (run !== null && settledStatuses.has(run.status)) {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Workflow run ${runId} did not settle`);
}

interface RecoveryPayload {
  run: WorkflowRun;
  started: boolean;
  consentMode: ProfileConsentMode;
  recoveredFromRunId: string;
  review: ReviewPr;
  revision: RevisionSnapshot;
  reusedRevision: boolean;
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

describe("fingerprint-change recovery", () => {
  it("refreshes the review and starts a consented run against the new revision (one_click)", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "One-click reviewer", "one_click");
    const failed = createFailedRun(fixture, profile.id);
    fixture.repository.writeFile(
      "src/index.ts",
      "export function answer() {\n  const value = 42;\n  return value;\n}\n",
    );

    const response = await fixture.request(`/api/workflow-runs/${failed.id}/recover-fingerprint`, {
      method: "POST",
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as RecoveryPayload;
    expect(payload.started).toBe(true);
    expect(payload.consentMode).toBe("one_click");
    expect(payload.recoveredFromRunId).toBe(failed.id);
    expect(payload.reusedRevision).toBe(false);
    expect(payload.revision.id).not.toBe(failed.revisionId);
    expect(payload.review.currentRevisionId).toBe(payload.revision.id);
    // The new consent scope references the NEW revision, never the old scope.
    expect(payload.run.id).not.toBe(failed.id);
    expect(payload.run.revisionId).toBe(payload.revision.id);
    expect(payload.run.consentSummary.revisionId).toBe(payload.revision.id);
    expect(payload.run.status).toBe("queued");
    expect(payload.run.approvedScope).toMatchObject({ revisionId: payload.revision.id });
    expect(payload.run.metadata).toMatchObject({
      recoveredFromRunId: failed.id,
      recoveryReason: "fingerprint_changed",
      consentMode: "one_click",
    });

    const settled = await waitForRunSettled(fixture, payload.run.id);
    expect(settled.status).toBe("completed");
    expect(settled.approvedScope).toMatchObject({ revisionId: payload.revision.id });
  });

  it("starts trusted-profile recovery immediately and records trusted consent", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "Trusted reviewer", "trusted");
    const failed = createFailedRun(fixture, profile.id);
    fixture.repository.writeFile("src/index.ts", "export const answer = 43;\n");

    const response = await fixture.request(`/api/workflow-runs/${failed.id}/recover-fingerprint`, {
      method: "POST",
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as RecoveryPayload;
    expect(payload.started).toBe(true);
    expect(payload.consentMode).toBe("trusted");
    expect(payload.run.status).toBe("queued");
    expect(payload.run.approvedScope).toMatchObject({ revisionId: payload.revision.id });
    expect(payload.run.metadata.consentMode).toBe("trusted");
    await waitForRunSettled(fixture, payload.run.id);
  });

  it("leaves two_step recovery runs pending consent against the new revision", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "Two-step reviewer", "two_step");
    const failed = createFailedRun(fixture, profile.id);
    fixture.repository.writeFile("src/index.ts", "export const answer = 44;\n");

    const response = await fixture.request(`/api/workflow-runs/${failed.id}/recover-fingerprint`, {
      method: "POST",
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as RecoveryPayload;
    expect(payload.started).toBe(false);
    expect(payload.consentMode).toBe("two_step");
    expect(payload.run.status).toBe("pending_consent");
    expect(payload.run.approvedScope).toBeNull();
    expect(payload.run.revisionId).toBe(payload.revision.id);
    expect(payload.run.consentSummary.revisionId).toBe(payload.revision.id);
    expect(payload.revision.id).not.toBe(failed.revisionId);
  });

  it("rejects recovery when the run did not fail from a fingerprint change", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "One-click reviewer", "one_click");
    const failed = createFailedRun(
      fixture,
      profile.id,
      "Harness bridge is unavailable. Configure GREENROOM_HARNESS_BASE_URL.",
    );

    const response = await fixture.request(`/api/workflow-runs/${failed.id}/recover-fingerprint`, {
      method: "POST",
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("bridge_down");
  });

  it("rejects recovery for runs that are not failed and unknown runs", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "One-click reviewer", "one_click");
    const pending = createWorkflowRunForReview(fixture.services, {
      reviewDisplayId: fixture.review.displayId,
      workflowKind: "builtin_review",
      profileId: profile.id,
    });

    const notFailed = await fixture.request(
      `/api/workflow-runs/${pending.id}/recover-fingerprint`,
      { method: "POST" },
    );
    const missing = await fixture.request(
      "/api/workflow-runs/workflow_run_missing/recover-fingerprint",
      { method: "POST" },
    );

    expect(notFailed.status).toBe(409);
    expect(missing.status).toBe(404);
  });

  it("requires the review:write scope", async () => {
    const fixture = await createFixture();
    const profile = createProfile(fixture, "One-click reviewer", "one_click");
    const failed = createFailedRun(fixture, profile.id);
    const readOnly = fixture.services.tokens.create({ name: "Read only", scopes: ["read"] });

    const response = await fixture.app.request(
      `/api/workflow-runs/${failed.id}/recover-fingerprint`,
      { method: "POST", headers: { authorization: `Bearer ${readOnly.plaintextToken}` } },
    );

    expect(response.status).toBe(403);
  });
});

describe("review worktree status", () => {
  it("reports clean and dirty worktrees relative to the latest revision snapshot", async () => {
    const fixture = await createFixture();

    const clean = await fixture.request(`/api/reviews/${fixture.review.displayId}/worktree-status`);
    expect(clean.status).toBe(200);
    expect(await clean.json()).toMatchObject({
      reviewDisplayId: fixture.review.displayId,
      revisionId: fixture.revision.id,
      applicable: true,
      dirty: false,
    });

    fixture.repository.writeFile("src/index.ts", "export const answer = 45;\n");

    const dirty = await fixture.request(`/api/reviews/${fixture.review.displayId}/worktree-status`);
    expect(dirty.status).toBe(200);
    const dirtyPayload = (await dirty.json()) as {
      dirty: boolean;
      snapshotFingerprint: { unstagedDiffHash: string | null };
      currentFingerprint: { unstagedDiffHash: string | null };
    };
    expect(dirtyPayload.dirty).toBe(true);
    expect(dirtyPayload.currentFingerprint.unstagedDiffHash).not.toBe(
      dirtyPayload.snapshotFingerprint.unstagedDiffHash,
    );

    // Refreshing the review snapshots the current worktree, so the check is
    // clean again afterwards.
    const refreshed = await fixture.request(`/api/reviews/${fixture.review.displayId}/refresh`, {
      method: "POST",
    });
    expect(refreshed.status).toBe(201);
    const afterRefresh = await fixture.request(
      `/api/reviews/${fixture.review.displayId}/worktree-status`,
    );
    expect(await afterRefresh.json()).toMatchObject({ applicable: true, dirty: false });
  });

  it("marks committed-range reviews as not applicable", async () => {
    const fixture = await createFixture();
    const created = await fixture.request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        title: "Committed review",
        baseRef: "main",
        headRef: "feature/recovery",
      }),
    });
    expect(created.status).toBe(201);
    const { review } = (await created.json()) as { review: ReviewPr };

    const response = await fixture.request(`/api/reviews/${review.displayId}/worktree-status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reviewDisplayId: review.displayId,
      applicable: false,
      dirty: false,
      snapshotFingerprint: null,
      currentFingerprint: null,
    });
  });

  it("returns 404 for unknown reviews and rejects opaque review ids", async () => {
    const fixture = await createFixture();
    const response = await fixture.request("/api/reviews/GR-999/worktree-status");
    expect(response.status).toBe(404);

    // Opaque review ids are no longer valid path references.
    const opaque = await fixture.request("/api/reviews/review_1/worktree-status");
    expect(opaque.status).toBe(400);
  });
});
