import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type HarnessBridgeConfig } from "./config";
import { createHarnessDetector } from "./detect";
import { createHarnessBridgeApp } from "./http";
import { claudeCodeReadOnlyTools, parseClaudeCodeOutput } from "./presets/claude-code";
import { resolveHarnessPreset } from "./presets";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function runBridgeJob(app: ReturnType<typeof createHarnessBridgeApp>, request: unknown) {
  const created = await app.request("/runs", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(request),
  });

  if (created.status !== 202) {
    throw new Error(
      `Expected bridge job creation to return 202, got ${created.status}: ${await created.text()}`,
    );
  }
  const createdPayload = (await created.json()) as { job: { id: string } };
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3_000) {
    const status = await app.request(`/runs/${encodeURIComponent(createdPayload.job.id)}`, {
      headers: authHeaders(),
    });
    const payload = (await status.json()) as {
      status: string;
      result: unknown;
      errorMessage: string | null;
    };

    if (payload.status === "completed" || payload.status === "failed") {
      return payload.result ?? { status: "failed", message: payload.errorMessage };
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for harness bridge job");
}

async function waitForBridgeJobTerminal(
  app: ReturnType<typeof createHarnessBridgeApp>,
  jobId: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3_000) {
    const status = await app.request(`/runs/${encodeURIComponent(jobId)}`, {
      headers: authHeaders(),
    });
    const payload = (await status.json()) as { status: string };

    if (payload.status === "completed" || payload.status === "failed") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for harness bridge job");
}

describe("harness bridge", () => {
  it("reports health and requires bearer auth for runs", async () => {
    const config = bridgeConfig({ command: process.execPath, args: ["-e", "console.log('{}')"] });
    const app = createHarnessBridgeApp(config);

    const health = await app.request("/health");
    const missingAuth = await app.request("/runs", { method: "POST" });

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: "ok",
      runtimeMode: "bridge",
      commandConfigured: true,
      availableKinds: [],
      pathMappings: 0,
      capabilities: ["run_jobs", "heartbeat"],
    });
    expect(missingAuth.status).toBe(401);
  });

  it("exposes authenticated harness CLI detection with smoke recording", async () => {
    const root = await tempDir();
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "claude"), "#!/bin/sh\necho '7.7.7 (Claude Code)'\n", "utf8");
    await chmod(join(bin, "claude"), 0o755);
    const detector = createHarnessDetector({
      stateDir: join(root, "state"),
      env: { PATH: bin },
    });
    const app = createHarnessBridgeApp(bridgeConfig(), { detector });

    const missingAuth = await app.request("/harnesses");
    const detection = await app.request("/harnesses", { headers: authHeaders() });
    const detectionPayload = (await detection.json()) as {
      probedAt: string;
      harnesses: Array<Record<string, unknown>>;
    };
    const smoke = await app.request("/harnesses/claude-code/smoke", {
      method: "POST",
      headers: authHeaders(),
    });
    const unknownSmoke = await app.request("/harnesses/not-a-kind/smoke", {
      method: "POST",
      headers: authHeaders(),
    });

    expect(missingAuth.status).toBe(401);
    expect(detection.status).toBe(200);
    expect(detectionPayload.probedAt).toEqual(expect.any(String));
    expect(detectionPayload.harnesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "claude-code",
          command: "claude",
          found: true,
          path: join(bin, "claude"),
          version: "7.7.7 (Claude Code)",
          lastVerifiedVersion: "7.7.7 (Claude Code)",
          recommendSmoke: false,
        }),
        expect.objectContaining({ kind: "codex", found: false }),
      ]),
    );
    expect(smoke.status).toBe(200);
    expect(await smoke.json()).toMatchObject({
      recorded: true,
      harness: { kind: "claude-code", version: "7.7.7 (Claude Code)", recommendSmoke: false },
    });
    expect(unknownSmoke.status).toBe(404);
  });

  it("re-probes detection on demand when refresh is requested", async () => {
    const root = await tempDir();
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "claude"), "#!/bin/sh\necho '1.0.0'\n", "utf8");
    await chmod(join(bin, "claude"), 0o755);
    const detector = createHarnessDetector({
      stateDir: join(root, "state"),
      env: { PATH: bin },
    });
    const app = createHarnessBridgeApp(bridgeConfig(), { detector });

    await app.request("/harnesses", { headers: authHeaders() });
    await writeFile(join(bin, "claude"), "#!/bin/sh\necho '2.0.0'\n", "utf8");
    await chmod(join(bin, "claude"), 0o755);

    const cached = (await (await app.request("/harnesses", { headers: authHeaders() })).json()) as {
      harnesses: Array<{ kind: string; version: string | null }>;
    };
    const refreshed = (await (
      await app.request("/harnesses?refresh=true", { headers: authHeaders() })
    ).json()) as {
      harnesses: Array<{ kind: string; version: string | null; recommendSmoke: boolean }>;
    };

    expect(cached.harnesses.find((entry) => entry.kind === "claude-code")?.version).toBe("1.0.0");
    expect(refreshed.harnesses.find((entry) => entry.kind === "claude-code")).toMatchObject({
      version: "2.0.0",
      recommendSmoke: true,
    });
  });

  it("runs a configured harness command with schema placeholders and stdin prompt", async () => {
    const cwd = await tempDir();
    const config = bridgeConfig({
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs = await import('node:fs/promises');",
          "const prompt = await new Response(Bun.stdin.stream()).text();",
          "const schema = JSON.parse(await fs.readFile(process.argv.at(-1), 'utf8'));",
          "console.log(JSON.stringify({ promptIncludes: prompt.includes('approved context'), schemaType: schema.type, cwd: process.cwd() }));",
        ].join(" "),
        "{schemaPath}",
      ],
      pathMappings: [{ from: "/worktrees/example", to: cwd }],
    });
    const app = createHarnessBridgeApp(config);

    const payload = await runBridgeJob(app, {
      workflow: "teaching.generate",
      runId: "workflow_run_1",
      profile: {
        id: "profile_1",
        name: "Harness teaching",
        workflowType: "teaching",
        provider: "harness",
        model: "codex",
      },
      cwd: "/worktrees/example",
      prompt: "approved context",
      schema: { type: "object" },
      timeoutMs: 10_000,
      metadata: {},
    });
    const expectedCwd = await realpath(cwd);

    expect(payload).toMatchObject({
      status: "completed",
      output: {
        promptIncludes: true,
        schemaType: "object",
      },
      execution: {
        repositoryAccessMode: "mcp_only",
        workspaceSetupStatus: "not_required",
        workspaceCleanupStatus: "not_required",
      },
    });
    expect((payload as { output: { cwd: string } }).output.cwd).not.toBe(expectedCwd);
  });

  it("reports heartbeat and process liveness metadata for running jobs", async () => {
    const cwd = await tempDir();
    const config = bridgeConfig({
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log(JSON.stringify({ ok: true })), 250)"],
    });
    const app = createHarnessBridgeApp(config);
    const created = await app.request("/runs", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(harnessRequest(cwd)),
    });
    const createdPayload = (await created.json()) as { job: { id: string } };
    const status = await app.request(`/runs/${encodeURIComponent(createdPayload.job.id)}`, {
      headers: authHeaders(),
    });
    const statusPayload = (await status.json()) as Record<string, unknown>;

    expect(status.status).toBe(200);
    expect(statusPayload).toMatchObject({
      status: "running",
      lastHeartbeatAt: expect.any(String),
      lastProcessSeenAt: expect.any(String),
      heartbeatIntervalMs: 5000,
    });

    await waitForBridgeJobTerminal(app, createdPayload.job.id);
  });

  it("reports named Claude Code readiness and builds the Claude preset invocation", async () => {
    const config = bridgeConfig({
      defaultKind: "claude-code",
      enabledKinds: ["claude-code"],
    });
    const app = createHarnessBridgeApp(config);
    const health = await app.request("/health");
    const preset = resolveHarnessPreset({
      config,
      requestModel: "claude-code",
    }).preset;
    const request = {
      workflow: "teaching.generate" as const,
      runId: "workflow_run_1",
      profile: {
        id: "profile_1",
        name: "Harness teaching",
        workflowType: "teaching" as const,
        provider: "harness" as const,
        model: "claude-sonnet-4-5",
        harnessKind: "claude-code",
        reasoningLevel: "high",
      },
      cwd: "/worktrees/example",
      prompt: "approved context",
      schema: { type: "object" },
      mcp: {
        serverUrl: "http://127.0.0.1:49332",
        serverPath: "/mcp",
        tokenRef: "token_1",
        token: "grt_test_claude_run_token_123456789",
        allowedTools: ["greenroom_read_diff_file", "greenroom_submit_teaching_draft"],
        allowedResources: ["greenroom://runs/workflow_run_1/output-schema"],
      },
      outputMode: "teaching_draft" as const,
      outputCapture: "mcp_draft_tool_or_structured_stdout" as const,
      expectedSkillVersion: "1.0.0",
      promptId: "greenroom_teaching_prompt",
      repairAttemptNumber: 0,
      metadata: {},
    };
    const invocation = preset.buildInvocation({
      request,
      cwd: "/Users/example/workspace",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: "/tmp/mcp.json",
      mcpUrl: "http://127.0.0.1:49332/mcp",
    });

    expect(await health.json()).toMatchObject({
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
    });
    expect(invocation).toMatchObject({
      command: "claude",
      stdin: "approved context",
      args: expect.arrayContaining([
        "--mcp-config",
        "/tmp/mcp.json",
        "--model",
        "claude-sonnet-4-5",
        "--effort",
        "high",
        "--tools",
        "",
        "--allowedTools",
        "mcp__greenroom__greenroom_read_diff_file,mcp__greenroom__greenroom_submit_teaching_draft",
        "--json-schema",
        '{"type":"object"}',
      ]),
      env: expect.objectContaining({
        GREENROOM_MCP_URL: "http://127.0.0.1:49332/mcp",
        GREENROOM_MCP_TOKEN: "grt_test_claude_run_token_123456789",
      }),
    });
    const allowedToolsFlag = invocation.args.indexOf("--allowedTools");
    expect(invocation.args[allowedToolsFlag + 1]).toBe(
      "mcp__greenroom__greenroom_read_diff_file,mcp__greenroom__greenroom_submit_teaching_draft",
    );
    const snapshotInvocation = preset.buildInvocation({
      request: {
        ...request,
        repositoryAccess: {
          mode: "snapshot_readonly",
          sourceRepositoryPath: "/Users/example/workspace",
          revisionId: "revision_1",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          workspaceStrategy: "git_archive",
        },
      },
      cwd: "/tmp/greenroom-workspace/repo",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: "/tmp/mcp.json",
      mcpUrl: "http://127.0.0.1:49332/mcp",
    });
    const snapshotToolsFlag = snapshotInvocation.args.indexOf("--tools");
    expect(snapshotInvocation.args[snapshotToolsFlag + 1]).toBe(claudeCodeReadOnlyTools);
    expect(
      parseClaudeCodeOutput(JSON.stringify({ type: "result", result: '{"summary":"ok"}' })),
    ).toEqual({ summary: "ok" });
    expect(parseClaudeCodeOutput(JSON.stringify({ result: { summary: "ok" } }))).toEqual({
      summary: "ok",
    });
  });

  it("injects MCP config and env while redacting run tokens from diagnostics", async () => {
    const cwd = await tempDir();
    const runToken = "grt_test_run_token_redaction_123456789";
    const config = bridgeConfig({
      command: process.execPath,
      args: [
        "-e",
        [
          "const fs = await import('node:fs/promises');",
          "const config = JSON.parse(await fs.readFile(process.env.GREENROOM_MCP_CONFIG, 'utf8'));",
          "console.error(`token on stderr: ${process.env.GREENROOM_MCP_TOKEN}`);",
          "console.log(JSON.stringify({",
          "  mcpUrl: process.env.GREENROOM_MCP_URL,",
          "  tokenInjected: process.env.GREENROOM_MCP_TOKEN === process.argv.at(-1),",
          "  configHasToken: JSON.stringify(config).includes(process.argv.at(-1)),",
          "}));",
        ].join(" "),
        runToken,
      ],
    });
    const app = createHarnessBridgeApp(config);

    const payload = await runBridgeJob(app, {
      ...harnessRequest(cwd),
      mcp: {
        serverUrl: "http://127.0.0.1:49332",
        serverPath: "/mcp",
        tokenRef: "token_1",
        token: runToken,
        allowedTools: ["greenroom_read_diff_file", "greenroom_submit_teaching_draft"],
        allowedResources: ["greenroom://runs/workflow_run_1/output-schema"],
      },
      outputMode: "teaching_draft",
      outputCapture: "mcp_draft_tool_or_structured_stdout",
    });

    expect(payload).toMatchObject({
      status: "completed",
      output: {
        mcpUrl: "http://127.0.0.1:49332/mcp",
        tokenInjected: true,
        configHasToken: true,
      },
      execution: {
        stderrTail: expect.stringContaining("[redacted]"),
      },
    });
    expect(JSON.stringify(payload)).not.toContain(runToken);
  });

  it("accepts structured stdout fallback for MCP-first runs", async () => {
    const cwd = await tempDir();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ kind: 'teaching_draft', ok: true }))"],
      }),
    );

    const payload = await runBridgeJob(app, {
      ...harnessRequest(cwd),
      mcp: {
        serverUrl: "http://127.0.0.1:49332",
        token: "grt_test_stdout_fallback_123456789",
        allowedTools: ["greenroom_submit_teaching_draft"],
        allowedResources: [],
      },
      outputMode: "teaching_draft",
      outputCapture: "mcp_draft_tool_or_structured_stdout",
    });

    expect(payload).toMatchObject({
      status: "completed",
      output: { kind: "teaching_draft", ok: true },
      execution: { outputCapture: "mcp_draft_tool_or_structured_stdout" },
    });
  });

  it("returns failed status for invalid JSON and timeouts", async () => {
    const cwd = await tempDir();
    const invalidJsonApp = createHarnessBridgeApp(
      bridgeConfig({ command: process.execPath, args: ["-e", "console.log('not-json')"] }),
    );
    const timeoutApp = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: ["-e", "await new Promise((resolve) => setTimeout(resolve, 2000));"],
      }),
    );
    const requestBody = {
      workflow: "spotlight.plan",
      runId: "spotlight_run_1",
      profile: {
        id: "profile_1",
        name: "Harness spotlight",
        workflowType: "spotlight",
        provider: "harness",
        model: "codex",
      },
      cwd,
      prompt: "prompt",
      schema: { type: "object" },
      timeoutMs: 1000,
      metadata: {},
    };

    const invalidJson = await runBridgeJob(invalidJsonApp, requestBody);
    const timeout = await runBridgeJob(timeoutApp, requestBody);

    expect(invalidJson).toMatchObject({ status: "failed" });
    expect(timeout).toMatchObject({
      status: "failed",
      execution: { timedOut: true },
    });
  });

  it("clamps the run timeout to the API-provided budget and reports the mismatch", async () => {
    const cwd = await tempDir();
    const sleepArgs = ["-e", "await new Promise((resolve) => setTimeout(resolve, 5000));"];
    const app = createHarnessBridgeApp(
      bridgeConfig({ command: process.execPath, args: sleepArgs }),
    );
    const defaultApp = createHarnessBridgeApp(
      bridgeConfig({ command: process.execPath, args: sleepArgs, defaultTimeoutMs: 10_000 }),
    );

    const clampedRequest = await runBridgeJob(app, {
      ...harnessRequest(cwd),
      timeoutMs: 10_000,
      timeoutBudgetMs: 1000,
    });
    const requestWithoutTimeout: Record<string, unknown> = {
      ...harnessRequest(cwd),
      timeoutBudgetMs: 1000,
    };
    delete requestWithoutTimeout.timeoutMs;
    const clampedDefault = await runBridgeJob(defaultApp, requestWithoutTimeout);

    expect(clampedRequest).toMatchObject({
      status: "failed",
      message: expect.stringContaining("clamped to the API run budget"),
      execution: {
        timedOut: true,
        timeoutMs: 1000,
        timeoutBudgetMs: 1000,
        timeoutClamped: true,
      },
    });
    expect(clampedDefault).toMatchObject({
      status: "failed",
      execution: {
        timedOut: true,
        timeoutMs: 1000,
        timeoutBudgetMs: 1000,
        timeoutClamped: true,
      },
    });
  });

  it("escalates to SIGKILL when a timed-out harness ignores SIGTERM", async () => {
    const cwd = await tempDir();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: [
          "-e",
          [
            "process.on('SIGTERM', () => { console.error('ignoring SIGTERM'); });",
            "setInterval(() => {}, 1000);",
          ].join(" "),
        ],
        killGraceMs: 300,
      }),
    );

    const started = Date.now();
    const payload = await runBridgeJob(app, { ...harnessRequest(cwd), timeoutMs: 1000 });

    expect(payload).toMatchObject({
      status: "failed",
      message: expect.stringContaining("timed out"),
      execution: { timedOut: true, exitCode: null },
    });
    // SIGTERM is ignored by the child, so only the SIGKILL escalation after the
    // grace period lets the run finish well before the child's own lifetime.
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15_000);

  it("applies a hard cap to runaway stdout", async () => {
    const cwd = await tempDir();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ pad: 'x'.repeat(200000), ok: true }))"],
        maxStdoutChars: 5000,
      }),
    );

    const payload = await runBridgeJob(app, harnessRequest(cwd));

    // The capped buffer truncates the oversized JSON, so parsing fails instead
    // of buffering the full output in memory.
    expect(payload).toMatchObject({ status: "failed" });
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  });

  it("runs snapshot requests inside an archive workspace and cleans it afterward", async () => {
    const repo = await gitRepo();
    await writeFile(join(repo, "src.ts"), "export const value = 1;\n", "utf8");
    await runGit(repo, ["add", "src.ts"]);
    await runGit(repo, [
      "-c",
      "user.name=Greenroom Test",
      "-c",
      "user.email=greenroom@example.test",
      "commit",
      "-m",
      "add tracked source",
    ]);
    const headSha = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
    await writeFile(join(repo, "local-only.txt"), "local only\n", "utf8");
    const workspaceDir = await tempDir();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        workspaceDir,
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = await import('node:fs/promises');",
            "const localExists = await fs.stat('local-only.txt').then(() => true, () => false);",
            "const source = await fs.readFile('src.ts', 'utf8');",
            "console.log(JSON.stringify({ cwd: process.cwd(), localExists, hasSource: source.includes('value = 1') }));",
          ].join(" "),
        ],
      }),
    );
    const health = await app.request("/health");
    expect(await health.json()).toMatchObject({
      capabilities: ["run_jobs", "heartbeat", "repository_snapshot_git_archive"],
    });

    const payload = await runBridgeJob(app, {
      ...harnessRequest("/unused/source/path"),
      repositoryAccess: {
        mode: "snapshot_readonly",
        sourceRepositoryPath: repo,
        revisionId: "revision_1",
        baseSha: headSha,
        headSha,
        workspaceStrategy: "git_archive",
      },
    });

    expect(payload).toMatchObject({
      status: "completed",
      output: {
        hasSource: true,
        localExists: false,
      },
      execution: {
        repositoryAccessMode: "snapshot_readonly",
        repositoryWorkspaceStrategy: "git_archive",
        workspaceSetupStatus: "succeeded",
        workspaceCleanupStatus: "succeeded",
      },
    });
    expect((payload as { output: { cwd: string } }).output.cwd).not.toBe(await realpath(repo));
    expect(await readdir(workspaceDir)).toEqual([]);
  });

  it("fails snapshot requests clearly when workspace setup is not configured", async () => {
    const repo = await gitRepo();
    const headSha = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ ok: true }))"],
        workspaceDir: null,
      }),
    );

    const payload = await runBridgeJob(app, {
      ...harnessRequest("/unused/source/path"),
      repositoryAccess: {
        mode: "snapshot_readonly",
        sourceRepositoryPath: repo,
        revisionId: "revision_1",
        baseSha: headSha,
        headSha,
        workspaceStrategy: "git_archive",
      },
    });

    expect(payload).toMatchObject({
      status: "failed",
      message: expect.stringContaining("GREENROOM_HARNESS_WORKSPACE_DIR"),
      execution: {
        repositoryAccessMode: "snapshot_readonly",
        workspaceSetupStatus: "failed",
        workspaceCleanupStatus: "not_required",
      },
    });
  });

  it("cleans snapshot workspaces after command failure and timeout", async () => {
    const repo = await gitRepo();
    const headSha = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
    const failedWorkspaceDir = await tempDir();
    const timedOutWorkspaceDir = await tempDir();
    const snapshotRequest = {
      ...harnessRequest("/unused/source/path"),
      repositoryAccess: {
        mode: "snapshot_readonly",
        sourceRepositoryPath: repo,
        revisionId: "revision_1",
        baseSha: headSha,
        headSha,
        workspaceStrategy: "git_archive",
      },
    } as const;
    const failed = await runBridgeJob(
      createHarnessBridgeApp(
        bridgeConfig({
          workspaceDir: failedWorkspaceDir,
          command: process.execPath,
          args: ["-e", "process.exit(2);"],
        }),
      ),
      snapshotRequest,
    );
    const timedOut = await runBridgeJob(
      createHarnessBridgeApp(
        bridgeConfig({
          workspaceDir: timedOutWorkspaceDir,
          command: process.execPath,
          args: ["-e", "await new Promise((resolve) => setTimeout(resolve, 5000));"],
        }),
      ),
      { ...snapshotRequest, timeoutMs: 1000 },
    );

    expect(failed).toMatchObject({
      status: "failed",
      execution: { workspaceSetupStatus: "succeeded", workspaceCleanupStatus: "succeeded" },
    });
    expect(timedOut).toMatchObject({
      status: "failed",
      execution: {
        timedOut: true,
        workspaceSetupStatus: "succeeded",
        workspaceCleanupStatus: "succeeded",
      },
    });
    expect(await readdir(failedWorkspaceDir)).toEqual([]);
    expect(await readdir(timedOutWorkspaceDir)).toEqual([]);
  });

  it("preserves snapshot output while reporting cleanup failure", async () => {
    const repo = await gitRepo();
    const headSha = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
    const workspaceDir = await tempDir();
    const app = createHarnessBridgeApp(
      bridgeConfig({
        workspaceDir,
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = await import('node:fs/promises');",
            "const path = await import('node:path');",
            "await fs.chmod(path.resolve(process.cwd(), '..', '..'), 0o555);",
            "console.log(JSON.stringify({ ok: true }));",
          ].join(" "),
        ],
      }),
    );

    const payload = await runBridgeJob(app, {
      ...harnessRequest("/unused/source/path"),
      repositoryAccess: {
        mode: "snapshot_readonly",
        sourceRepositoryPath: repo,
        revisionId: "revision_1",
        baseSha: headSha,
        headSha,
        workspaceStrategy: "git_archive",
      },
    });
    await chmod(workspaceDir, 0o755);

    expect(payload).toMatchObject({
      status: "completed",
      output: { ok: true },
      execution: {
        workspaceSetupStatus: "succeeded",
        workspaceCleanupStatus: "failed",
        workspaceErrorMessage: expect.any(String),
      },
    });
  });

  it("redacts failed command diagnostics and isolates MCP-only runs from the source repo", async () => {
    const failedToken = "grt_test_failed_command_token_123456789";
    const failedApp = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: [
          "-e",
          "console.error(`failure token ${process.argv.at(-1)}`); process.exit(2);",
          failedToken,
        ],
      }),
    );
    const failedResponsePayload = await runBridgeJob(failedApp, harnessRequest(await tempDir()));

    expect(failedResponsePayload).toMatchObject({
      status: "failed",
      execution: {
        command: expect.stringContaining("[redacted"),
        stderrTail: expect.stringContaining("[redacted"),
      },
    });
    expect(JSON.stringify(failedResponsePayload)).not.toContain(failedToken);

    const repo = await gitRepo();
    const mutationApp = createHarnessBridgeApp(
      bridgeConfig({
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = await import('node:fs/promises');",
            "await fs.writeFile('changed.txt', 'mutated');",
            "console.log(JSON.stringify({ shouldBeDiscarded: true }));",
          ].join(" "),
        ],
      }),
    );
    const mutationPayload = (await runBridgeJob(mutationApp, harnessRequest(repo))) as {
      output?: unknown;
    };

    expect(mutationPayload).toMatchObject({
      status: "completed",
      output: { shouldBeDiscarded: true },
      execution: {
        repositoryAccessMode: "mcp_only",
        repositoryChanged: false,
      },
    });
    await expectExists(join(repo, "changed.txt"), false);
  });
});

function bridgeConfig(overrides: Partial<HarnessBridgeConfig> = {}): HarnessBridgeConfig {
  return {
    host: "127.0.0.1",
    port: 49_343,
    token: "bridge-token",
    stateDir: null,
    toolsDir: null,
    defaultKind: null,
    enabledKinds: [],
    command: "",
    args: [],
    pathMappings: [],
    envAllowlist: [],
    maxStderrChars: 8000,
    maxStdoutChars: 4_000_000,
    killGraceMs: 5000,
    defaultTimeoutMs: 180_000,
    workspaceDir: null,
    workspaceStaleGraceMs: 86_400_000,
    workspaceMaxActive: 16,
    workspaceMaxBytes: 5 * 1024 * 1024 * 1024,
    ...overrides,
  };
}

function authHeaders(): Headers {
  return new Headers({
    authorization: "Bearer bridge-token",
    "content-type": "application/json",
  });
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-harness-test-"));
  tempDirs.push(dir);
  return dir;
}

function harnessRequest(cwd: string) {
  return {
    workflow: "teaching.generate",
    runId: "workflow_run_1",
    profile: {
      id: "profile_1",
      name: "Harness teaching",
      workflowType: "teaching",
      provider: "harness",
      model: "codex",
    },
    cwd,
    prompt: "prompt",
    schema: { type: "object" },
    timeoutMs: 10_000,
    metadata: {},
  };
}

async function gitRepo(): Promise<string> {
  const dir = await tempDir();
  await writeFile(join(dir, "README.md"), "initial\n", "utf8");
  await runGit(dir, ["init"]);
  await runGit(dir, ["add", "README.md"]);
  await runGit(dir, [
    "-c",
    "user.name=Greenroom Test",
    "-c",
    "user.email=greenroom@example.test",
    "commit",
    "-m",
    "initial",
  ]);

  return dir;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  return stdout;
}

async function expectExists(path: string, expected: boolean): Promise<void> {
  await expect(
    stat(path).then(
      () => true,
      () => false,
    ),
  ).resolves.toBe(expected);
}
