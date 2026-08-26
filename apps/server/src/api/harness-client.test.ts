import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getHarnessKindDescriptor, type HarnessRunRequest } from "@greenroom/schemas";

import {
  createHarnessSetupSmokeResponse,
  createHttpHarnessClient,
  discoverLocalHarnessCli,
  formatHarnessRunFailureMessage,
  installHarnessSkillPackage,
  readHarnessClientConfigFromEnv,
  readHarnessSkillCheck,
  readHarnessStatus,
} from "./harness-client";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("harness setup helpers", () => {
  it("defaults omitted bridge run timeouts to the workflow-scale backstop", () => {
    expect(
      readHarnessClientConfigFromEnv({
        GREENROOM_HARNESS_BASE_URL: "http://bridge.test",
        GREENROOM_HARNESS_TOKEN: "bridge-token",
      }),
    ).toMatchObject({ timeoutMs: 3_600_000 });
    expect(
      readHarnessClientConfigFromEnv({
        GREENROOM_HARNESS_BASE_URL: "http://bridge.test",
        GREENROOM_HARNESS_TOKEN: "bridge-token",
        GREENROOM_HARNESS_TIMEOUT_MS: "86400000",
      }),
    ).toMatchObject({ timeoutMs: 86_400_000 });
    expect(
      readHarnessClientConfigFromEnv({
        GREENROOM_HARNESS_BASE_URL: "http://bridge.test",
        GREENROOM_HARNESS_TOKEN: "bridge-token",
        GREENROOM_HARNESS_TIMEOUT_MS: "90000000",
      }),
    ).toMatchObject({ timeoutMs: 3_600_000 });
  });

  it("detects a CLI on PATH and reads a safe version", async () => {
    const root = await tempDir();
    const bin = join(root, "bin");
    const codexPath = join(bin, "codex");
    await mkdir(bin, { recursive: true });
    await writeFile(codexPath, "#!/bin/sh\necho 'codex 9.8.7'\n", "utf8");
    await chmod(codexPath, 0o755);
    const descriptor = getHarnessKindDescriptor("codex");

    if (descriptor === null) {
      throw new Error("Codex descriptor is missing");
    }

    const status = await discoverLocalHarnessCli(descriptor, {
      env: { PATH: bin, HOME: root },
    });

    expect(status).toMatchObject({
      status: "installed",
      path: codexPath,
      version: "codex 9.8.7",
      message: null,
    });
  });

  it("reports a missing CLI without breaking setup status", async () => {
    const root = await tempDir();
    const descriptor = getHarnessKindDescriptor("claude-code");

    if (descriptor === null) {
      throw new Error("Claude Code descriptor is missing");
    }

    const status = await discoverLocalHarnessCli(descriptor, {
      env: { PATH: join(root, "empty"), HOME: root },
    });

    expect(status).toMatchObject({
      status: "missing",
      path: null,
      version: null,
    });
  });

  it("checks missing, outdated, and current Greenroom skill states", async () => {
    const root = await tempDir();
    const skillsDir = join(root, "skills");
    const env = {
      PATH: "",
      HOME: root,
      GREENROOM_HARNESS_CODEX_SKILLS_DIR: skillsDir,
      GREENROOM_HARNESS_TOKEN: "secret-token-for-test",
    };
    const target = join(skillsDir, "greenroom");

    const missing = await readHarnessSkillCheck("codex", { env });
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, "metadata.json"),
      JSON.stringify({ name: "greenroom", version: "0.0.1" }),
      "utf8",
    );
    const outdated = await readHarnessSkillCheck("codex", { env });
    const installed = await installHarnessSkillPackage("codex", { env });
    const current = await readHarnessSkillCheck("codex", { env });
    const installedMetadata = await readFile(join(target, "metadata.json"), "utf8");

    expect(missing.skill).toMatchObject({
      skillMode: "managed_package",
      status: "missing",
      path: target,
    });
    expect(outdated.skill).toMatchObject({
      status: "outdated",
      installedVersion: "0.0.1",
      expectedVersion: "1.0.0",
    });
    expect(installed).toMatchObject({
      installed: true,
      skill: { status: "current", installedVersion: "1.0.0" },
    });
    expect(current.skill).toMatchObject({ status: "current", installedVersion: "1.0.0" });
    expect(installedMetadata).not.toContain("secret-token-for-test");
  });

  it("fails the setup smoke with guidance when no bridge client is available", async () => {
    const root = await tempDir();
    const response = await createHarnessSetupSmokeResponse("codex", {
      env: { PATH: "", HOME: root, GREENROOM_HARNESS_CODEX_SKILLS_DIR: join(root, "skills") },
    });

    expect(response).toMatchObject({
      workflowKind: "setup_smoke",
      harnessKind: "codex",
      status: "failed",
    });
    expect(response.message).toContain("Harness bridge is not configured");
    expect(response.checks.find((check) => check.name === "harness")).toMatchObject({
      status: "failed",
    });
    expect(response.diagnostics.join(" ")).not.toContain("secret");
  });

  it("passes the setup smoke when the bridge run returns a valid report", async () => {
    const root = await tempDir();
    const runRequests: unknown[] = [];
    const response = await createHarnessSetupSmokeResponse("claude-code", {
      env: { PATH: "", HOME: root },
      harnessClient: {
        run: (request) => {
          runRequests.push(request);
          return Promise.resolve({
            workflow: "setup_smoke" as const,
            runId: request.runId,
            status: "completed" as const,
            output: {
              kind: "setup_smoke_report",
              status: "passed",
              checks: [{ name: "harness-echo", status: "passed", summary: "Prompt received." }],
            },
            execution: {
              command: "claude",
              exitCode: 0,
              durationMs: 1200,
              stderrTail: "",
              timeoutMs: 60_000,
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
              outputCapture: "structured_stdout" as const,
            },
          });
        },
      },
    });

    expect(response.status).toBe("passed");
    expect(response.message).toContain("Setup smoke passed");
    expect(response.checks.find((check) => check.name === "harness")).toMatchObject({
      status: "passed",
    });
    expect(response.checks.find((check) => check.name === "harness:harness-echo")).toMatchObject({
      status: "passed",
      summary: "Prompt received.",
    });
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0]).toMatchObject({
      workflow: "setup_smoke",
      profile: {
        provider: "harness",
        model: "claude-code",
        harnessKind: "claude-code",
        reasoningLevel: null,
      },
      outputCapture: "structured_stdout",
      mcp: null,
    });
  });

  it("fails the setup smoke when the harness output does not match the report schema", async () => {
    const root = await tempDir();
    const response = await createHarnessSetupSmokeResponse("claude-code", {
      env: { PATH: "", HOME: root },
      harnessClient: {
        run: (request) =>
          Promise.resolve({
            workflow: "setup_smoke" as const,
            runId: request.runId,
            status: "completed" as const,
            output: { kind: "builtin_review_findings", findings: [] },
            execution: {
              command: "claude",
              exitCode: 0,
              durationMs: 900,
              stderrTail: "",
              timeoutMs: 60_000,
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
              outputCapture: "structured_stdout" as const,
            },
          }),
      },
    });

    expect(response.status).toBe("failed");
    expect(response.message).toContain("does not match the setup smoke report schema");
  });

  it("fails the setup smoke and surfaces stderr when the bridge run fails", async () => {
    const root = await tempDir();
    const response = await createHarnessSetupSmokeResponse("claude-code", {
      env: { PATH: "", HOME: root },
      harnessClient: {
        run: () => Promise.reject(new Error("bridge unreachable")),
      },
    });

    expect(response.status).toBe("failed");
    expect(response.message).toContain("bridge unreachable");
  });

  it("runs bridge jobs and forwards redacted stream events", async () => {
    const requestLog: Array<{ method: string; path: string }> = [];
    const runCreatePayloads: Array<{ timeoutMs?: number }> = [];
    const seenEvents: Array<{ summary: string; text: string | null }> = [];
    const seenJobs: Array<{ status: string; lastHeartbeatAt: string | null }> = [];
    const now = "2026-07-02T12:00:00.000Z";
    const result = {
      workflow: "setup_smoke" as const,
      runId: "workflow_run_1",
      status: "completed" as const,
      output: { ok: true },
      execution: {
        command: "claude",
        exitCode: 0,
        durationMs: 42,
        stderrTail: "",
        timeoutMs: 60_000,
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
        outputCapture: "structured_stdout" as const,
      },
    };

    await withMockFetch(
      async (request) => {
        const url = new URL(request.url);
        requestLog.push({ method: request.method, path: `${url.pathname}${url.search}` });

        if (request.method === "POST" && url.pathname === "/runs") {
          runCreatePayloads.push((await request.json()) as { timeoutMs?: number });
          return Response.json(
            {
              job: {
                id: "harness_job_1",
                runId: "workflow_run_1",
                workflow: "setup_smoke",
                status: "running",
                streaming: "structured",
                submittedAt: now,
                startedAt: now,
                finishedAt: null,
                lastHeartbeatAt: now,
                lastProcessSeenAt: now,
                heartbeatIntervalMs: 5000,
                cancelRequestedAt: null,
                lastEventSequence: 0,
                result: null,
                errorMessage: null,
              },
            },
            { status: 202 },
          );
        }

        if (request.method === "GET" && url.pathname === "/runs/harness_job_1/events") {
          const since = url.searchParams.get("since");

          return Response.json({
            events:
              since === "0"
                ? [
                    {
                      sequence: 1,
                      timestamp: now,
                      kind: "assistant_text",
                      summary: "using bridge-token and grt_test_run_token_secret",
                      text: "token grt_test_run_token_secret",
                      name: null,
                      data: { token: "grt_test_run_token_secret" },
                    },
                  ]
                : [
                    {
                      sequence: 2,
                      timestamp: now,
                      kind: "exit",
                      summary: "Harness command exited with status 0.",
                      text: null,
                      name: null,
                      data: { exitCode: 0 },
                    },
                  ],
            nextCursor: since === "0" ? 1 : 2,
            terminal: since !== "0",
          });
        }

        if (request.method === "GET" && url.pathname === "/runs/harness_job_1") {
          return Response.json({
            id: "harness_job_1",
            runId: "workflow_run_1",
            workflow: "setup_smoke",
            status: "completed",
            streaming: "structured",
            submittedAt: now,
            startedAt: now,
            finishedAt: now,
            lastHeartbeatAt: now,
            lastProcessSeenAt: now,
            heartbeatIntervalMs: 5000,
            cancelRequestedAt: null,
            lastEventSequence: 2,
            result,
            errorMessage: null,
          });
        }

        return Response.json(
          { error: { code: "not_found", message: "not found" } },
          { status: 404 },
        );
      },
      async () => {
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });
        const run = await client.run(harnessRunRequest(), {
          onEvent: (event) => seenEvents.push({ summary: event.summary, text: event.text }),
          onJobUpdate: (job) =>
            seenJobs.push({ status: job.status, lastHeartbeatAt: job.lastHeartbeatAt }),
        });

        expect(run).toMatchObject({ status: "completed", output: { ok: true } });
        expect(requestLog.map((entry) => entry.path)).toEqual([
          "/runs",
          "/runs/harness_job_1/events?since=0",
          "/runs/harness_job_1",
          "/runs/harness_job_1/events?since=1",
        ]);
        expect(requestLog.map((entry) => entry.path)).not.toContain("/run");
        expect(runCreatePayloads).toMatchObject([{ timeoutMs: 5000 }]);
        expect(seenEvents).toHaveLength(2);
        expect(seenJobs).toEqual([
          { status: "running", lastHeartbeatAt: now },
          { status: "completed", lastHeartbeatAt: now },
        ]);
        expect(JSON.stringify(seenEvents)).not.toContain("bridge-token");
        expect(JSON.stringify(seenEvents)).not.toContain("grt_test_run_token_secret");
        expect(JSON.stringify(seenEvents)).toContain("[redacted]");
      },
    );
  });

  it("rejects snapshot requests when the bridge lacks repository snapshot capability", async () => {
    const requestLog: Array<{ method: string; path: string }> = [];

    await withMockFetch(
      async (request) => {
        const url = new URL(request.url);
        requestLog.push({ method: request.method, path: `${url.pathname}${url.search}` });

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            runtimeMode: "bridge",
            defaultKind: null,
            commandConfigured: true,
            availableKinds: [],
            pathMappings: 0,
          });
        }

        return Response.json(
          { error: { code: "unexpected", message: "snapshot payload should not be sent" } },
          { status: 500 },
        );
      },
      async () => {
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });

        await expect(
          client.run({
            ...harnessRunRequest(),
            repositoryAccess: {
              mode: "snapshot_readonly",
              sourceRepositoryPath: "/work/greenroom",
              revisionId: "revision_1",
              baseSha: "a".repeat(40),
              headSha: "b".repeat(40),
              workspaceStrategy: "git_archive",
            },
          }),
        ).rejects.toThrow(/repository_snapshot_git_archive/u);
      },
    );

    expect(requestLog).toEqual([{ method: "GET", path: "/health" }]);
  });

  it("deletes the bridge job when the orchestrator aborts a run", async () => {
    const now = "2026-07-02T12:00:00.000Z";
    let sawRunningStatus: () => void = () => undefined;
    const runningStatusSeen = new Promise<void>((resolve) => {
      sawRunningStatus = resolve;
    });
    const requestLog: Array<{ method: string; path: string }> = [];
    const seenJobs: Array<{ status: string; cancelRequestedAt: string | null }> = [];

    await withMockFetch(
      async (request) => {
        const url = new URL(request.url);
        requestLog.push({ method: request.method, path: `${url.pathname}${url.search}` });

        if (request.method === "POST" && url.pathname === "/runs") {
          return Response.json(
            {
              job: {
                id: "harness_job_cancel",
                runId: "workflow_run_1",
                workflow: "setup_smoke",
                status: "running",
                streaming: "line",
                submittedAt: now,
                startedAt: now,
                finishedAt: null,
                lastEventSequence: 0,
                result: null,
                errorMessage: null,
              },
            },
            { status: 202 },
          );
        }

        if (request.method === "GET" && url.pathname === "/runs/harness_job_cancel/events") {
          return Response.json({ events: [], nextCursor: 0, terminal: false });
        }

        if (request.method === "GET" && url.pathname === "/runs/harness_job_cancel") {
          sawRunningStatus();
          return Response.json({
            id: "harness_job_cancel",
            runId: "workflow_run_1",
            workflow: "setup_smoke",
            status: "running",
            streaming: "line",
            submittedAt: now,
            startedAt: now,
            finishedAt: null,
            lastEventSequence: 0,
            result: null,
            errorMessage: null,
          });
        }

        if (request.method === "DELETE" && url.pathname === "/runs/harness_job_cancel") {
          return Response.json({
            id: "harness_job_cancel",
            runId: "workflow_run_1",
            workflow: "setup_smoke",
            status: "cancelled",
            streaming: "line",
            submittedAt: now,
            startedAt: now,
            finishedAt: now,
            cancelRequestedAt: now,
            lastEventSequence: 0,
            result: null,
            errorMessage: null,
          });
        }

        return Response.json(
          { error: { code: "not_found", message: "not found" } },
          { status: 404 },
        );
      },
      async () => {
        const controller = new AbortController();
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });
        const runPromise = client.run(harnessRunRequest(), {
          signal: controller.signal,
          onJobUpdate: (job) =>
            seenJobs.push({ status: job.status, cancelRequestedAt: job.cancelRequestedAt }),
        });

        await runningStatusSeen;
        controller.abort();
        await expect(runPromise).rejects.toThrow("Harness bridge run cancelled");
        await waitFor(() =>
          requestLog.some(
            (entry) => entry.method === "DELETE" && entry.path === "/runs/harness_job_cancel",
          ),
        );
        await waitFor(() =>
          seenJobs.some((job) => job.status === "cancelled" && job.cancelRequestedAt === now),
        );
      },
    );
  });

  it("passes bridge-detected harnesses through the harness status payload", async () => {
    const root = await tempDir();
    const detectedClaude = {
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
    };
    const seenAuthorization: Array<string | null> = [];
    await withMockFetch(
      async (request) => {
        const url = new URL(request.url);
        seenAuthorization.push(request.headers.get("authorization"));

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            runtimeMode: "bridge",
            defaultKind: null,
            commandConfigured: false,
            availableKinds: [],
            pathMappings: 0,
            capabilities: ["run_jobs", "heartbeat", "repository_snapshot_git_archive"],
          });
        }

        if (url.pathname === "/harnesses") {
          return Response.json({
            probedAt: "2026-07-01T00:00:00.000Z",
            harnesses: [detectedClaude],
          });
        }

        return Response.json(
          { error: { code: "not_found", message: "not found" } },
          {
            status: 404,
          },
        );
      },
      async () => {
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });
        const detection = await client.detectedHarnesses?.();
        const status = await readHarnessStatus(client, { env: { PATH: "", HOME: root } });

        expect(detection?.harnesses).toEqual([detectedClaude]);
        expect(status).toMatchObject({
          configured: true,
          healthy: true,
          detectedHarnesses: [detectedClaude],
          bridgeCapabilities: ["run_jobs", "heartbeat", "repository_snapshot_git_archive"],
        });
        expect(seenAuthorization).toEqual(
          Array.from({ length: seenAuthorization.length }, () => "Bearer bridge-token"),
        );
      },
    );
  });

  it("reads a refreshed harness model catalog through the authenticated bridge", async () => {
    let requestedUrl = "";
    let authorization: string | null = null;
    await withMockFetch(
      async (request) => {
        requestedUrl = request.url;
        authorization = request.headers.get("authorization");
        return Response.json({
          kind: "codex",
          source: "live",
          refreshedAt: "2026-07-01T00:00:00.000Z",
          diagnostics: [],
          models: [
            {
              id: "gpt-5-codex",
              label: "GPT-5 Codex",
              isDefault: true,
              reasoningLevels: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
              ],
            },
          ],
        });
      },
      async () => {
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });
        const catalog = await client.models?.("codex", { refresh: true });

        expect(catalog).toMatchObject({
          kind: "codex",
          source: "live",
          models: [{ id: "gpt-5-codex" }],
        });
        expect(requestedUrl).toBe("http://bridge.test/harnesses/codex/models?refresh=true");
        expect(authorization).toBe("Bearer bridge-token");
      },
    );
  });

  it("degrades to an empty detected-harness list when the bridge lacks detection", async () => {
    const root = await tempDir();
    await withMockFetch(
      async (request) => {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            runtimeMode: "bridge",
            defaultKind: null,
            commandConfigured: false,
            availableKinds: [],
            pathMappings: 0,
          });
        }

        // Older bridges have no /harnesses endpoint.
        return Response.json(
          { error: { code: "not_found", message: "not found" } },
          {
            status: 404,
          },
        );
      },
      async () => {
        const client = createHttpHarnessClient({
          baseUrl: "http://bridge.test",
          token: "bridge-token",
          timeoutMs: 5000,
        });
        const status = await readHarnessStatus(client, { env: { PATH: "", HOME: root } });

        expect(status).toMatchObject({
          configured: true,
          healthy: true,
          detectedHarnesses: [],
          bridgeCapabilities: [],
          errorMessage: null,
        });
      },
    );
  });

  it("supports legacy bridge clients that do not expose harness detection", async () => {
    const root = await tempDir();
    const status = await readHarnessStatus(
      {
        async health() {
          return {
            status: "ok",
            runtimeMode: "bridge",
            defaultKind: null,
            commandConfigured: false,
            availableKinds: [],
            pathMappings: 0,
            capabilities: [],
          };
        },
        async run() {
          throw new Error("Legacy bridge run was not expected");
        },
      },
      { env: { PATH: "", HOME: root } },
    );

    expect(status).toMatchObject({
      configured: true,
      healthy: true,
      detectedHarnesses: [],
      bridgeCapabilities: [],
      errorMessage: null,
    });
  });

  it("reports an unconfigured bridge with an empty detected-harness list", async () => {
    const root = await tempDir();
    const status = await readHarnessStatus(null, { env: { PATH: "", HOME: root } });

    expect(status).toMatchObject({
      configured: false,
      healthy: false,
      runtimeMode: "disabled",
      detectedHarnesses: [],
      bridgeCapabilities: [],
    });
  });

  it("formats failed bridge diagnostics without unredacted token-shaped values", () => {
    const message = formatHarnessRunFailureMessage({
      workflow: "builtin_review",
      runId: "workflow_run_1",
      status: "failed",
      message: "Harness modified repository state; output was discarded",
      execution: {
        command: "fake-harness [redacted-token]",
        exitCode: 0,
        durationMs: 42,
        stderrTail: "token [redacted-token]",
        timeoutMs: 1000,
        timeoutBudgetMs: null,
        timeoutClamped: false,
        timedOut: false,
        repositoryAccessMode: "mcp_only",
        repositoryWorkspaceStrategy: null,
        workspaceSetupStatus: "not_required",
        workspaceCleanupStatus: "not_required",
        workspaceErrorMessage: null,
        repositoryChanged: true,
        repositoryFingerprintBefore: "before",
        repositoryFingerprintAfter: "after",
        outputCapture: "mcp_draft_tool_or_structured_stdout",
      },
    });

    expect(message).toContain("command=fake-harness [redacted-token]");
    expect(message).toContain("durationMs=42");
    expect(message).toContain("timedOut=false");
    expect(message).toContain("repositoryChanged=true");
    expect(message).not.toContain("grt_");
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-harness-client-test-"));
  tempDirs.push(dir);
  return dir;
}

async function withMockFetch(
  handler: (request: Request) => Promise<Response> | Response,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) =>
    handler(
      input instanceof Request ? input : new Request(input.toString(), init),
    )) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function harnessRunRequest(): HarnessRunRequest {
  return {
    workflow: "setup_smoke",
    runId: "workflow_run_1",
    profile: {
      id: "profile_1",
      name: "Harness setup smoke",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
    },
    cwd: "/work/greenroom",
    prompt: "Check the harness setup.",
    schema: {},
    mcp: {
      serverUrl: "http://api.test",
      token: "grt_test_run_token_secret",
      allowedTools: [],
      allowedResources: [],
    },
    metadata: {},
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for predicate");
}
