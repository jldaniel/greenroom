import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import type { WorkflowRun } from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import type { WorkflowRunDiagnostics } from "../workflows/diagnostics";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices, createWorkflowRunForReview } from "./services";

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
  const admin = services.tokens.create({ name: "Diagnostics admin", scopes: ["admin"] });
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
      title: "Diagnostics review",
      range: {
        kind: "branch_to_branch",
        baseRef: { kind: "branch", value: "main" },
        headRef: { kind: "branch", value: "feature/diagnostics" },
      },
      baseRefDisplay: "main",
      headRefDisplay: "feature/diagnostics",
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
    name: "Diagnostics harness",
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
  });

  return { app, services, request, review, profile };
}

function createRun(fixture: ReturnType<typeof createFixture>): WorkflowRun {
  return createWorkflowRunForReview(fixture.services, {
    reviewDisplayId: fixture.review.displayId,
    workflowKind: "builtin_review",
    profileId: fixture.profile.id,
  });
}

function failRun(
  fixture: ReturnType<typeof createFixture>,
  run: WorkflowRun,
  errorMessage: string,
  metadata: Record<string, unknown> = {},
): void {
  fixture.services.workflows.updateStatus(run.id, { status: "queued" });
  fixture.services.workflows.updateStatus(run.id, { status: "running" });
  fixture.services.workflows.updateStatus(run.id, {
    status: "failed",
    errorMessage,
    metadata,
  });
  fixture.services.workflows.recordEvent({
    runId: run.id,
    eventType: "failure",
    summary: errorMessage,
    severity: "error",
    metadata,
  });
}

async function readDiagnostics(
  fixture: ReturnType<typeof createFixture>,
  runId: string,
): Promise<WorkflowRunDiagnostics> {
  const response = await fixture.request(`/api/workflow-runs/${runId}/diagnostics`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { diagnostics: WorkflowRunDiagnostics };
  return payload.diagnostics;
}

const storages: TestStorage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }
});

describe("workflow run diagnostics API", () => {
  it("returns derived diagnostics with transcript references for a failed run", async () => {
    const fixture = createFixture();
    const run = createRun(fixture);
    failRun(
      fixture,
      run,
      "Harness command timed out after 180000ms; timedOut=true; repositoryChanged=false",
      { timeoutMs: 180000, currentStepId: "builtin-review.launch-harness" },
    );
    fixture.services.transcripts.save({
      runId: run.id,
      profileId: fixture.profile.id,
      workflowKind: run.workflowKind,
      attempt: 0,
      status: "failed",
      exitCode: null,
      prompt: "Review the approved diff scope.",
      output: null,
      stderr: "error: harness killed after timeout",
    });

    const diagnostics = await readDiagnostics(fixture, run.id);

    expect(diagnostics).toMatchObject({
      runId: run.id,
      status: "failed",
      failureCategory: "timeout",
      timeoutMs: 180000,
      stderrTail: "error: harness killed after timeout",
      failingStep: { stepId: "builtin-review.launch-harness" },
      fingerprint: {
        changed: false,
        consentedRevisionId: run.revisionId,
        currentRevisionId: run.revisionId,
      },
      transcriptsUrl: `/api/workflow-runs/${run.id}/transcripts`,
    });
    expect(diagnostics.transcripts).toHaveLength(1);
    expect(diagnostics.transcripts[0]).not.toHaveProperty("stderr");
    expect(diagnostics.transcripts[0]).not.toHaveProperty("prompt");
  });

  it("still serves diagnostics when no transcript was persisted", async () => {
    const fixture = createFixture();
    const run = createRun(fixture);
    failRun(fixture, run, "Harness bridge is unavailable. Configure GREENROOM_HARNESS_BASE_URL.");

    const diagnostics = await readDiagnostics(fixture, run.id);

    expect(diagnostics).toMatchObject({
      failureCategory: "bridge_down",
      exitCode: null,
      stderrTail: null,
      transcripts: [],
    });
  });

  it("returns empty failure fields for a successful run", async () => {
    const fixture = createFixture();
    const run = createRun(fixture);
    fixture.services.workflows.updateStatus(run.id, { status: "queued" });
    fixture.services.workflows.updateStatus(run.id, { status: "running" });
    fixture.services.workflows.updateStatus(run.id, { status: "completed" });

    const diagnostics = await readDiagnostics(fixture, run.id);

    expect(diagnostics).toMatchObject({
      status: "completed",
      failureCategory: null,
      summary: "Workflow run completed successfully.",
      failingStep: null,
      validationIssues: [],
      repairAttempts: [],
    });
  });

  it("returns 404 for unknown workflow runs", async () => {
    const fixture = createFixture();
    const response = await fixture.request("/api/workflow-runs/workflow_run_missing/diagnostics");

    expect(response.status).toBe(404);
  });

  it("requires bearer auth and the read scope", async () => {
    const fixture = createFixture();
    const run = createRun(fixture);
    failRun(fixture, run, "Harness bridge is unavailable.");

    const unauthenticated = await fixture.app.request(`/api/workflow-runs/${run.id}/diagnostics`);
    const writeOnly = fixture.services.tokens.create({
      name: "Write-only token",
      scopes: ["comment:write"],
    });
    const forbidden = await fixture.app.request(`/api/workflow-runs/${run.id}/diagnostics`, {
      headers: { authorization: `Bearer ${writeOnly.plaintextToken}` },
    });

    expect(unauthenticated.status).toBe(401);
    expect(forbidden.status).toBe(403);
  });
});
