/**
 * Live service stack for the live-API Playwright suite.
 *
 * Boots the real Greenroom processes the way `greenroom up` does — the
 * harness bridge (packages/harness) and the API server (apps/server) serving
 * the built web app from apps/web/dist — over a throwaway SQLite database and
 * a real temporary git fixture repository. No API route is ever mocked; the
 * only stand-in is the mock coding-agent CLI (tests/live/mock-harness.ts)
 * that the bridge executes for AI runs, plus a stub `claude` binary on the
 * bridge PATH so harness CLI detection reports a usable coding agent on CI
 * machines that have none installed.
 *
 * Runs under the Playwright (Node) runner, so it sticks to node: APIs and
 * spawns Bun only for the Greenroom processes themselves.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface LiveStack {
  /** Origin of the API server, which also serves the built web app. */
  baseUrl: string;
  /** Admin bearer token minted through POST /api/setup/tokens. */
  adminToken: string;
  /** Registered fixture repository id. */
  repositoryId: string;
  /** Root path of the temporary git fixture repository. */
  repositoryPath: string;
  /** Name of the pre-created mock-harness builtin_review profile. */
  reviewerProfileName: string;
  /** Name of the short-idle profile used by the timeout coverage. */
  silentProfileName: string;
  stop: () => Promise<void>;
}

export const liveFixture = {
  baseBranch: "main",
  headBranch: "feature/review",
  changedFile: "src/index.ts",
  reviewerProfileName: "Live mock reviewer",
  silentProfileName: "Live silent mock reviewer",
} as const;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const startupTimeoutMs = 60_000;

export async function startLiveStack(): Promise<LiveStack> {
  const webDist = join(repoRoot, "apps", "web", "dist");

  if (!existsSync(join(webDist, "index.html"))) {
    throw new Error(
      "apps/web/dist is missing. Run `bun run web:build` first (`bun run test:ui:live` does this automatically).",
    );
  }

  const bunBin = resolveBunBinary();
  const stateDir = mkdtempSync(join(tmpdir(), "greenroom-live-"));
  const processes: Array<{ name: string; child: ChildProcess; logs: string[] }> = [];

  const stop = async (): Promise<void> => {
    await Promise.all(processes.splice(0).map(({ child }) => terminate(child)));
    rmSync(stateDir, { recursive: true, force: true });
  };

  try {
    const repositoryPath = join(stateDir, "fixture-repo");
    createFixtureRepository(repositoryPath);

    // Stub Claude Code so bridge detection (and the web app's AI-run
    // readiness gate) sees an installed harness even on bare CI machines.
    // Runs go through the real claude-code preset; the stub only replaces the
    // external CLI binary with the deterministic live mock.
    const stubBinDir = join(stateDir, "stub-bin");
    mkdirSync(stubBinDir, { recursive: true });
    writeFileSync(
      join(stubBinDir, "claude"),
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '  echo "9.9.9 (Claude Code)"',
        "  exit 0",
        "fi",
        `exec ${JSON.stringify(bunBin)} ${JSON.stringify(join(repoRoot, "tests", "live", "mock-harness.ts"))} --stdin`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const bridgePort = await findFreePort();
    const apiPort = await findFreePort();
    const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
    const baseUrl = `http://127.0.0.1:${apiPort}`;
    const harnessToken = `live-bridge-${randomBytes(12).toString("hex")}`;

    const bridge = launch({
      name: "harness-bridge",
      command: bunBin,
      args: [join(repoRoot, "packages", "harness", "src", "http.ts")],
      env: {
        ...process.env,
        PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
        GREENROOM_HARNESS_HOST: "127.0.0.1",
        GREENROOM_HARNESS_PORT: String(bridgePort),
        GREENROOM_HARNESS_TOKEN: harnessToken,
        GREENROOM_HARNESS_KIND: "claude-code",
        GREENROOM_HARNESS_STATE_DIR: join(stateDir, "bridge-state"),
      },
    });
    processes.push(bridge);
    await waitForHealth(`${bridgeUrl}/health`, bridge);

    const server = launch({
      name: "api-server",
      command: bunBin,
      args: [
        join(repoRoot, "apps", "server", "src", "cli.ts"),
        "--host",
        "127.0.0.1",
        "--port",
        String(apiPort),
        "--database-path",
        join(stateDir, "greenroom.sqlite"),
        "--web-dist",
        webDist,
      ],
      env: {
        ...process.env,
        GREENROOM_HARNESS_BASE_URL: bridgeUrl,
        GREENROOM_HARNESS_TOKEN: harnessToken,
        // The mock harness reads review context straight from the REST API
        // with its run-scoped grant, so the "MCP server" URL forwarded to
        // harness subprocesses is the API origin itself.
        GREENROOM_MCP_BASE_URL: baseUrl,
        // Isolate from any real operator config/data on this machine.
        GREENROOM_CONFIG_PATH: join(stateDir, "greenroom.toml"),
        GREENROOM_DATA_DIR: join(stateDir, "data"),
      },
    });
    processes.push(server);
    await waitForHealth(`${baseUrl}/health`, server);

    // Real bootstrap path: mint the first admin token on loopback, then
    // provision the fixture repository and the mock-harness review profile
    // through the public API.
    const setup = (await requestJson(`${baseUrl}/api/setup/tokens`, {
      method: "POST",
      body: { name: "Live suite admin" },
    })) as { plaintextToken: string };
    const adminToken = setup.plaintextToken;
    const repository = (await requestJson(`${baseUrl}/api/repositories`, {
      method: "POST",
      token: adminToken,
      body: { rootPath: repositoryPath },
    })) as { repository: { id: string } };

    await requestJson(`${baseUrl}/api/profiles`, {
      method: "POST",
      token: adminToken,
      body: {
        name: liveFixture.reviewerProfileName,
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
        modelSettings: { harness: { kind: "claude-code" } },
        privacy: { consentMode: "two_step", persistTranscript: true },
      },
    });
    await requestJson(`${baseUrl}/api/profiles`, {
      method: "POST",
      token: adminToken,
      body: {
        name: liveFixture.silentProfileName,
        workflowType: "builtin_review",
        provider: "harness",
        model: "claude-code",
        modelSettings: { harness: { kind: "claude-code", idleTimeoutMs: 2500 } },
        privacy: { consentMode: "two_step", persistTranscript: true },
      },
    });

    return {
      baseUrl,
      adminToken,
      repositoryId: repository.repository.id,
      repositoryPath,
      reviewerProfileName: liveFixture.reviewerProfileName,
      silentProfileName: liveFixture.silentProfileName,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

function createFixtureRepository(directory: string): void {
  mkdirSync(directory, { recursive: true });
  git(directory, ["init"]);
  git(directory, ["checkout", "-b", liveFixture.baseBranch]);
  git(directory, ["config", "user.name", "Greenroom Live Suite"]);
  git(directory, ["config", "user.email", "live-suite@greenroom.test"]);
  git(directory, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(directory, "README.md"), "# Live fixture\n");
  git(directory, ["add", "--all"]);
  git(directory, ["commit", "-m", "Initial commit"]);
  git(directory, ["checkout", "-b", liveFixture.headBranch]);
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(
    join(directory, liveFixture.changedFile),
    ["export function answer() {", "  const value = 42;", "  return value;", "}", ""].join("\n"),
  );
  git(directory, ["add", "--all"]);
  git(directory, ["commit", "-m", "Add feature implementation"]);
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function launch(input: { name: string; command: string; args: string[]; env: NodeJS.ProcessEnv }): {
  name: string;
  child: ChildProcess;
  logs: string[];
} {
  const child = spawn(input.command, input.args, {
    cwd: repoRoot,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  const record = (chunk: unknown): void => {
    logs.push(String(chunk));

    if (logs.length > 200) {
      logs.splice(0, logs.length - 200);
    }
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  return { name: input.name, child, logs };
}

async function waitForHealth(
  url: string,
  process: { name: string; child: ChildProcess; logs: string[] },
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      break;
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await sleep(250);
  }

  throw new Error(
    `${process.name} did not become healthy at ${url} within ${startupTimeoutMs}ms.\n` +
      `Recent output:\n${process.logs.join("")}`,
  );
}

async function requestJson(
  url: string,
  options: { method: "GET" | "POST"; token?: string; body?: unknown },
): Promise<unknown> {
  const headers = new Headers();

  if (options.token !== undefined) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(
      `${options.method} ${url} failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

function resolveBunBinary(): string {
  const installDir = process.env.BUN_INSTALL?.trim() || join(homedir(), ".bun");
  const candidate = join(installDir, "bin", "bun");

  return existsSync(candidate) ? candidate : "bun";
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a free port")));
        return;
      }

      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

function terminate(child: ChildProcess): Promise<void> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }

    const forceKill = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5000);
    child.once("close", () => {
      clearTimeout(forceKill);
      resolveExit();
    });
    child.kill("SIGTERM");
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
