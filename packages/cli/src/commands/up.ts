import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

import { createHarnessDetector, managedToolsDir } from "@greenroom/harness";
import type { HarnessBridgeDetectionResponse } from "@greenroom/schemas";
import {
  GreenroomRuntime,
  isProcessAlive,
  loopbackHost,
  readRuntimeStateFile,
  removeRuntimeStateFile,
  runtimeStateFilePath,
  writeRuntimeStateFile,
  type RuntimeConfig,
  type RuntimeStateFile,
  type ServiceStatus,
} from "@greenroom/supervisor";

import { expectNoPositionals, parseCommandArgs, readBooleanFlag, readStringFlag } from "../args";
import { resolveBunPath, resolveCliDataDir, resolveRepoRoot } from "../context";

const stateHeartbeatIntervalMs = 30_000;

export function upsertServiceStatus(
  services: readonly ServiceStatus[],
  status: ServiceStatus,
): ServiceStatus[] {
  const next = services.filter((service) => service.name !== status.name);
  next.push(status);
  return next;
}

/** How `greenroom up` serves the web app. */
export type WebServeMode =
  | { kind: "dev" }
  | { kind: "static"; distDir: string; needsBuild: boolean };

export function webDistDirFor(repoRoot: string): string {
  return join(repoRoot, "apps", "web", "dist");
}

export function webSourcePathsFor(repoRoot: string): string[] {
  const webRoot = join(repoRoot, "apps", "web");

  return [
    join(webRoot, "index.html"),
    join(webRoot, "package.json"),
    join(webRoot, "public"),
    join(webRoot, "src"),
    join(webRoot, "vite.config.ts"),
  ];
}

export function webBuildIsStale(options: {
  builtIndexPath: string;
  sourcePaths: readonly string[];
}): boolean {
  const builtAt = mtimeMs(options.builtIndexPath);

  if (builtAt === null) {
    return true;
  }

  return options.sourcePaths.some((path) => latestMtimeMs(path) > builtAt);
}

function latestMtimeMs(path: string): number {
  const stat = safeStat(path);

  if (stat === null) {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  return readdirSync(path, { withFileTypes: true }).reduce((latest, entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") {
      return latest;
    }

    return Math.max(latest, latestMtimeMs(join(path, entry.name)));
  }, stat.mtimeMs);
}

function mtimeMs(path: string): number | null {
  return safeStat(path)?.mtimeMs ?? null;
}

function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Mode selection for the web app: `--dev` keeps the Vite dev server
 * with HMR; the default serves the built SPA statically from the API process,
 * building it first when no build output exists yet or when the source files
 * are newer than `dist/index.html`.
 */
export function resolveWebServeMode(options: {
  dev: boolean;
  distDir: string;
  buildIsStale: boolean;
}): WebServeMode {
  if (options.dev) {
    return { kind: "dev" };
  }

  return { kind: "static", distDir: options.distDir, needsBuild: options.buildIsStale };
}

/**
 * Synthetic status row for the web app in static mode: there is no separate
 * web process (the API serves the build), but `status` readers still expect
 * an answer for "where is the web UI?".
 */
export function staticWebServiceStatus(url: string, startedAt: string): ServiceStatus {
  return {
    name: "web",
    state: "running",
    url,
    pid: null,
    startedAt,
    stoppedAt: null,
    exitCode: null,
    signal: null,
    message: "static (served by api)",
  };
}

/**
 * Human-readable harness bridge line for the `up` summary. A supervised
 * bridge has a port; an external one (GREENROOM_HARNESS_BASE_URL set in the
 * environment) keeps the user's URL; an empty base URL disables the bridge.
 */
export function describeBridge(config: {
  bridgeBaseUrl: string | null;
  ports: { bridge: number | null };
}): string {
  if (config.ports.bridge !== null && config.bridgeBaseUrl !== null) {
    return `${config.bridgeBaseUrl} (harness bridge, supervised)`;
  }

  if (config.bridgeBaseUrl !== null) {
    return `${config.bridgeBaseUrl} (external, from GREENROOM_HARNESS_BASE_URL)`;
  }

  return "disabled (GREENROOM_HARNESS_BASE_URL is empty)";
}

/**
 * One-line hint for `greenroom up` when harness CLI detection finds nothing:
 * suggests the managed Pi install without blocking or prompting
 * mid-supervision. Returns null when at least one harness CLI was found.
 */
export function noHarnessDetectedHint(detection: HarnessBridgeDetectionResponse): string | null {
  if (detection.harnesses.some((harness) => harness.found)) {
    return null;
  }

  const labels = detection.harnesses.map((harness) => harness.label).join(", ");
  return `No harness CLI detected${labels.length === 0 ? "" : ` (${labels})`}; API-key users can run \`greenroom harness install-pi\` to set up the managed Pi fallback.`;
}

/**
 * Probes harness CLIs the same way the bridge does (managed tools dir first
 * for Pi, then PATH) and prints the install hint when nothing is found.
 * Fire-and-forget: never blocks startup and never throws.
 */
async function printNoHarnessHint(dataDir: string): Promise<void> {
  try {
    const detector = createHarnessDetector({
      stateDir: null,
      toolsDir: managedToolsDir(dataDir),
      env: process.env,
    });
    const hint = noHarnessDetectedHint(await detector.probe());

    if (hint !== null) {
      console.log(hint);
    }
  } catch {
    // Detection is advisory; startup output must not fail because of it.
  }
}

async function buildWebApp(bunPath: string, repoRoot: string): Promise<boolean> {
  const child = Bun.spawn([bunPath, "run", "--cwd", join(repoRoot, "apps", "web"), "build"], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });

  return (await child.exited) === 0;
}

/**
 * `greenroom up`: starts the harness bridge, API, and MCP services under the
 * shared GreenroomRuntime supervisor (which also bootstraps the API token and
 * the shared bridge token), writes the runtime state file for `down`/`status`
 * and the API status endpoint, prints the web UI URL, and stays in the
 * foreground until Ctrl-C.
 *
 * By default the built web app is served statically by the API process
 * (same-origin `/api`, one URL); `--dev` spawns the Vite dev server with HMR
 * instead.
 */
export async function runUp(args: readonly string[]): Promise<number> {
  const parsed = parseCommandArgs(args, {
    "data-dir": "string",
    dev: "boolean",
    host: "string",
    verbose: "boolean",
  });
  expectNoPositionals(parsed, "up");

  const env = process.env;
  const verbose = readBooleanFlag(parsed, "verbose");
  const dataDir = resolveCliDataDir(readStringFlag(parsed, "data-dir"), env);
  const host = readStringFlag(parsed, "host") ?? loopbackHost;
  const repoRoot = resolveRepoRoot(env);
  const bunPath = resolveBunPath(env);
  const distDir = webDistDirFor(repoRoot);
  const builtIndexPath = join(distDir, "index.html");
  const webMode = resolveWebServeMode({
    dev: readBooleanFlag(parsed, "dev"),
    distDir,
    buildIsStale: webBuildIsStale({
      builtIndexPath,
      sourcePaths: webSourcePathsFor(repoRoot),
    }),
  });
  const statePath = runtimeStateFilePath(dataDir);
  const existing = await readRuntimeStateFile(statePath);

  if (existing !== null && isProcessAlive(existing.supervisorPid)) {
    console.error(
      `Greenroom is already running (supervisor pid ${existing.supervisorPid}, data dir ${existing.dataDir}).`,
    );
    console.error("Run `greenroom down` first, or use --data-dir for a separate instance.");
    return 1;
  }

  if (webMode.kind === "static" && webMode.needsBuild) {
    const reason = existsSync(builtIndexPath) ? "Web build is stale" : "No web build found";
    console.log(`${reason}; running \`bun run web:build\` once...`);

    if (!(await buildWebApp(bunPath, repoRoot))) {
      console.error("Web build failed; fix the build or start with `greenroom up --dev`.");
      return 1;
    }
  }

  const runtime = new GreenroomRuntime({
    appDataDir: dataDir,
    bunPath,
    devMode: webMode.kind === "dev",
    env,
    host,
    repoRoot,
    webDistDir: webMode.kind === "static" ? webMode.distDir : null,
  });

  const startedAt = new Date().toISOString();
  const state: RuntimeStateFile = {
    version: 1,
    supervisorPid: process.pid,
    startedAt,
    updatedAt: startedAt,
    dataDir,
    host,
    ports: null,
    urls: null,
    services: [],
  };

  // Serialize state-file writes so status events never interleave.
  let writeQueue: Promise<void> = Promise.resolve();
  const persistState = (): Promise<void> => {
    state.updatedAt = new Date().toISOString();
    const snapshot: RuntimeStateFile = { ...state, services: [...state.services] };
    writeQueue = writeQueue
      .then(() => writeRuntimeStateFile(statePath, snapshot))
      .catch((error: unknown) => {
        console.error(
          `Unable to write runtime state file: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return writeQueue;
  };

  runtime.onStatus((status) => {
    state.services = upsertServiceStatus(state.services, status);
    void persistState();
    const suffix = status.message === null ? "" : ` (${status.message})`;
    console.log(`  ${status.name}: ${status.state}${suffix}`);
  });
  runtime.onLog((entry) => {
    if (verbose) {
      console.log(`[${entry.service}] ${entry.message}`);
    }
  });

  console.log(`Starting Greenroom services (data dir ${dataDir})...`);
  await persistState();

  let config: RuntimeConfig;

  try {
    config = await runtime.start();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to start Greenroom services");
    await writeQueue;
    await removeRuntimeStateFile(statePath);
    return 1;
  }

  state.host = config.host;
  state.ports = {
    api: config.ports.api,
    bridge: config.ports.bridge,
    mcp: config.ports.mcp,
    web: config.ports.web,
  };
  state.urls = {
    api: config.apiBaseUrl,
    bridge: config.bridgeBaseUrl,
    mcp: config.mcpUrl,
    web: config.rendererUrl,
  };

  if (webMode.kind === "static") {
    // No separate web process in static mode; record a synthetic entry so
    // `status` and the runtime-status endpoint still answer for the web UI.
    state.services = upsertServiceStatus(
      state.services,
      staticWebServiceStatus(config.rendererUrl, startedAt),
    );
  }

  await persistState();

  const webSuffix = webMode.kind === "static" ? " (static, served by the API)" : " (Vite dev)";

  console.log("");
  console.log(`Greenroom is running: ${config.rendererUrl}`);
  console.log("");
  console.log(`  Web UI:   ${config.rendererUrl}${webSuffix}`);
  console.log(`  API:      ${config.apiBaseUrl}`);
  console.log(`  MCP:      ${config.mcpUrl}`);
  console.log(`  Bridge:   ${describeBridge(config)}`);
  console.log(`  Data dir: ${config.dataDir}`);
  console.log("");
  console.log("Press Ctrl-C to stop.");

  // Advisory harness check: when no harness CLI is installed, print
  // a one-line pointer at the managed Pi fallback without blocking.
  void printNoHarnessHint(dataDir);

  // Heartbeat keeps updatedAt fresh so readers can spot stale state files.
  const heartbeat = setInterval(() => {
    void persistState();
  }, stateHeartbeatIntervalMs);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(heartbeat);
    console.log(`\nReceived ${signal}; stopping Greenroom services...`);
    void runtime
      .stop()
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Unable to stop Greenroom services");
      })
      .then(async () => {
        await writeQueue;
        await removeRuntimeStateFile(statePath);
        console.log("Greenroom stopped.");
        process.exit(0);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Stay in the foreground supervising; the process exits via shutdown().
  return new Promise<number>(() => {});
}
