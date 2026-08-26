import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { IdFactory, IdPrefix } from "@greenroom/core";
import {
  workflowRunRepairProgressFromMetadata,
  type Profile,
  type WorkflowRun,
} from "@greenroom/schemas";

import { createGreenroomApiServices, createWorkflowRunForReview } from "../api/services";
import type { GreenroomWorkflowRuntimeConfig } from "../config";
import { createTestStorage, type TestStorage } from "../testing/storage";
import { mcpGrantExpiryGraceMs } from "./orchestrator";
import type { WorkflowDefinition } from "./types";
import { createDefaultWorkflowRepairPolicy } from "./validators";

const fixedNow = "2026-06-25T12:00:00.000Z";

function deterministicIds(): IdFactory {
  const counts = new Map<IdPrefix, number>();

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

function createReviewFixture(storage: TestStorage) {
  const services = createGreenroomApiServices(storage.database, {
    defaultAiBackend: "mock",
    domain: {
      clock: () => fixedNow,
      idFactory: deterministicIds(),
    },
    autoResumeQueuedWorkflowRuns: false,
  });
  const repository = services.repositories.create({
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
  });
  const { review, revision } = services.reviews.createWithInitialRevision({
    review: {
      repositoryId: repository.id,
      title: "Workflow review",
      range: {
        kind: "branch_to_branch",
        baseRef: { kind: "branch", value: "main" },
        headRef: { kind: "branch", value: "feature/workflow" },
      },
      baseRefDisplay: "main",
      headRefDisplay: "feature/workflow",
    },
    revision: {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
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
        path: "src/index.ts",
        oldPath: null,
        status: "modified",
        isBinary: false,
        additions: 2,
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
            sortOrder: 1,
            lines: [
              {
                type: "context",
                oldLineNumber: 1,
                newLineNumber: 1,
                content: "export const value = 1;",
              },
              {
                type: "addition",
                oldLineNumber: null,
                newLineNumber: 2,
                content: "export const next = 2;",
              },
            ],
          },
        ],
      },
    ],
  });
  const profile = services.profiles.create({
    name: "Harness workflow",
    workflowType: "builtin_review",
    provider: "harness",
    model: "claude-code",
    modelSettings: { harness: { kind: "claude-code" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false },
  });

  return { services, review, revision, profile };
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

function validSetupSmokeDraft() {
  return {
    kind: "setup_smoke_report" as const,
    status: "passed" as const,
    checks: [
      {
        name: "test",
        status: "passed" as const,
        summary: "The test workflow produced a valid draft.",
      },
    ],
  };
}

function testWorkflowRuntimeConfig(
  overrides: Partial<{
    logs: GreenroomWorkflowRuntimeConfig["logs"];
    tracing: GreenroomWorkflowRuntimeConfig["tracing"];
    operational: GreenroomWorkflowRuntimeConfig["operational"];
  }> = {},
): GreenroomWorkflowRuntimeConfig {
  return {
    logs: overrides.logs ?? { enabled: false, path: null },
    tracing: overrides.tracing ?? {
      enabled: false,
      mode: "disabled",
      otlpEndpoint: null,
      langchainEnabled: false,
      serviceName: "greenroom-test",
    },
    operational: overrides.operational ?? {
      maxConcurrentRuns: 1,
      idleTimeoutMs: 5 * 60_000,
      absoluteTimeoutMs: 5 * 60_000,
      maxMcpResourceReadEvents: null,
      maxRepairAttempts: 2,
    },
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-workflow-test-"));
  tempDirs.push(dir);
  return dir;
}

async function waitForRun(
  services: ReturnType<typeof createGreenroomApiServices>,
  runId: WorkflowRun["id"],
  predicate: (run: WorkflowRun) => boolean,
): Promise<WorkflowRun> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2_000) {
    const run = services.workflowRunner.readRun(runId);

    if (run !== null && predicate(run)) {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const latest = services.workflowRunner.readRun(runId);
  throw new Error(
    `Timed out waiting for workflow run; latest status was ${latest?.status}; error=${latest?.errorMessage ?? "none"}`,
  );
}

async function advanceFakeTimersByTime(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

const storages: TestStorage[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const storage of storages.splice(0)) {
    storage.cleanup();
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("workflow orchestrator", () => {
  it("keeps tracing disabled by default", () => {
    const storage = createStorage();
    const { services, review, profile } = createReviewFixture(storage);
    const run = createRun(services, review.displayId, profile);
    const tracingProfile = services.profiles.create({
      name: "Tracing profile",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      modelSettings: { harness: { kind: "claude-code" } },
      allowedTools: [],
      contextPreferences: { tracingEnabled: true },
      privacy: { persistTranscript: false },
    });
    const tracedRun = createRun(services, review.displayId, tracingProfile);

    expect(run.consentSummary.tracingStatus).toBe("disabled");
    expect(tracedRun.consentSummary.tracingStatus).toBe("redacted");
    expect(services.workflowRuntimeConfig.tracing).toMatchObject({
      enabled: false,
      mode: "disabled",
      otlpEndpoint: null,
    });
  });

  it("creates, approves, executes, validates, completes, orders events, and revokes run grants", async () => {
    const storage = createStorage();
    const observedPlaintextTokens: string[] = [];
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.valid.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.submit-draft",
          phase: "drafting",
          eventType: "harness_launch",
          summary: "Submit a valid setup smoke draft.",
          run(context) {
            if (context.mcpGrant !== null) {
              observedPlaintextTokens.push(context.mcpGrant.plaintextToken);
            }

            return { draftOutput: validSetupSmokeDraft() };
          },
        },
      ],
    };
    const { services, review, profile } = createReviewFixture(storage);
    const workflowServices = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(workflowServices, review.displayId, profile);
    const approved = workflowServices.workflowRunner.approveRun(run.id);
    const completed = await waitForRun(
      workflowServices,
      run.id,
      (candidate) => candidate.status === "completed",
    );
    const events = workflowServices.workflowRunner.listEvents(run.id);
    const grantToken = observedPlaintextTokens[0];

    expect(run).toMatchObject({ status: "pending_consent", phase: "pending_consent" });
    expect(approved).toMatchObject({
      status: "queued",
      phase: "queued",
      approvedScope: {
        label: "All changed files",
        filePaths: ["src/index.ts"],
        metadata: {
          repositoryAccessMode: "mcp_only",
          repositoryAccessReadScopeLabel: "Greenroom MCP context only",
        },
      },
    });
    expect(completed).toMatchObject({
      status: "completed",
      phase: "completed",
      draftOutput: { kind: "setup_smoke_report" },
      finalOutput: { kind: "setup_smoke_report" },
    });
    expect(events.map((event) => event.sequenceNumber)).toEqual(
      events.map((_event, index) => index + 1),
    );
    expect(events.map((event) => event.eventType)).toContain("draft_submission");
    expect(events.map((event) => event.eventType)).toContain("validation");
    expect(events.map((event) => event.eventType)).toContain("persistence");
    if (grantToken === undefined) {
      throw new Error("Expected workflow step to receive a run-scoped grant");
    }
    expect(grantToken).toMatch(/^grt_/u);
    expect(JSON.stringify(completed)).not.toContain(grantToken);
    expect(workflowServices.tokens.authenticate(grantToken)).toBeNull();
    expect(
      workflowServices.tokens.list().find((token) => token.id === completed.metadata.mcpGrantId),
    ).toMatchObject({ revokedAt: fixedNow });
    expect(
      workflowServices.agentEvents.listByReview(review.id).map((event) => event.summary),
    ).toContain("Workflow run completed.");
    expect(services.workflowRunner.readRun(run.id)).toMatchObject({ status: "completed" });
  });

  it("cancels a running workflow and revokes its grant", async () => {
    const storage = createStorage();
    const observedPlaintextTokens: string[] = [];
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.cancel.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.wait",
          phase: "drafting",
          summary: "Wait until cancelled.",
          run(context) {
            if (context.mcpGrant !== null) {
              observedPlaintextTokens.push(context.mcpGrant.plaintextToken);
            }

            return new Promise((resolve, reject) => {
              context.signal.addEventListener("abort", () => reject(context.signal.reason), {
                once: true,
              });
              setTimeout(resolve, 1_000);
            });
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await waitForRun(services, run.id, (candidate) => candidate.status === "running");
    const cancelled = services.workflowRunner.cancelRun(run.id, "Stop this workflow.");

    expect(cancelled).toMatchObject({
      status: "cancelled",
      phase: "cancelled",
      errorMessage: "Stop this workflow.",
    });
    expect(services.tokens.authenticate(observedPlaintextTokens[0]!)).toBeNull();
    expect(services.workflowRunner.listEvents(run.id).map((event) => event.eventType)).toContain(
      "lifecycle",
    );
  });

  it("fails and revokes grants when execution times out", async () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.timeout.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.timeout",
          phase: "drafting",
          summary: "Run longer than the timeout.",
          run() {
            // Model a non-cooperative dependency that ignores cancellation.
            // Its late result must not revive a run that already timed out.
            return new Promise((resolve) => {
              setTimeout(() => resolve({ draftOutput: validSetupSmokeDraft() }), 2_000);
            });
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await advanceFakeTimersByTime(0);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    await advanceFakeTimersByTime(999);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    await advanceFakeTimersByTime(1);
    const failed = services.workflowRunner.readRun(run.id)!;

    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toContain("absolute timeout");
    expect(failed.errorMessage).toContain("during step test.timeout");
    expect(services.workflowRunner.listEvents(run.id)).toContainEqual(
      expect.objectContaining({ eventType: "failure", severity: "error" }),
    );
    expect(
      services.tokens.list().find((token) => token.id === failed.metadata.mcpGrantId),
    ).toMatchObject({ revokedAt: fixedNow });

    await advanceFakeTimersByTime(1_000);
    expect(services.workflowRunner.readRun(run.id)).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining("absolute timeout"),
    });
  });

  it("fails a stalled workflow with an idle timeout before the absolute timeout", async () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.idle-timeout.v1",
      steps: [
        {
          id: "test.idle-timeout",
          phase: "drafting",
          summary: "Stall quietly beyond the idle timeout.",
          run(context) {
            return new Promise((_resolve, reject) => {
              context.signal.addEventListener("abort", () => reject(context.signal.reason), {
                once: true,
              });
            });
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 60_000,
          maxMcpResourceReadEvents: null,
          maxRepairAttempts: 2,
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await advanceFakeTimersByTime(0);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    await advanceFakeTimersByTime(999);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    await advanceFakeTimersByTime(1);
    const failed = services.workflowRunner.readRun(run.id)!;

    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toContain("idle timeout");
    expect(failed.errorMessage).toContain("no observed activity");
    expect(failed.errorMessage).toContain("during step test.idle-timeout");
    expect(failed.metadata).toMatchObject({
      timeoutKind: "idle_timeout",
      timeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      absoluteTimeoutMs: 60_000,
    });
    expect(services.workflowRunner.listEvents(run.id)).toContainEqual(
      expect.objectContaining({ eventType: "failure", severity: "error" }),
    );
    expect(
      services.tokens.list().find((token) => token.id === failed.metadata.mcpGrantId),
    ).toMatchObject({ revokedAt: fixedNow });
  });

  it("keeps a workflow alive past the idle timeout while activity keeps arriving", async () => {
    vi.useFakeTimers();
    const storage = createStorage();
    let recordActivity: (() => void) | null = null;
    let completeStep: (() => void) | null = null;
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.idle-activity.v1",
      steps: [
        {
          id: "test.idle-activity",
          phase: "drafting",
          summary: "Report activity for longer than the idle timeout.",
          run(context) {
            recordActivity = () => {
              context.activity.record({
                runId: context.run.id,
                summary: "Still working.",
              });
            };

            return new Promise((resolve) => {
              completeStep = () => resolve({ draftOutput: validSetupSmokeDraft() });
            });
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 5_000,
          maxMcpResourceReadEvents: null,
          maxRepairAttempts: 2,
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await advanceFakeTimersByTime(0);

    await advanceFakeTimersByTime(900);
    recordActivity!();
    await advanceFakeTimersByTime(999);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    completeStep!();
    await advanceFakeTimersByTime(0);
    const completed = services.workflowRunner.readRun(run.id)!;

    expect(completed.status).toBe("completed");
    expect(completed.metadata).toMatchObject({
      idleTimeoutMs: 1_000,
      absoluteTimeoutMs: 5_000,
      timeoutBudgetMs: 5_000,
    });
    expect(completed.errorMessage).toBeNull();
  });

  it("still enforces the absolute timeout when activity keeps resetting the idle watchdog", async () => {
    vi.useFakeTimers();
    const storage = createStorage();
    let recordActivity: (() => void) | null = null;
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.absolute-with-activity.v1",
      steps: [
        {
          id: "test.absolute-with-activity",
          phase: "drafting",
          summary: "Report activity until the absolute timeout fires.",
          run(context) {
            recordActivity = () => {
              context.activity.record({
                runId: context.run.id,
                summary: "Still working.",
              });
            };

            return new Promise((_resolve, reject) => {
              context.signal.addEventListener("abort", () => reject(context.signal.reason), {
                once: true,
              });
            });
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 3_000,
          maxMcpResourceReadEvents: null,
          maxRepairAttempts: 2,
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await advanceFakeTimersByTime(0);

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await advanceFakeTimersByTime(900);
      recordActivity!();
    }

    await advanceFakeTimersByTime(299);
    expect(services.workflowRunner.readRun(run.id)?.status).toBe("running");

    await advanceFakeTimersByTime(1);
    const failed = services.workflowRunner.readRun(run.id)!;

    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toContain("absolute timeout");
    expect(failed.metadata).toMatchObject({
      timeoutKind: "budget_exceeded",
      timeoutMs: 3_000,
    });
  });

  it("clears timeout watchdogs on completion so no timer fires afterwards", async () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.timer-cleanup.v1",
      steps: [
        {
          id: "test.timer-cleanup",
          phase: "drafting",
          summary: "Complete immediately.",
          run() {
            return { draftOutput: validSetupSmokeDraft() };
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 2_000,
          maxMcpResourceReadEvents: null,
          maxRepairAttempts: 2,
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await advanceFakeTimersByTime(0);

    expect(services.workflowRunner.readRun(run.id)?.status).toBe("completed");
    await advanceFakeTimersByTime(1);
    expect(vi.getTimerCount()).toBe(0);
    await advanceFakeTimersByTime(1_999);

    expect(services.workflowRunner.readRun(run.id)).toMatchObject({
      status: "completed",
      errorMessage: null,
    });
    expect(
      services.workflowRunner.listEvents(run.id).filter((event) => event.eventType === "failure"),
    ).toHaveLength(0);
  });

  it("redacts secrets from workflow events, failed runs, agent events, and local workflow logs", async () => {
    const storage = createStorage();
    const secret = "grt_test_observability_secret_123456789";
    const providerKey = "sk-test_observability_secret_123456789";
    const logDir = await tempDir();
    const logPath = join(logDir, "workflows.jsonl");
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.redaction.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.redaction",
          phase: "reading_context",
          summary: `Read context with ${secret}.`,
          run(context) {
            context.events.record({
              runId: context.run.id,
              eventType: "mcp_resource_read",
              summary: `Read resource with Bearer ${secret}.`,
              metadata: {
                apiToken: secret,
                nested: {
                  authorization: `Bearer ${secret}`,
                  providerKey,
                },
                diagnostic: `token=${secret}`,
              },
            });
            throw new Error(`Provider failed with PROVIDER_API_KEY=${providerKey} and ${secret}`);
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        logs: { enabled: true, path: logPath },
        tracing: {
          enabled: true,
          mode: "redacted",
          otlpEndpoint: "http://127.0.0.1:4318/v1/traces",
          langchainEnabled: false,
          serviceName: "greenroom-test",
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    const failed = await waitForRun(services, run.id, (candidate) => candidate.status === "failed");
    const workflowEvents = services.workflowRunner.listEvents(run.id);
    const agentEvents = services.agentEvents.listByReview(review.id);
    const workflowLog = await readFile(logPath, "utf8");
    const serialized = JSON.stringify({ failed, workflowEvents, agentEvents, workflowLog });

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(providerKey);
    expect(serialized).not.toContain("apiToken");
    expect(serialized).toContain("[redacted");
    expect(workflowEvents).toContainEqual(
      expect.objectContaining({
        eventType: "mcp_resource_read",
        metadata: expect.objectContaining({
          mcpResourceReadCount: 1,
          redactedFieldCount: 1,
        }),
      }),
    );
    expect(workflowLog).toContain('"workflowKind":"setup_smoke"');
    expect(workflowLog).toContain('"otlpEndpointConfigured":true');
  });

  it("keeps queued runs from starting until configured concurrency opens capacity", async () => {
    const storage = createStorage();
    const startedRunIds: string[] = [];
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.concurrency.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.concurrent-step",
          phase: "drafting",
          summary: "Exercise workflow queueing.",
          run(context) {
            startedRunIds.push(context.run.id);

            if (startedRunIds.length === 1) {
              return new Promise((resolve, reject) => {
                context.signal.addEventListener("abort", () => reject(context.signal.reason), {
                  once: true,
                });
                setTimeout(resolve, 1_000);
              });
            }

            return { draftOutput: validSetupSmokeDraft() };
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 1_000,
          maxMcpResourceReadEvents: null,
          maxRepairAttempts: 2,
        },
      }),
    });
    const first = createRun(services, review.displayId, profile);
    const second = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(first.id);
    services.workflowRunner.approveRun(second.id);
    await waitForRun(services, first.id, (candidate) => candidate.status === "running");

    expect(services.workflowRunner.readRun(second.id)).toMatchObject({ status: "queued" });
    expect(startedRunIds).toEqual([first.id]);

    services.workflowRunner.cancelRun(first.id, "Release queue capacity.");
    const completedSecond = await waitForRun(
      services,
      second.id,
      (candidate) => candidate.status === "completed",
    );

    expect(completedSecond).toMatchObject({ status: "completed" });
    expect(startedRunIds).toEqual([first.id, second.id]);
  });

  it("fails a workflow when recorded MCP resource reads exceed the configured limit", async () => {
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.mcp-read-limit.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.read-limit",
          phase: "reading_context",
          summary: "Record too many resource reads.",
          run(context) {
            context.events.record({
              runId: context.run.id,
              eventType: "mcp_resource_read",
              summary: "First recorded resource read.",
              metadata: { resource: "greenroom://test/1" },
            });
            context.events.record({
              runId: context.run.id,
              eventType: "mcp_resource_read",
              summary: "Second recorded resource read.",
              metadata: { resource: "greenroom://test/2" },
            });

            return { draftOutput: validSetupSmokeDraft() };
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig({
        operational: {
          maxConcurrentRuns: 1,
          idleTimeoutMs: 1_000,
          absoluteTimeoutMs: 1_000,
          maxMcpResourceReadEvents: 1,
          maxRepairAttempts: 2,
        },
      }),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    const failed = await waitForRun(services, run.id, (candidate) => candidate.status === "failed");
    const resourceReadEvents = services.workflowRunner
      .listEvents(run.id)
      .filter((event) => event.eventType === "mcp_resource_read");

    expect(failed.errorMessage).toContain("maximum recorded MCP resource reads");
    expect(resourceReadEvents).toHaveLength(1);
    expect(resourceReadEvents[0]?.metadata).toMatchObject({
      mcpResourceReadCount: 1,
      mcpResourceReadLimit: 1,
    });
  });

  it("stores validation issues, emits one repair attempt, and fails after the repair limit", async () => {
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.repair.v1",
      defaultTimeoutMs: 1_000,
      repairPolicy: {
        maxAttempts: 1,
        createRepairContext(context) {
          return {
            attemptNumber: context.attemptNumber,
            issueCodes: context.issues.map((issue) => issue.code),
            promptSummary: "Repair the setup smoke draft.",
            createdAt: fixedNow,
            metadata: { runId: context.run.id },
          };
        },
      },
      validator: {
        validate() {
          return {
            issues: [
              {
                code: "always-invalid",
                message: "The test validator always rejects this draft.",
                severity: "error",
                path: ["checks"],
                recoverable: true,
                metadata: {},
              },
            ],
          };
        },
      },
      steps: [
        {
          id: "test.invalid-draft",
          phase: "drafting",
          summary: "Submit an invalid setup smoke draft.",
          run: () => ({ draftOutput: validSetupSmokeDraft() }),
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    const awaitingRepair = await waitForRun(
      services,
      run.id,
      (candidate) => candidate.status === "awaiting_user",
    );
    const secondSubmission = await services.workflowRunner.submitDraft(
      run.id,
      validSetupSmokeDraft(),
    );
    const repairEvents = services.workflowRunner
      .listEvents(run.id)
      .filter((event) => event.eventType === "repair_attempt");

    expect(awaitingRepair).toMatchObject({
      status: "awaiting_user",
      phase: "repairing",
      validationIssues: [expect.objectContaining({ code: "always-invalid" })],
      metadata: {
        repairAttemptCount: 1,
        lastRepairContext: expect.objectContaining({ attemptNumber: 1 }),
      },
    });
    expect(repairEvents).toHaveLength(1);
    expect(secondSubmission).toMatchObject({
      valid: false,
      repairContext: null,
      run: { status: "failed" },
    });
  });

  it("defaults to two repair attempts and exposes attempt N of M run status", async () => {
    expect(createDefaultWorkflowRepairPolicy().maxAttempts).toBe(2);

    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.repair-default.v1",
      defaultTimeoutMs: 1_000,
      validator: {
        validate() {
          return {
            issues: [
              {
                code: "always-invalid",
                message: "The test validator always rejects this draft.",
                severity: "error",
                path: ["checks"],
                recoverable: true,
                metadata: {},
              },
            ],
          };
        },
      },
      steps: [
        {
          id: "test.invalid-draft",
          phase: "drafting",
          summary: "Submit an invalid setup smoke draft.",
          run: () => ({ draftOutput: validSetupSmokeDraft() }),
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
      workflowRuntimeConfig: testWorkflowRuntimeConfig(),
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    const firstRepair = await waitForRun(
      services,
      run.id,
      (candidate) => candidate.status === "awaiting_user",
    );

    expect(firstRepair.metadata).toMatchObject({
      repairAttemptCount: 1,
      maxRepairAttempts: 2,
    });
    expect(workflowRunRepairProgressFromMetadata(firstRepair.metadata)).toMatchObject({
      attemptNumber: 1,
      maxAttempts: 2,
      attempts: [{ attemptNumber: 1, issueCodes: ["always-invalid"] }],
    });

    const secondSubmission = await services.workflowRunner.submitDraft(
      run.id,
      validSetupSmokeDraft(),
    );

    expect(secondSubmission.run.status).toBe("awaiting_user");
    expect(workflowRunRepairProgressFromMetadata(secondSubmission.run.metadata)).toMatchObject({
      attemptNumber: 2,
      maxAttempts: 2,
      attempts: [
        { attemptNumber: 1, issueCodes: ["always-invalid"] },
        { attemptNumber: 2, issueCodes: ["always-invalid"] },
      ],
    });

    const thirdSubmission = await services.workflowRunner.submitDraft(
      run.id,
      validSetupSmokeDraft(),
    );

    expect(thirdSubmission.run.status).toBe("failed");
    expect(thirdSubmission.run.errorMessage).toContain("after 2 repair attempts");

    const repairEvents = services.workflowRunner
      .listEvents(run.id)
      .filter((event) => event.eventType === "repair_attempt");

    expect(repairEvents).toHaveLength(2);
    expect(repairEvents[0]?.summary).toContain("attempt 1 of 2");
    expect(repairEvents[0]?.metadata).toMatchObject({
      attemptNumber: 1,
      maxRepairAttempts: 2,
      issueCodes: ["always-invalid"],
    });
    expect(repairEvents[1]?.summary).toContain("attempt 2 of 2");
  });

  it("fails runs left running by a crash at startup and revokes their grants", async () => {
    const storage = createStorage();
    const observedPlaintextTokens: string[] = [];
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.restart-reconcile.v1",
      defaultTimeoutMs: 60_000,
      steps: [
        {
          id: "test.stranded",
          phase: "drafting",
          summary: "Hang like a run stranded by a crash.",
          run(context) {
            if (context.mcpGrant !== null) {
              observedPlaintextTokens.push(context.mcpGrant.plaintextToken);
            }

            return new Promise((resolve) => setTimeout(resolve, 100));
          },
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(services, review.displayId, profile);
    services.workflowRunner.approveRun(run.id);
    await waitForRun(services, run.id, (candidate) => candidate.status === "running");

    // A second services instance over the same database plays the restarted
    // server; startup reconciliation runs during construction. Random ids
    // avoid colliding with the first instance's deterministic event ids.
    const restarted = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: { clock: () => fixedNow },
      workflowDefinitions: [definition],
    });
    const failed = restarted.workflowRunner.readRun(run.id);

    if (failed === null) {
      throw new Error("Expected the stranded run to survive the restart");
    }

    expect(failed).toMatchObject({ status: "failed", phase: "failed" });
    expect(failed.errorMessage).toContain("interrupted by a server restart");
    expect(failed.metadata).toMatchObject({
      interruptedByServerRestart: true,
      interruptedStatus: "running",
      mcpGrantRevokedAt: fixedNow,
    });
    expect(restarted.workflowRunner.listEvents(run.id)).toContainEqual(
      expect.objectContaining({ eventType: "failure", severity: "error" }),
    );
    expect(
      restarted.agentEvents.listByReview(review.id).map((event) => event.summary),
    ).toContainEqual(expect.stringContaining("interrupted by a server restart"));
    expect(restarted.tokens.authenticate(observedPlaintextTokens[0]!)).toBeNull();
    expect(
      restarted.tokens.list().find((token) => token.id === failed.metadata.mcpGrantId),
    ).toMatchObject({ revokedAt: fixedNow });

    // Let the stranded step settle before teardown closes the database.
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  it("revokes unrevoked grants for terminal runs during startup reconciliation", async () => {
    const storage = createStorage();
    const { services, review, profile } = createReviewFixture(storage);
    const run = createRun(services, review.displayId, profile);
    const approved = services.workflowRunner.approveRun(run.id);

    // Simulate a crash between the terminal transition and grant revocation:
    // fail the run directly in storage so the orchestrator never revokes.
    services.workflows.updateStatus(run.id, {
      status: "failed",
      errorMessage: "Crashed before grant revocation.",
    });

    // Let the scheduled queue drain observe the terminal run and settle
    // before teardown closes the database.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const restarted = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: { clock: () => fixedNow },
    });

    expect(approved.metadata.mcpGrantId).toBeDefined();
    expect(
      restarted.tokens.list().find((token) => token.id === approved.metadata.mcpGrantId),
    ).toMatchObject({ revokedAt: fixedNow });
    expect(restarted.workflowRunner.readRun(run.id)).toMatchObject({
      status: "failed",
      metadata: expect.objectContaining({ mcpGrantRevokedAt: fixedNow }),
    });
  });

  it("stamps run-scoped MCP grants with an expiry derived from the run's timeout budget", async () => {
    const storage = createStorage();
    const definition: WorkflowDefinition = {
      kind: "setup_smoke",
      version: "test.grant-expiry.v1",
      defaultTimeoutMs: 1_000,
      steps: [
        {
          id: "test.grant-expiry",
          phase: "drafting",
          summary: "Complete immediately.",
          run: () => ({ draftOutput: validSetupSmokeDraft() }),
        },
      ],
    };
    const { review, profile } = createReviewFixture(storage);
    const services = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      workflowDefinitions: [definition],
      autoResumeQueuedWorkflowRuns: false,
    });
    const run = createRun(services, review.displayId, profile);
    const approved = services.workflowRunner.approveRun(run.id);
    const grant = services.tokens.list().find((token) => token.id === approved.metadata.mcpGrantId);

    expect(grant?.expiresAt).toBe(
      new Date(Date.parse(fixedNow) + 1_000 + mcpGrantExpiryGraceMs).toISOString(),
    );

    await waitForRun(services, run.id, (candidate) => candidate.status === "completed");
  });

  it("keeps workflow runs readable after API service re-creation", () => {
    const storage = createStorage();
    const { services, review, profile } = createReviewFixture(storage);
    const run = createRun(services, review.displayId, profile);
    const recreatedServices = createGreenroomApiServices(storage.database, {
      defaultAiBackend: "mock",
      domain: {
        clock: () => fixedNow,
        idFactory: deterministicIds(),
      },
      autoResumeQueuedWorkflowRuns: false,
    });

    expect(recreatedServices.workflowRunner.readRun(run.id)).toMatchObject({
      id: run.id,
      status: "pending_consent",
    });
    expect(recreatedServices.workflowRunner.listRunsByReview(review.id)).toMatchObject([
      { id: run.id },
    ]);
  });
});
