import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HarnessRunRequest } from "@greenroom/schemas";
import { afterEach, describe, expect, it } from "vitest";

import type { HarnessBridgeConfig } from "../config";
import { createHarnessBridgeApp } from "../http";
import {
  codexPreset,
  createCodexAppServerSession,
  parseCodexAppServerOutput,
  parseCodexStreamEvent,
  prepareIsolatedCodexHome,
} from "./codex";
import { resolveHarnessPreset } from "./index";

const tempDirs: string[] = [];
const envRestores: Array<() => void> = [];

afterEach(async () => {
  envRestores.splice(0).forEach((restore) => restore());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("codex preset", () => {
  it("resolves Codex from explicit harness kind even when model is a model id", () => {
    const resolved = resolveHarnessPreset({
      requestModel: "gpt-5.4",
      requestHarnessKind: "codex",
      config: bridgeConfig({ defaultKind: "claude-code", enabledKinds: ["codex"] }),
    });

    expect(resolved.preset).toBe(codexPreset);
    expect(resolved.requestedKind).toBe("codex");
  });

  it("copies only auth.json into a private isolated Codex home", async () => {
    const root = await tempDir();
    const source = join(root, "source");
    const isolated = join(root, "isolated");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "auth.json"), '{"token":"test"}\n', { mode: 0o644 });
    await writeFile(join(source, "config.toml"), "[mcp_servers.evil]\n", "utf8");

    await prepareIsolatedCodexHome(isolated, source);

    expect(await readFile(join(isolated, "auth.json"), "utf8")).toBe('{"token":"test"}\n');
    expect((await stat(join(isolated, "auth.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(isolated)).mode & 0o777).toBe(0o700);
    await expect(readFile(join(isolated, "config.toml"), "utf8")).rejects.toThrow();
  });

  it("allows access-token or credential-store auth when auth.json is absent", async () => {
    const root = await tempDir();
    const source = join(root, "source");
    const isolated = join(root, "isolated");
    await mkdir(source, { recursive: true });

    await prepareIsolatedCodexHome(isolated, source);

    expect((await stat(isolated)).mode & 0o777).toBe(0o700);
    await expect(readFile(join(isolated, "auth.json"), "utf8")).rejects.toThrow();
  });

  it("builds an isolated read-only app-server invocation and sequenced turn", () => {
    setEnv("CODEX_ACCESS_TOKEN", "codex-access-token");
    const values = invocationInput(
      codexRunRequest({
        profile: {
          id: "profile_1",
          name: "Codex teaching",
          workflowType: "teaching",
          provider: "harness",
          model: "gpt-5.4",
          harnessKind: "codex",
          reasoningLevel: "high",
        },
        mcp: {
          serverUrl: "http://127.0.0.1:49332",
          serverPath: "/mcp",
          token: "secret-run-token",
          tokenRef: null,
          allowedTools: ["greenroom_submit_teaching_draft"],
          allowedResources: [],
        },
      }),
    );
    const invocation = codexPreset.buildInvocation(values);
    const session = createCodexAppServerSession(values);

    expect(invocation).toMatchObject({
      command: "codex",
      args: expect.arrayContaining(["app-server", "--stdio", "--disable", "plugins"]),
      env: {
        CODEX_HOME: "/tmp/greenroom-run/codex-home",
        CODEX_ACCESS_TOKEN: "codex-access-token",
        GREENROOM_MCP_TOKEN: "secret-run-token",
      },
    });
    expect(invocation.args.join(" ")).not.toContain("secret-run-token");

    expect(JSON.parse(session.start()[0] ?? "null")).toMatchObject({
      id: 1,
      method: "initialize",
      params: { capabilities: { experimentalApi: false, requestAttestation: false } },
    });
    const initialized = session.onLine(JSON.stringify({ id: 1, result: {} }));
    const threadStart = JSON.parse(initialized.write?.[1] ?? "null") as {
      params: Record<string, unknown>;
    };
    expect(threadStart.params).toMatchObject({
      cwd: "/tmp/workspace",
      model: "gpt-5.4",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      config: {
        mcp_servers: {
          greenroom: {
            url: "http://127.0.0.1:49332/mcp",
            bearer_token_env_var: "GREENROOM_MCP_TOKEN",
            default_tools_approval_mode: "approve",
          },
        },
      },
    });
    const threadReady = session.onLine(
      JSON.stringify({ id: 2, result: { thread: { id: "thread-1" } } }),
    );
    expect(JSON.parse(threadReady.write?.[0] ?? "null")).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        effort: "high",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      },
    });
    expect(
      session.onLine(
        JSON.stringify({
          id: "approval-1",
          method: "item/fileChange/requestApproval",
          params: {},
        }),
      ).write,
    ).toEqual([JSON.stringify({ id: "approval-1", result: { decision: "decline" } })]);
  });

  it("parses structured output and maps stream events", () => {
    const stdout = codexOutput({ summary: "ok" });
    expect(parseCodexAppServerOutput(stdout)).toEqual({ summary: "ok" });
    expect(
      parseCodexStreamEvent(
        JSON.stringify({
          method: "item/started",
          params: { item: { id: "item-1", type: "mcpToolCall", tool: "greenroom_smoke" } },
        }),
      ),
    ).toMatchObject({ kind: "tool_call", name: "greenroom_smoke" });
  });

  it("runs Codex end to end through the bridge with a fake app-server", async () => {
    const root = await tempDir();
    const bin = join(root, "bin");
    const sourceHome = join(root, "source-codex-home");
    await mkdir(bin, { recursive: true });
    await mkdir(sourceHome, { recursive: true });
    await writeFile(join(sourceHome, "auth.json"), "{}\n", { mode: 0o600 });
    await writeFile(
      join(bin, "codex"),
      [
        "#!/bin/sh",
        "read initialize",
        'echo \'{"id":1,"result":{}}\'',
        "read initialized",
        "read thread_start",
        'echo \'{"id":2,"result":{"thread":{"id":"thread-1"}}}\'',
        "read turn_start",
        `echo '${codexOutput({ kind: "teaching_draft", ok: true })}'`,
      ].join("\n"),
      "utf8",
    );
    await chmod(join(bin, "codex"), 0o755);
    setEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    setEnv("CODEX_HOME", sourceHome);

    const app = createHarnessBridgeApp(
      bridgeConfig({ defaultKind: "codex", enabledKinds: ["codex"] }),
    );
    const payload = await runBridgeJob(app, codexRunRequest({ cwd: root }));

    expect(payload).toMatchObject({
      status: "completed",
      output: { kind: "teaching_draft", ok: true },
      execution: { command: expect.stringContaining("codex app-server --stdio") },
    });
  });
});

function codexOutput(output: Record<string, unknown>): string {
  const item = { id: "item-1", type: "agentMessage", text: JSON.stringify(output) };
  return [
    JSON.stringify({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item, completedAtMs: 1 },
    }),
    JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [item] },
      },
    }),
  ].join("\n");
}

function codexRunRequest(
  overrides: Partial<HarnessRunRequest> & Record<string, unknown> = {},
): HarnessRunRequest {
  return {
    workflow: "teaching.generate",
    runId: "workflow_run_1",
    profile: {
      id: "profile_1",
      name: "Codex teaching",
      workflowType: "teaching",
      provider: "harness",
      model: "codex",
      harnessKind: "codex",
      reasoningLevel: null,
    },
    cwd: "/tmp/workspace",
    prompt: "prompt",
    schema: { type: "object" },
    timeoutMs: 10_000,
    metadata: {},
    ...overrides,
  } as HarnessRunRequest;
}

function invocationInput(request: HarnessRunRequest) {
  return {
    request,
    workDir: "/tmp/greenroom-run",
    cwd: "/tmp/workspace",
    schemaPath: "/tmp/schema.json",
    schemaJson: '{"type":"object"}',
    promptPath: "/tmp/prompt.txt",
    outputPath: "/tmp/output.json",
    mcpConfigPath: "/tmp/mcp.json",
    mcpUrl: "http://127.0.0.1:49332/mcp",
  };
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
  const dir = await mkdtemp(join(tmpdir(), "greenroom-codex-preset-test-"));
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

  throw new Error("Timed out waiting for Codex bridge job");
}

function setEnv(name: string, value: string): void {
  const previous = process.env[name];
  process.env[name] = value;
  envRestores.push(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
}

function authHeaders(): Record<string, string> {
  return { authorization: "Bearer bridge-token", "content-type": "application/json" };
}
