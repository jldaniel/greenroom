import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HarnessRunRequest } from "@greenroom/schemas";
import { afterEach, describe, expect, it } from "vitest";

import type { HarnessBridgeConfig } from "../config";
import { createHarnessBridgeApp } from "../http";
import { resolveHarnessPreset } from "./index";
import { parsePiOutput, piModelArgs, piProviderEnvPassthrough, piReadOnlyTools } from "./pi";

const tempDirs: string[] = [];
const envSnapshots: Array<() => void> = [];

afterEach(async () => {
  envSnapshots.splice(0).forEach((restore) => restore());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("pi preset", () => {
  it("builds a stdin-prompt JSON-mode invocation with the schema in the system prompt", () => {
    setEnv({ GREENROOM_PI_MODEL: "anthropic/claude-sonnet-4-5", ANTHROPIC_API_KEY: "sk-test-1" });
    const preset = resolveHarnessPreset({
      requestModel: "pi",
      config: bridgeConfig({ defaultKind: "pi", enabledKinds: ["pi"] }),
    }).preset;

    const invocation = preset.buildInvocation({
      request: piRunRequest({ prompt: "approved context" }),
      cwd: "/worktrees/example",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: null,
      mcpUrl: null,
    });

    expect(invocation.command).toBe("pi");
    expect(invocation.stdin).toBe("approved context");
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--mode",
        "json",
        "--no-session",
        "--model",
        "anthropic/claude-sonnet-4-5",
      ]),
    );
    // No MCP context: all tools are disabled, mirroring claude-code's empty
    // --tools allowlist.
    expect(invocation.args).toContain("--no-tools");
    const appendIndex = invocation.args.indexOf("--append-system-prompt");
    expect(invocation.args[appendIndex + 1]).toContain('{"type":"object"}');
    // Provider API keys are forwarded through the allowlist-based subprocess env.
    expect(invocation.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-test-1" });
  });

  it("disables built-in tools for MCP-only runs even when MCP is configured", () => {
    setEnv({});
    const preset = resolveHarnessPreset({
      requestModel: "pi",
      config: bridgeConfig({ defaultKind: "pi", enabledKinds: ["pi"] }),
    }).preset;

    const invocation = preset.buildInvocation({
      request: piRunRequest({
        mcp: {
          serverUrl: "http://127.0.0.1:49332",
          serverPath: "/mcp",
          token: "grt_test_pi_run_token_123456789",
          allowedTools: [],
          allowedResources: [],
        },
      }),
      cwd: "/worktrees/example",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: "/tmp/mcp.json",
      mcpUrl: "http://127.0.0.1:49332/mcp",
    });

    expect(invocation.args).toContain("--no-tools");
    expect(invocation.args).not.toContain("--tools");
  });

  it("enables only read-only built-in tools for snapshot runs", () => {
    setEnv({});
    const preset = resolveHarnessPreset({
      requestModel: "pi",
      config: bridgeConfig({ defaultKind: "pi", enabledKinds: ["pi"] }),
    }).preset;

    const invocation = preset.buildInvocation({
      request: piRunRequest({
        repositoryAccess: {
          mode: "snapshot_readonly",
          sourceRepositoryPath: "/worktrees/example",
          revisionId: "revision_1",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          workspaceStrategy: "git_archive",
        },
        mcp: {
          serverUrl: "http://127.0.0.1:49332",
          serverPath: "/mcp",
          token: "grt_test_pi_run_token_123456789",
          allowedTools: [],
          allowedResources: [],
        },
      }),
      cwd: "/tmp/greenroom-workspace/repo",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: "/tmp/mcp.json",
      mcpUrl: "http://127.0.0.1:49332/mcp",
    });

    expect(invocation.args).toEqual(expect.arrayContaining(["--tools", piReadOnlyTools]));
    expect(invocation.args).not.toContain("--no-tools");
  });

  it("selects model and provider from env with deterministic key inference", () => {
    expect(piModelArgs({ GREENROOM_PI_MODEL: "openai/gpt-5" })).toEqual([
      "--model",
      "openai/gpt-5",
    ]);
    expect(piModelArgs({ GREENROOM_PI_PROVIDER: "groq", ANTHROPIC_API_KEY: "x" })).toEqual([
      "--provider",
      "groq",
    ]);
    expect(piModelArgs({ ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" })).toEqual([
      "--provider",
      "anthropic",
    ]);
    expect(piModelArgs({ GEMINI_API_KEY: "z" })).toEqual(["--provider", "google"]);
    expect(piModelArgs({})).toEqual([]);
    expect(
      piProviderEnvPassthrough({ OPENAI_API_KEY: "y", UNRELATED: "no", ANTHROPIC_API_KEY: "" }),
    ).toEqual({ OPENAI_API_KEY: "y" });
  });

  it("gives the profile model precedence and applies its reasoning level", () => {
    setEnv({ GREENROOM_PI_MODEL: "anthropic/env-model", ANTHROPIC_API_KEY: "sk-test-1" });
    const preset = resolveHarnessPreset({
      requestModel: "openai/gpt-5.4",
      requestHarnessKind: "pi",
      config: bridgeConfig({ defaultKind: "pi", enabledKinds: ["pi"] }),
    }).preset;
    const request = piRunRequest({
      profile: {
        id: "profile_1",
        name: "Pi teaching",
        workflowType: "teaching",
        provider: "harness",
        model: "openai/gpt-5.4",
        harnessKind: "pi",
        reasoningLevel: "high",
      },
    });
    const invocation = preset.buildInvocation({
      request,
      cwd: "/worktrees/example",
      schemaPath: "/tmp/schema.json",
      schemaJson: '{"type":"object"}',
      promptPath: "/tmp/prompt.txt",
      outputPath: "/tmp/output.json",
      mcpConfigPath: null,
      mcpUrl: null,
    });

    expect(invocation.args).toEqual(
      expect.arrayContaining(["--model", "openai/gpt-5.4", "--thinking", "high"]),
    );
    expect(invocation.args).not.toContain("anthropic/env-model");
  });

  it("parses the final assistant message from pi's JSONL event stream", () => {
    // Event shapes captured from a real pi 0.73.1 `--mode json` run.
    const stdout = [
      JSON.stringify({ type: "session", version: 3, id: "0" }),
      JSON.stringify({ type: "agent_start" }),
      "not json noise",
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "prompt" }] },
          {
            role: "assistant",
            content: [{ type: "text", text: '{"summary":"ok"}' }],
            stopReason: "stop",
          },
        ],
      }),
    ].join("\n");

    expect(parsePiOutput(stdout)).toEqual({ summary: "ok" });
  });

  it("tolerates fenced JSON and falls back to turn_end when agent_end is missing", () => {
    const fenced = JSON.stringify({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: '```json\n{"summary":"fenced"}\n```' }],
        stopReason: "stop",
      },
    });

    expect(parsePiOutput(fenced)).toEqual({ summary: "fenced" });
  });

  it("fails on provider errors even though pi exits 0", () => {
    // pi 0.73.1 reports API failures as stopReason "error" with exit code 0.
    const stdout = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "401 invalid x-api-key",
        },
      ],
    });

    expect(() => parsePiOutput(stdout)).toThrow(/401 invalid x-api-key/u);
    expect(() => parsePiOutput("")).toThrow(/JSON event output/u);
    expect(() => parsePiOutput('{"type":"agent_start"}')).toThrow(/assistant message/u);
  });

  it("runs the pi kind end to end through the bridge with a fake pi executable", async () => {
    const root = await tempDir();
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    const agentEnd = JSON.stringify({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: '{"kind":"teaching_draft","ok":true}' }],
          stopReason: "stop",
        },
      ],
    });
    // The fake pi drains stdin (like the real CLI) and replays a captured
    // JSONL stream so the spawn plumbing and output parsing run for real.
    await writeFile(join(bin, "pi"), `#!/bin/sh\ncat > /dev/null\necho '${agentEnd}'\n`, "utf8");
    await chmod(join(bin, "pi"), 0o755);
    setEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` });

    const app = createHarnessBridgeApp(bridgeConfig({ defaultKind: "pi", enabledKinds: ["pi"] }));
    const payload = await runBridgeJob(app, piRunRequest({ cwd: root }));

    expect(payload).toMatchObject({
      status: "completed",
      output: { kind: "teaching_draft", ok: true },
      execution: { command: expect.stringContaining("pi -p --mode json") },
    });
  });
});

function piRunRequest(
  overrides: Partial<HarnessRunRequest> & Record<string, unknown> = {},
): HarnessRunRequest {
  return {
    workflow: "teaching.generate",
    runId: "workflow_run_1",
    profile: {
      id: "profile_1",
      name: "Pi teaching",
      workflowType: "teaching",
      provider: "harness",
      model: "pi",
      harnessKind: "pi",
      reasoningLevel: null,
    },
    cwd: "/worktrees/example",
    prompt: "prompt",
    schema: { type: "object" },
    timeoutMs: 10_000,
    metadata: {},
    ...overrides,
  } as HarnessRunRequest;
}

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

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "greenroom-pi-preset-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runBridgeJob(
  app: ReturnType<typeof createHarnessBridgeApp>,
  request: HarnessRunRequest,
): Promise<unknown> {
  const created = await app.request("/runs", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(request),
  });

  expect(created.status).toBe(202);
  const { job } = (await created.json()) as { job: { id: string } };
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    const response = await app.request(`/runs/${encodeURIComponent(job.id)}`, {
      headers: authHeaders(),
    });
    const payload = (await response.json()) as {
      status: string;
      result: unknown;
      errorMessage: string | null;
    };

    if (payload.status === "completed" || payload.status === "failed") {
      return payload.result ?? { status: "failed", message: payload.errorMessage };
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for pi bridge job");
}

function authHeaders(): Record<string, string> {
  return {
    authorization: "Bearer bridge-token",
    "content-type": "application/json",
  };
}

/** Temporarily overrides process.env keys, restoring them after each test. */
function setEnv(values: Record<string, string>): void {
  const managed = [
    "PATH",
    "GREENROOM_PI_MODEL",
    "GREENROOM_PI_PROVIDER",
    "ANTHROPIC_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
  ];
  const previous = new Map(managed.map((name) => [name, process.env[name]] as const));

  for (const name of managed) {
    if (values[name] === undefined) {
      if (name !== "PATH") {
        delete process.env[name];
      }
    } else {
      process.env[name] = values[name];
    }
  }

  envSnapshots.push(() => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}
