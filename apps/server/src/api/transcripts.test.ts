import { afterEach, describe, expect, it } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import {
  harnessRunRequestSchema,
  harnessRunResponseSchema,
  type HarnessRunRequest,
  type Profile,
  type WorkflowRun,
} from "@greenroom/schemas";

import { createTestStorage, type TestStorage } from "../testing/storage";
import { createWorkflowTranscriptPersistenceService } from "../storage/transcripts";
import { createGreenroomApp } from "./app";
import { harnessProfileForRequest, type HarnessClient } from "./harness-client";
import { createGreenroomApiServices, createWorkflowRunForReview } from "./services";

const fixedNow = "2026-06-25T12:00:00.000Z";
const secretValue = "super-secret-value-12345";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function fakeHarnessClient(): HarnessClient {
  return {
    async run(request) {
      return harnessRunResponseSchema.parse({
        workflow: request.workflow,
        runId: request.runId,
        status: "completed",
        output: { ok: true, note: `token sk-ant-abcdefghijkl1234 and ${secretValue}` },
        execution: {
          command: "claude -p [prompt]",
          exitCode: 0,
          durationMs: 25,
          stderrTail: `warn: leaked ${secretValue}`,
          outputCapture: "structured_stdout",
        },
      });
    },
  };
}

function createFixture(options: { clock?: () => string; harnessClient?: HarnessClient } = {}) {
  const clock = options.clock ?? (() => fixedNow);
  const storage = createTestStorage({
    clock,
    idFactory: deterministicIds(),
    defaultAiBackend: "mock",
  });
  storages.push(storage);
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    env: { GREENROOM_TRANSCRIPT_TEST_API_KEY: secretValue },
    harnessClient: options.harnessClient ?? fakeHarnessClient(),
    domain: {
      clock,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
  });
  const repository = services.repositories.create({
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
  });
  const { review } = services.reviews.createWithInitialRevision({
    review: {
      repositoryId: repository.id,
      title: "Transcript review",
      range: {
        kind: "branch_to_branch",
        baseRef: { kind: "branch", value: "main" },
        headRef: { kind: "branch", value: "feature/transcripts" },
      },
      baseRefDisplay: "main",
      headRefDisplay: "feature/transcripts",
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
    name: "Transcript harness",
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
  });

  return { storage, services, review, profile };
}

function createRun(
  services: ReturnType<typeof createGreenroomApiServices>,
  reviewDisplayId: string,
  profile: Profile,
): WorkflowRun {
  return createWorkflowRunForReview(services, {
    reviewDisplayId,
    workflowKind: "setup_smoke",
    profileId: profile.id,
  });
}

function harnessRequest(run: WorkflowRun, profile: Profile, prompt: string): HarnessRunRequest {
  return harnessRunRequestSchema.parse({
    workflow: "setup_smoke",
    runId: run.id,
    profile: harnessProfileForRequest(profile),
    cwd: "/work/greenroom",
    prompt,
    schema: {},
  });
}

function requireHarnessClient(
  services: ReturnType<typeof createGreenroomApiServices>,
): HarnessClient {
  if (services.harnessClient === null) {
    throw new Error("Test fixture harness client is missing");
  }

  return services.harnessClient;
}

const storages: TestStorage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }
});

describe("workflow transcript persistence", () => {
  it("persists a redacted transcript for each harness run and serves it through the API", async () => {
    const { services, review, profile } = createFixture();
    const run = createRun(services, review.displayId, profile);

    await requireHarnessClient(services).run(
      harnessRequest(run, profile, "Review the approved diff scope."),
    );

    const transcripts = services.transcripts.listByRun(run.id);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toMatchObject({
      runId: run.id,
      profileId: profile.id,
      workflowKind: "setup_smoke",
      attempt: 0,
      status: "completed",
      exitCode: 0,
      prompt: "Review the approved diff scope.",
      redacted: true,
      truncated: false,
      createdAt: fixedNow,
    });
    expect(transcripts[0]?.output).toContain('"ok":true');
    expect(transcripts[0]?.stderr).toContain("warn: leaked");
    expect(transcripts[0]?.totalBytes).toBeGreaterThan(0);

    const app = createGreenroomApp({ services });
    const admin = services.tokens.create({ name: "Transcript admin", scopes: ["admin"] });
    const headers = { authorization: `Bearer ${admin.plaintextToken}` };
    const listResponse = await app.request(`/api/workflow-runs/${run.id}/transcripts`, {
      headers,
    });
    const listPayload = (await listResponse.json()) as {
      transcripts: Array<{ id: string; prompt: string }>;
    };
    const detailResponse = await app.request(`/api/workflow-runs/${run.id}`, { headers });
    const detailPayload = (await detailResponse.json()) as {
      transcripts: Array<Record<string, unknown>>;
    };

    expect(listResponse.status).toBe(200);
    expect(listPayload.transcripts).toHaveLength(1);
    expect(listPayload.transcripts[0]?.prompt).toBe("Review the approved diff scope.");
    expect(detailResponse.status).toBe(200);
    expect(detailPayload.transcripts).toHaveLength(1);
    expect(detailPayload.transcripts[0]).toMatchObject({
      redacted: true,
      createdAt: fixedNow,
    });
    expect(detailPayload.transcripts[0]).not.toHaveProperty("prompt");
    expect(detailPayload.transcripts[0]).toHaveProperty("promptBytes");
  });

  it("applies redaction before any transcript content reaches the database", async () => {
    const { storage, services, review, profile } = createFixture();
    const run = createRun(services, review.displayId, profile);

    await requireHarnessClient(services).run(
      harnessRequest(
        run,
        profile,
        `Use api_key=${secretValue} plus sk-ant-abcdefghijkl1234 for auth.`,
      ),
    );

    const rows = storage.database.sqlite
      .query<
        { prompt: string; output: string | null; stderr: string },
        []
      >("SELECT prompt, output, stderr FROM workflow_run_transcripts")
      .all();

    expect(rows).toHaveLength(1);
    const combined = `${rows[0]?.prompt}\n${rows[0]?.output}\n${rows[0]?.stderr}`;
    expect(combined).not.toContain(secretValue);
    expect(combined).not.toContain("sk-ant-abcdefghijkl1234");
    expect(combined).toContain("[redacted]");
  });

  it("skips persistence for profiles that opt out", async () => {
    const { services, review, profile } = createFixture();
    const optedOut = services.profiles.create({
      name: "Opted out harness",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code" } },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false },
    });
    const persistedRun = createRun(services, review.displayId, profile);
    const optedOutRun = createRun(services, review.displayId, optedOut);

    await requireHarnessClient(services).run(
      harnessRequest(persistedRun, profile, "Persisted run prompt."),
    );
    await requireHarnessClient(services).run(
      harnessRequest(optedOutRun, optedOut, "Opted-out run prompt."),
    );

    expect(services.transcripts.listByRun(persistedRun.id)).toHaveLength(1);
    expect(services.transcripts.listByRun(optedOutRun.id)).toHaveLength(0);
  });

  it("persists incremental harness events with transcript redaction and purge", async () => {
    const streamingClient: HarnessClient = {
      async run(request, options) {
        options?.onEvent?.({
          sequence: 1,
          timestamp: fixedNow,
          kind: "assistant_text",
          summary: `Streaming with ${secretValue}`,
          text: `Partial output used ${secretValue}`,
          name: null,
          data: { secret: secretValue },
        });

        return harnessRunResponseSchema.parse({
          workflow: request.workflow,
          runId: request.runId,
          status: "completed",
          output: { ok: true },
          execution: {
            command: "claude -p [prompt]",
            exitCode: 0,
            durationMs: 25,
            stderrTail: "",
            outputCapture: "structured_stdout",
          },
        });
      },
    };
    const { services, review, profile } = createFixture({ harnessClient: streamingClient });
    const run = createRun(services, review.displayId, profile);

    await requireHarnessClient(services).run(harnessRequest(run, profile, "Streaming prompt."));

    const events = services.transcripts.listEventsByRun(run.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toMatchObject({
      kind: "assistant_text",
      summary: expect.stringContaining("[redacted]"),
      text: expect.stringContaining("[redacted]"),
    });
    expect(JSON.stringify(events)).not.toContain(secretValue);

    const app = createGreenroomApp({ services });
    const admin = services.tokens.create({ name: "Transcript admin", scopes: ["admin"] });
    const headers = { authorization: `Bearer ${admin.plaintextToken}` };
    const response = await app.request(`/api/workflow-runs/${run.id}/events?since=0`, {
      headers,
    });
    const payload = (await response.json()) as {
      events: Array<{ sequence: number; kind: string; text: string | null }>;
      nextCursor: number;
      terminal: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      events: [expect.objectContaining({ sequence: 1, kind: "assistant_text" })],
      nextCursor: 1,
    });
    expect(typeof payload.terminal).toBe("boolean");

    const purge = await app.request("/api/workflow-transcripts/purge", {
      method: "POST",
      headers,
    });
    const purgePayload = (await purge.json()) as { deletedCount: number };

    expect(purgePayload.deletedCount).toBe(2);
    expect(services.transcripts.listByRun(run.id)).toHaveLength(0);
    expect(services.transcripts.listEventsByRun(run.id)).toHaveLength(0);
  });

  it("purges all transcripts through the admin endpoint", async () => {
    const { services, review, profile } = createFixture();
    const first = createRun(services, review.displayId, profile);
    const second = createRun(services, review.displayId, profile);

    await requireHarnessClient(services).run(harnessRequest(first, profile, "First run."));
    await requireHarnessClient(services).run(harnessRequest(second, profile, "Second run."));
    expect(services.transcripts.totalBytes()).toBeGreaterThan(0);

    const app = createGreenroomApp({ services });
    const admin = services.tokens.create({ name: "Purge admin", scopes: ["admin"] });
    const response = await app.request("/api/workflow-transcripts/purge", {
      method: "POST",
      headers: { authorization: `Bearer ${admin.plaintextToken}` },
    });
    const payload = (await response.json()) as { deletedCount: number };

    expect(response.status).toBe(200);
    expect(payload.deletedCount).toBe(2);
    expect(services.transcripts.listByRun(first.id)).toHaveLength(0);
    expect(services.transcripts.listByRun(second.id)).toHaveLength(0);
    expect(services.transcripts.totalBytes()).toBe(0);
  });

  it("evicts the oldest transcripts first when the size cap is exceeded", () => {
    let now = Date.parse(fixedNow);
    const clock = () => new Date(now).toISOString();
    const { storage, services, review, profile } = createFixture({ clock });
    const run = createRun(services, review.displayId, profile);
    const transcriptStore = createWorkflowTranscriptPersistenceService(storage.database.db, {
      clock,
      config: { enabled: true, maxAgeDays: 30, maxTotalBytes: 250 },
    });
    const body = "x".repeat(100);

    const first = transcriptStore.save(saveInput(run, profile, `first-${body}`));
    now += 1000;
    const second = transcriptStore.save(saveInput(run, profile, `second-${body}`));
    now += 1000;
    const third = transcriptStore.save(saveInput(run, profile, `third-${body}`));

    const remaining = transcriptStore.listByRun(run.id).map((transcript) => transcript.id);
    expect(first).not.toBeNull();
    expect(remaining).not.toContain(first?.id);
    expect(remaining).toContain(second?.id);
    expect(remaining).toContain(third?.id);
    expect(transcriptStore.totalBytes()).toBeLessThanOrEqual(250);
  });

  it("evicts transcripts older than the age cap", () => {
    let now = Date.parse(fixedNow);
    const clock = () => new Date(now).toISOString();
    const { storage, services, review, profile } = createFixture({ clock });
    const run = createRun(services, review.displayId, profile);
    const transcriptStore = createWorkflowTranscriptPersistenceService(storage.database.db, {
      clock,
      config: { enabled: true, maxAgeDays: 30, maxTotalBytes: 1024 * 1024 },
    });

    const old = transcriptStore.save(saveInput(run, profile, "old transcript"));
    now += 31 * 24 * 60 * 60 * 1000;
    const fresh = transcriptStore.save(saveInput(run, profile, "fresh transcript"));

    const remaining = transcriptStore.listByRun(run.id).map((transcript) => transcript.id);
    expect(old).not.toBeNull();
    expect(remaining).not.toContain(old?.id);
    expect(remaining).toContain(fresh?.id);
  });

  it("persists nothing when transcripts are disabled", () => {
    const { storage, services, review, profile } = createFixture();
    const run = createRun(services, review.displayId, profile);
    const transcriptStore = createWorkflowTranscriptPersistenceService(storage.database.db, {
      config: { enabled: false, maxAgeDays: 30, maxTotalBytes: 1024 * 1024 },
    });

    const saved = transcriptStore.save(saveInput(run, profile, "disabled prompt"));

    expect(saved).toBeNull();
    expect(transcriptStore.listByRun(run.id)).toHaveLength(0);
  });
});

function saveInput(run: WorkflowRun, profile: Profile, prompt: string) {
  return {
    runId: run.id,
    profileId: profile.id,
    workflowKind: run.workflowKind,
    status: "completed" as const,
    exitCode: 0,
    prompt,
    output: null,
    stderr: "",
  };
}
