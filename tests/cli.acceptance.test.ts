import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createTempGitRepository, type TestGitRepository } from "@greenroom/git/testing/repository";
import type { DiffFile, DiffLine } from "@greenroom/schemas";
import {
  readRuntimeStateFile,
  runtimeStateFilePath,
  type RuntimeStateFile,
  type ServiceName,
} from "@greenroom/supervisor";

/**
 * End-to-end CLI acceptance.
 *
 * Simulates a clean machine by spawning the REAL `greenroom up` CLI process
 * (bridge + API + MCP + static web under one supervisor) against an isolated
 * temp data dir and a temp git repository fixture, then drives the first-run
 * wizard flow at the API level (the same endpoints the /setup stepper calls):
 *
 *   token mint -> repository registration -> harness detect -> profiles
 *   seeded -> first (default) review -> one-click AI review run -> findings
 *   drafted -> draft approved -> thread created
 *
 * The AI run uses a mock harness: GREENROOM_HARNESS_COMMAND points the
 * supervised bridge at a shell script that plays back a findings draft staged
 * by the test (structured-stdout fallback), so the full workflow pipeline
 * (consent -> orchestrator -> bridge -> harness process -> draft validation
 * -> approval gate -> threads) runs for real without any AI CLI installed.
 *
 * This file is excluded from the default unit run (it spawns real processes
 * and may build the web app once); run it with `bun run test:cli`.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const startupTimeoutMs = 180_000;
const shutdownTimeoutMs = 30_000;
const testTimeoutMs = 300_000;

interface SpawnedCli {
  child: ChildProcess;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
  output: string;
}

const repositories: TestGitRepository[] = [];
const tempDirs: string[] = [];
const spawned: SpawnedCli[] = [];

afterEach(() => {
  // Kill the whole `greenroom up` process group as a backstop even when the
  // test failed mid-flight, then remove temp state.
  for (const cli of spawned.splice(0)) {
    killProcessGroup(cli.child, "SIGKILL");
  }

  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }

  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("greenroom CLI end-to-end acceptance (V2-050)", () => {
  it(
    "boots a clean machine with `greenroom up`, walks the first-run wizard flow, and turns a one-click mock AI run into a review thread",
    async () => {
      const workDir = mkdtempSync(join(tmpdir(), "greenroom-cli-e2e-"));
      tempDirs.push(workDir);
      const dataDir = join(workDir, "data");
      const draftPath = join(workDir, "mock", "draft.json");
      const mockHarnessPath = writeMockHarnessScript(workDir, draftPath);
      const repository = await createReviewRepository();

      // --- Clean machine -> `greenroom up` -------------------------------
      const cli = spawnGreenroomUp({ dataDir, mockHarnessPath });
      const state = await waitForRuntimeReady(cli, dataDir);
      const apiBaseUrl = state.urls?.api;

      if (apiBaseUrl === null || apiBaseUrl === undefined) {
        throw new Error("Runtime state file did not record an API URL");
      }

      // `up` prints exactly one primary URL and supervises the
      // bridge, API, MCP, and (static) web services.
      await waitFor(
        () => (cli.output.includes("Greenroom is running:") ? true : null),
        30_000,
        () => `greenroom up never printed its URL. Output:\n${cli.output}`,
      );
      for (const name of ["bridge", "api", "mcp", "web"] as ServiceName[]) {
        expect(
          state.services.find((service) => service.name === name),
          `service ${name} should be running`,
        ).toMatchObject({ state: "running" });
      }

      const health = await fetch(`${apiBaseUrl}/health`);
      expect(health.status).toBe(200);

      // --- Wizard step 1: mint a browser token ---------------
      // Same endpoint the /setup stepper calls; the supervisor already
      // bootstrapped its own token, so this exercises the post-bootstrap
      // loopback-client minting path.
      const setupToken = await fetch(`${apiBaseUrl}/api/setup/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "E2E wizard browser", scopes: ["admin"] }),
      });
      expect(setupToken.status).toBe(201);
      const { plaintextToken } = (await setupToken.json()) as { plaintextToken: string };
      expect(plaintextToken.length).toBeGreaterThan(0);

      const api = createApiClient(apiBaseUrl, plaintextToken);

      // The minted token works for authenticated calls, alongside the token
      // the supervisor auto-provisioned at startup.
      const tokens = (await api.get("/api/tokens")) as { tokens: Array<{ name: string }> };
      expect(tokens.tokens.map((token) => token.name)).toEqual(
        expect.arrayContaining(["E2E wizard browser", "Greenroom local admin"]),
      );

      // The API's runtime-status endpoint reads the supervisor state file.
      const runtimeStatus = (await api.get("/api/runtime/status")) as {
        supervised: boolean;
        reason: string;
        services: Array<{ name: string; state: string }>;
      };
      expect(runtimeStatus).toMatchObject({ supervised: true, reason: "ok" });
      expect(runtimeStatus.services.map((service) => service.name)).toEqual(
        expect.arrayContaining(["bridge", "api", "mcp", "web"]),
      );

      // --- Wizard step 2: register the repository -------------------------
      const repositoryPayload = (await api.post("/api/repositories", {
        rootPath: repository.directory,
      })) as { repository: { id: string } };
      const repositoryId = repositoryPayload.repository.id;
      expect(repositoryId).toMatch(/^repo_/u);

      // --- Wizard step 3: harness detection / smoke ------------------------
      // The supervised bridge is configured and healthy; detection reports
      // the known harness kinds (found or not - a clean machine may have
      // none, which is exactly the mock-fallback path).
      const harnessStatus = (await api.get("/api/harness/status")) as {
        configured: boolean;
        healthy: boolean;
        harnesses: Array<{ kind: string }>;
      };
      expect(harnessStatus).toMatchObject({ configured: true, healthy: true });
      expect(harnessStatus.harnesses.length).toBeGreaterThan(0);

      const smoke = (await api.post("/api/harness/setup-smoke", { kind: "claude-code" }, 200)) as {
        workflowKind: string;
        checks: unknown[];
      };
      expect(smoke.workflowKind).toBe("setup_smoke");
      expect(smoke.checks.length).toBeGreaterThan(0);

      // --- Wizard step 4: profiles were seeded on the fresh DB ----
      // Detection-driven: harness profiles when a CLI is installed, mock
      // fallback profiles otherwise. Either way a clean machine ends up with
      // usable defaults. The review run below uses an explicit profile so the
      // test stays deterministic on machines with and without harness CLIs.
      const seededProfiles = (await api.get("/api/profiles")) as {
        profiles: Array<{ id: string; name: string }>;
      };
      expect(seededProfiles.profiles.length).toBeGreaterThan(0);

      const profilePayload = (await api.post("/api/profiles", {
        name: "E2E mock AI review",
        workflowType: "builtin_review",
        provider: "harness",
        model: "e2e-mock",
        description: "Mock-harness review profile for the CLI acceptance test.",
        privacy: { persistTranscript: true, consentMode: "one_click" },
      })) as { profile: { id: string } };
      const profileId = profilePayload.profile.id;

      // --- Wizard step 5: create the first (default) review ----------------
      const reviewPayload = (await api.post("/api/reviews", {
        repositoryId,
        title: "First review",
      })) as { review: { displayId: string; currentRevisionId: string | null } };
      const reviewId = reviewPayload.review.displayId;
      const revisionId = reviewPayload.review.currentRevisionId;
      expect(reviewId).toMatch(/^GR-\d+$/u);

      if (revisionId === null) {
        throw new Error("Default review was created without a revision");
      }

      // The default review captured a real diff from the fixture repository.
      const diff = (await api.get(`/api/reviews/${reviewId}/diff`)) as { files: DiffFile[] };
      expect(diff.files.length).toBeGreaterThan(0);
      const changed = findFirstAddedLine(diff.files);

      // --- Stage the mock harness draft ------------------------------------
      // Anchor keys mirror the changed-line registry the builtin-review
      // validator resolves findings against.
      const anchorKey = [
        reviewId,
        revisionId,
        changed.file.path,
        changed.file.oldPath ?? "",
        "head",
        "addition",
        changed.line.newLineNumber,
      ].join(":");
      const findingTitle = "Mock finding from the E2E harness";
      writeFileSync(
        draftPath,
        `${JSON.stringify(
          {
            kind: "builtin_review_findings",
            summary: "One deliberate finding produced by the scripted mock harness.",
            findings: [
              {
                id: "finding-1",
                title: findingTitle,
                body: "The answer should be configurable instead of hardcoded.",
                type: "issue",
                severity: "major",
                anchorKey,
                confidence: 0.9,
              },
            ],
            nonFindings: ["Everything else in the changed lines looks fine."],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      // --- One-click AI run: consent + start in one request -------
      const consent = (await api.post(
        `/api/reviews/${reviewId}/builtin-review/consent`,
        { profileId, revisionId, start: true },
        201,
      )) as {
        run: {
          id: string;
          status: string;
          output: { findings: Array<{ title: string }> } | null;
          createdThreadRefs: string[];
        };
      };
      const runId = consent.run.id;

      // The one-click consent response returns the approved run immediately;
      // drafting and validation happen asynchronously. Findings are gated
      // behind draft approval (default one-click profiles do not auto-create
      // threads), so the run settles in awaiting_user.
      const drafted = await waitFor(
        async () => {
          const current = (await api.get(`/api/builtin-review/runs/${runId}`)) as {
            run: {
              status: string;
              output: { findings: Array<{ title: string }> } | null;
              createdThreadRefs: string[];
            };
          };
          return current.run.status === "approved" ? null : current.run;
        },
        60_000,
        () => `Built-in review run ${runId} never left the approved state`,
      );
      expect(drafted.status).toBe("awaiting_user");
      expect(drafted.output?.findings).toHaveLength(1);
      expect(drafted.output?.findings[0]?.title).toBe(findingTitle);
      expect(drafted.createdThreadRefs).toHaveLength(0);

      // The draft really travelled through the supervised bridge and the
      // spawned mock harness process (structured stdout capture).
      const events = (await api.get(`/api/workflow-runs/${runId}/events`)) as {
        events: Array<{ eventType: string; summary: string }>;
      };
      expect(events.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "draft_submission",
            summary: "Harness returned built-in review structured stdout draft.",
          }),
        ]),
      );
      const harnessEvents = (await api.get(`/api/workflow-runs/${runId}/events?since=0`)) as {
        events: Array<{ kind: string; summary: string }>;
      };
      expect(harnessEvents.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "run_started" }),
          expect.objectContaining({ kind: "assistant_text" }),
          expect.objectContaining({ kind: "exit" }),
        ]),
      );

      // --- Approve the drafted findings -> thread created ------------------
      const approved = (await api.post(
        `/api/builtin-review/runs/${runId}/approve-draft`,
        undefined,
        200,
      )) as {
        run: { status: string; createdThreadRefs: string[] };
      };
      expect(approved.run.status).toBe("completed");
      expect(approved.run.createdThreadRefs).toEqual(["GT-1"]);

      const workflowRun = (await api.get(`/api/workflow-runs/${runId}`)) as {
        run: { status: string; workflowKind: string };
      };
      expect(workflowRun.run).toMatchObject({
        workflowKind: "builtin_review",
        status: "completed",
      });

      const threads = (await api.get(`/api/reviews/${reviewId}/threads`)) as {
        threads: Array<{
          shortRef: string;
          status: string;
          source: { kind: string };
          anchor: { filePath: string; lineNumber: number | null };
          comments: Array<{ body: string }>;
        }>;
      };
      expect(threads.threads).toHaveLength(1);
      expect(threads.threads[0]).toMatchObject({
        shortRef: "GT-1",
        status: "open",
        source: expect.objectContaining({ kind: "builtin_reviewer" }),
        anchor: expect.objectContaining({
          filePath: changed.file.path,
          lineNumber: changed.line.newLineNumber,
        }),
        comments: [expect.objectContaining({ body: expect.stringContaining(findingTitle) })],
      });

      // --- Graceful shutdown (Ctrl-C equivalent) ----------------------------
      cli.child.kill("SIGINT");
      const exit = await waitFor(
        () => cli.exit,
        shutdownTimeoutMs,
        () => `greenroom up did not exit after SIGINT. Output:\n${cli.output}`,
      );
      expect(exit.code).toBe(0);
      // The supervisor removed its runtime state file on the way out.
      expect(await readRuntimeStateFile(runtimeStateFilePath(dataDir))).toBeNull();
    },
    testTimeoutMs,
  );
});

/**
 * The mock harness: a shell script the supervised bridge spawns instead of a
 * real AI CLI (raw-command preset via GREENROOM_HARNESS_COMMAND). It ignores
 * the prompt on stdin and plays back the findings draft the test staged.
 */
function writeMockHarnessScript(workDir: string, draftPath: string): string {
  const scriptPath = join(workDir, "mock", "mock-harness.sh");
  mkdirSync(join(workDir, "mock"), { recursive: true });
  writeFileSync(
    scriptPath,
    `#!/bin/sh\n# Greenroom E2E mock harness: plays back the staged draft.\ncat ${JSON.stringify(draftPath)}\n`,
    "utf8",
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function spawnGreenroomUp(options: { dataDir: string; mockHarnessPath: string }): SpawnedCli {
  // Simulate a clean machine: drop every inherited GREENROOM_* variable so
  // the CLI resolves everything from defaults plus the flags below, then wire
  // the supervised bridge at the mock harness command.
  const env: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GREENROOM_")) {
      env[key] = value;
    }
  }

  delete env.BUN_BIN;
  env.GREENROOM_HARNESS_COMMAND = options.mockHarnessPath;
  env.GREENROOM_HARNESS_ARGS_JSON = "[]";

  // detached: the CLI leads its own process group so cleanup can kill the
  // whole supervised tree (bridge/API/MCP) in one signal if the test fails.
  const child = spawn(
    process.execPath,
    [
      "--cwd",
      join(repoRoot, "packages", "cli"),
      "src/index.ts",
      "up",
      "--data-dir",
      options.dataDir,
    ],
    {
      cwd: repoRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const cli: SpawnedCli = { child, exit: null, output: "" };
  spawned.push(cli);

  const capture = (chunk: string) => {
    cli.output = `${cli.output}${chunk}`.slice(-40_000);
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.on("error", (error) => {
    capture(`\n[spawn error] ${error.message}\n`);
    cli.exit = cli.exit ?? { code: null, signal: null };
  });
  child.on("exit", (code, signal) => {
    cli.exit = { code, signal };
  });

  return cli;
}

/**
 * Polls the supervisor runtime state file until `up` reports URLs and all
 * services running. The generous timeout covers the one-time
 * `bun run web:build` a clean checkout triggers before services start.
 */
async function waitForRuntimeReady(cli: SpawnedCli, dataDir: string): Promise<RuntimeStateFile> {
  const statePath = runtimeStateFilePath(dataDir);

  return waitFor(
    async () => {
      if (cli.exit !== null) {
        throw new Error(
          `greenroom up exited early (code ${cli.exit.code}, signal ${cli.exit.signal}). Output:\n${cli.output}`,
        );
      }

      const state = await readRuntimeStateFile(statePath);

      if (state === null || state.urls === null || state.urls.api === null) {
        return null;
      }

      const running = (name: ServiceName) =>
        state.services.some((service) => service.name === name && service.state === "running");

      return running("bridge") && running("api") && running("mcp") && running("web") ? state : null;
    },
    startupTimeoutMs,
    () => `greenroom up never became ready. Output:\n${cli.output}`,
  );
}

function createApiClient(apiBaseUrl: string, token: string) {
  async function request(
    path: string,
    init: RequestInit,
    expectedStatus: number,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
    const payload = (await response.json()) as unknown;

    if (response.status !== expectedStatus) {
      throw new Error(
        `${init.method ?? "GET"} ${path} answered ${response.status} (expected ${expectedStatus}): ${JSON.stringify(payload)}`,
      );
    }

    return payload;
  }

  return {
    get: (path: string, expectedStatus = 200) => request(path, {}, expectedStatus),
    post: (path: string, body?: unknown, expectedStatus = 201) =>
      request(
        path,
        {
          method: "POST",
          ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        },
        expectedStatus,
      ),
  };
}

function findFirstAddedLine(files: DiffFile[]): {
  file: DiffFile;
  line: DiffLine & { type: "addition"; newLineNumber: number };
} {
  for (const file of files) {
    for (const hunk of file.hunks) {
      const line = hunk.lines.find(
        (candidate): candidate is DiffLine & { type: "addition"; newLineNumber: number } =>
          candidate.type === "addition" && candidate.newLineNumber !== null,
      );

      if (line !== undefined) {
        return { file, line };
      }
    }
  }

  throw new Error("Fixture diff did not include an addition line");
}

async function createReviewRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);

  repository.writeFile("README.md", "# Fixture\n");
  await repository.stage();
  await repository.commit("Initial commit");
  await repository.checkout("feature/review", { create: true });
  repository.writeFile("src/index.ts", "export function answer() {\n  return 42;\n}\n");
  await repository.stage();
  await repository.commit("Add feature implementation");

  return repository;
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    // Negative pid signals the whole detached process group.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process exited between the liveness check and the signal.
    }
  }
}

async function waitFor<T>(
  probe: () => T | null | Promise<T | null>,
  timeoutMs: number,
  timeoutMessage: () => string,
  intervalMs = 250,
): Promise<T> {
  const startedAt = Date.now();

  for (;;) {
    const result = await probe();

    if (result !== null) {
      return result;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(timeoutMessage());
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
