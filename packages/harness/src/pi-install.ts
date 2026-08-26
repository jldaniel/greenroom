import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { piNpmPackageName, piNpmPinnedVersion } from "@greenroom/schemas";

/**
 * Managed host-side Pi install.
 *
 * Greenroom installs the pinned Pi coding agent CLI
 * ({@link piNpmPackageName}@{@link piNpmPinnedVersion}) into a
 * Greenroom-managed directory — `<dataDir>/tools/pi` — via `bun add`, so
 * API-key users without a harness get a working `pi` binary without touching
 * their global environment. Detection (detect.ts) probes the managed binary
 * path first and falls back to `pi` on the user's PATH.
 *
 * Note for other packages: the server mirrors {@link managedPiBinaryPath}
 * without importing this module (apps/server/src/api/harness-client.ts); keep
 * the layout in sync when changing it.
 */

export { piNpmPackageName, piNpmPinnedVersion };

/** Managed tools directory for a Greenroom data dir (`<dataDir>/tools`). */
export function managedToolsDir(dataDir: string): string {
  return join(dataDir, "tools");
}

/** Root of the managed Pi install (`<toolsDir>/pi`). */
export function managedPiRootDir(toolsDir: string): string {
  return join(toolsDir, "pi");
}

/** Binary path inside a managed Pi install (`<toolsDir>/pi/node_modules/.bin/pi`). */
export function managedPiBinaryPath(toolsDir: string): string {
  return join(managedPiRootDir(toolsDir), "node_modules", ".bin", "pi");
}

export interface InstallManagedPiOptions {
  /** Managed tools directory, typically `<dataDir>/tools`. */
  toolsDir: string;
  /** Bun executable used for the install; defaults to the running Bun. */
  bunPath?: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** Install timeout; the npm download can be slow on first run. */
  timeoutMs?: number;
}

export interface InstallManagedPiResult {
  packageName: string;
  pinnedVersion: string;
  rootDir: string;
  binaryPath: string;
  /** Version reported by the installed binary (`pi --version`). */
  version: string;
}

const defaultInstallTimeoutMs = 300_000;

/**
 * Installs the pinned Pi version into the managed directory and verifies the
 * resulting binary runs and reports the pinned version. Idempotent: re-running
 * refreshes the install in place. Exported so the first-run wizard
 * can reuse the same path programmatically.
 */
export async function installManagedPi(
  options: InstallManagedPiOptions,
): Promise<InstallManagedPiResult> {
  const bunPath = options.bunPath ?? process.execPath;
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? defaultInstallTimeoutMs;
  const rootDir = managedPiRootDir(options.toolsDir);
  const binaryPath = managedPiBinaryPath(options.toolsDir);

  await mkdir(rootDir, { recursive: true });
  await ensureManifest(rootDir);

  log(`Installing ${piNpmPackageName}@${piNpmPinnedVersion} into ${rootDir}...`);
  await runInstallCommand(
    bunPath,
    ["add", "--exact", `${piNpmPackageName}@${piNpmPinnedVersion}`],
    rootDir,
    env,
    timeoutMs,
  );

  const version = await readBinaryVersion(binaryPath, env);

  if (!version.startsWith(piNpmPinnedVersion)) {
    throw new Error(
      `Managed Pi install reported version ${version}, expected ${piNpmPinnedVersion}`,
    );
  }

  return {
    packageName: piNpmPackageName,
    pinnedVersion: piNpmPinnedVersion,
    rootDir,
    binaryPath,
    version,
  };
}

/**
 * `bun add` needs a manifest to scope the dependency to the managed dir;
 * an existing manifest is kept so the recorded dependency survives re-runs.
 */
async function ensureManifest(rootDir: string): Promise<void> {
  const manifestPath = join(rootDir, "package.json");

  try {
    await access(manifestPath, constants.F_OK);
  } catch {
    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: "greenroom-managed-pi", private: true, version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
  }
}

async function runInstallCommand(
  bunPath: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<void> {
  const proc = Bun.spawn({
    cmd: [bunPath, ...args],
    cwd,
    env: sanitizedEnv(env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrPromise = new Response(proc.stderr).text();
  const exit = await withTimeout(proc.exited, timeoutMs, () => proc.kill());

  if (exit === "timeout") {
    throw new Error(`Pi install timed out after ${timeoutMs}ms`);
  }

  if (exit !== 0) {
    const stderr = (await stderrPromise).trim();
    throw new Error(
      `Pi install failed (bun ${args.join(" ")} exited with status ${exit})${
        stderr.length === 0 ? "" : `: ${stderr.slice(0, 2000)}`
      }`,
    );
  }
}

async function readBinaryVersion(
  binaryPath: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  try {
    await access(binaryPath, constants.X_OK);
  } catch {
    throw new Error(`Managed Pi binary is missing or not executable at ${binaryPath}`);
  }

  const proc = Bun.spawn({
    cmd: [binaryPath, "--version"],
    env: sanitizedEnv(env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exit = await withTimeout(proc.exited, 15_000, () => proc.kill());

  if (exit !== 0) {
    throw new Error(`Managed Pi binary at ${binaryPath} failed to report a version`);
  }

  // pi prints its version to stderr when stdout is not a TTY, so check both
  // streams (detect.ts does the same for probe version commands).
  const version = firstNonEmptyLine(await stdoutPromise) ?? firstNonEmptyLine(await stderrPromise);

  if (version === null) {
    throw new Error(`Managed Pi binary at ${binaryPath} reported an empty version`);
  }

  return version;
}

function firstNonEmptyLine(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

async function withTimeout(
  exited: Promise<number>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<number | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const result = await Promise.race([exited, timeout]);

    if (result === "timeout") {
      onTimeout();
    }

    return result;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function sanitizedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      entries[name] = value;
    }
  }

  return entries;
}
