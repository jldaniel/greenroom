import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

import {
  harnessBridgeDetectionResponseSchema,
  harnessDetectedCliSchema,
  listKnownHarnessKindDescriptors,
  type HarnessBridgeDetectionResponse,
  type HarnessDetectedCli,
} from "@greenroom/schemas";

import { buildHarnessSubprocessEnv } from "./config";
import { managedPiBinaryPath } from "./pi-install";

/**
 * Harness CLI detection.
 *
 * At bridge startup (and on demand through `GET /harnesses`) the bridge probes
 * for installed harness CLIs — the same binary names the harness kind presets
 * invoke (`claude` for claude-code, `codex` for codex), resolved against the
 * same PATH the bridge forwards to spawned harness processes — and records the
 * resolved path, version string, and probe timestamp.
 *
 * The last verified version per kind is persisted to
 * `<stateDir>/harness-versions.json`. The first time a CLI is seen, its
 * version becomes the baseline. When a later probe detects a different
 * version, the detection payload flags `recommendSmoke: true` together with
 * the old (`lastVerifiedVersion`) and new (`version`) values until a
 * successful smoke run is recorded via `recordSmoke`.
 */

export interface HarnessCliProbeSpec {
  kind: string;
  label: string;
  /** Candidate binary names/paths; the first one found on PATH wins. */
  commands: string[];
  versionArgs: string[];
}

export interface HarnessDetectorOptions {
  /** Directory for the persisted version state file; null keeps state in memory. */
  stateDir?: string | null;
  /**
   * Greenroom-managed tools directory. When set, the default probe
   * specs check managed installs (Pi) ahead of the user PATH. Ignored when
   * explicit probeSpecs are provided.
   */
  toolsDir?: string | null;
  env?: Record<string, string | undefined>;
  probeSpecs?: HarnessCliProbeSpec[];
  probeTimeoutMs?: number;
  now?: () => Date;
}

export interface HarnessDetector {
  /** Runs all probes, updates persisted state, and caches the snapshot. */
  probe: () => Promise<HarnessBridgeDetectionResponse>;
  /** Returns the cached snapshot, probing first when none exists yet. */
  snapshot: () => Promise<HarnessBridgeDetectionResponse>;
  /**
   * Marks the currently detected version of a kind as smoke-verified, which
   * clears `recommendSmoke` until the version changes again. Returns the
   * updated entry, or null for unknown kinds.
   */
  recordSmoke: (kind: string) => Promise<HarnessDetectedCli | null>;
}

const stateFileName = "harness-versions.json";
const defaultProbeTimeoutMs = 5000;
const maxVersionChars = 400;

interface StoredHarnessVersion {
  verifiedVersion: string | null;
  verifiedAt: string | null;
  verifiedBy: "baseline" | "smoke" | null;
  lastDetectedVersion: string | null;
  lastDetectedAt: string | null;
}

interface HarnessVersionState {
  version: 1;
  harnesses: Record<string, StoredHarnessVersion>;
}

export interface DefaultHarnessCliProbeSpecOptions {
  /**
   * Greenroom-managed tools directory (`<dataDir>/tools`). When set,
   * the `pi` kind probes the managed binary
   * (`<toolsDir>/pi/node_modules/.bin/pi`) before falling back to `pi` on the
   * user PATH, so a Greenroom-managed Pi install is detected without PATH
   * changes.
   */
  toolsDir?: string | null;
}

export function defaultHarnessCliProbeSpecs(
  options: DefaultHarnessCliProbeSpecOptions = {},
): HarnessCliProbeSpec[] {
  const toolsDir = options.toolsDir ?? null;

  return listKnownHarnessKindDescriptors().map((descriptor) => ({
    kind: descriptor.kind,
    label: descriptor.label,
    commands:
      descriptor.kind === "pi" && toolsDir !== null
        ? [managedPiBinaryPath(toolsDir), ...descriptor.cli.commands]
        : [...descriptor.cli.commands],
    versionArgs: [...descriptor.cli.versionArgs],
  }));
}

export function createHarnessDetector(options: HarnessDetectorOptions = {}): HarnessDetector {
  const stateDir = options.stateDir ?? null;
  const env = options.env ?? process.env;
  const probeSpecs =
    options.probeSpecs ?? defaultHarnessCliProbeSpecs({ toolsDir: options.toolsDir ?? null });
  const probeTimeoutMs = options.probeTimeoutMs ?? defaultProbeTimeoutMs;
  const now = options.now ?? (() => new Date());

  let cached: HarnessBridgeDetectionResponse | null = null;
  let memoryState: HarnessVersionState | null = null;
  // Serializes probe/recordSmoke so concurrent requests cannot interleave
  // state file read-modify-write cycles.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function readState(): Promise<HarnessVersionState> {
    if (stateDir === null) {
      memoryState = memoryState ?? { version: 1, harnesses: {} };
      return memoryState;
    }

    try {
      const raw = JSON.parse(await readFile(join(stateDir, stateFileName), "utf8")) as unknown;
      return normalizeState(raw);
    } catch {
      // Missing or corrupt state files reset detection tracking instead of
      // crashing the bridge.
      return { version: 1, harnesses: {} };
    }
  }

  async function writeState(state: HarnessVersionState): Promise<void> {
    if (stateDir === null) {
      memoryState = state;
      return;
    }

    try {
      await mkdir(stateDir, { recursive: true });
      const target = join(stateDir, stateFileName);
      const temp = `${target}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temp, target);
    } catch (error) {
      // Persistence is best-effort; detection keeps working without it.
      console.warn(
        `Harness detection state could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function probeAndRecord(): Promise<HarnessBridgeDetectionResponse> {
    const state = await readState();
    const probedAt = now().toISOString();
    const harnesses: HarnessDetectedCli[] = [];

    for (const spec of probeSpecs) {
      const result = await probeHarnessCli(spec, env, probeTimeoutMs);
      const entry = state.harnesses[spec.kind] ?? emptyStoredVersion();

      if (result.found && result.version !== null) {
        if (entry.verifiedVersion === null) {
          // First sighting: the current version becomes the baseline, so a
          // fresh install does not immediately demand a smoke run.
          entry.verifiedVersion = result.version;
          entry.verifiedAt = probedAt;
          entry.verifiedBy = "baseline";
        }

        entry.lastDetectedVersion = result.version;
        entry.lastDetectedAt = probedAt;
      }

      state.harnesses[spec.kind] = entry;
      harnesses.push(
        detectedEntry({
          spec,
          result,
          stored: entry,
          probedAt,
        }),
      );
    }

    await writeState(state);
    cached = harnessBridgeDetectionResponseSchema.parse({ probedAt, harnesses });
    return cached;
  }

  return {
    probe() {
      return enqueue(probeAndRecord);
    },
    snapshot() {
      return enqueue(async () => cached ?? probeAndRecord());
    },
    recordSmoke(kind) {
      return enqueue(async () => {
        const spec = probeSpecs.find((candidate) => candidate.kind === kind);

        if (spec === undefined) {
          return null;
        }

        const state = await readState();
        const probedAt = now().toISOString();
        const result = await probeHarnessCli(spec, env, probeTimeoutMs);
        const entry = state.harnesses[kind] ?? emptyStoredVersion();

        if (result.found && result.version !== null) {
          entry.verifiedVersion = result.version;
          entry.verifiedAt = probedAt;
          entry.verifiedBy = "smoke";
          entry.lastDetectedVersion = result.version;
          entry.lastDetectedAt = probedAt;
        }

        state.harnesses[kind] = entry;
        await writeState(state);

        const detected = detectedEntry({ spec, result, stored: entry, probedAt });

        if (cached !== null) {
          cached = harnessBridgeDetectionResponseSchema.parse({
            probedAt: cached.probedAt,
            harnesses: cached.harnesses.map((candidate) =>
              candidate.kind === kind ? detected : candidate,
            ),
          });
        }

        return detected;
      });
    },
  };
}

interface HarnessCliProbeResult {
  command: string;
  found: boolean;
  path: string | null;
  version: string | null;
  message: string | null;
}

/**
 * Probes one harness CLI: resolves the binary the same way spawning does
 * (PATH walk with the forwarded bridge PATH) and runs its version command with
 * a short timeout. Missing binary, non-zero exit, timeout, or spawn errors all
 * report `found: false` — probing never throws.
 */
export async function probeHarnessCli(
  spec: HarnessCliProbeSpec,
  env: Record<string, string | undefined> = process.env,
  timeoutMs: number = defaultProbeTimeoutMs,
): Promise<HarnessCliProbeResult> {
  const primaryCommand = spec.commands[0] ?? spec.kind;

  try {
    for (const command of spec.commands) {
      const resolvedPath = await resolveCliCommandPath(command, env);

      if (resolvedPath === null) {
        continue;
      }

      const versionResult = await runVersionCommand(resolvedPath, spec.versionArgs, env, timeoutMs);

      if (!versionResult.ok) {
        return {
          command,
          found: false,
          path: resolvedPath,
          version: null,
          message: versionResult.message,
        };
      }

      return {
        command,
        found: true,
        path: resolvedPath,
        version: versionResult.version,
        message: null,
      };
    }

    return {
      command: primaryCommand,
      found: false,
      path: null,
      version: null,
      message: `${spec.label} CLI (${spec.commands.join(", ")}) was not found on PATH.`,
    };
  } catch (error) {
    return {
      command: primaryCommand,
      found: false,
      path: null,
      version: null,
      message: `${spec.label} CLI probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

type VersionCommandResult = { ok: true; version: string | null } | { ok: false; message: string };

async function runVersionCommand(
  commandPath: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<VersionCommandResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn({
      cmd: [commandPath, ...args],
      env: buildHarnessSubprocessEnv([], env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      ok: false,
      message: `Version command could not start: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const stdoutPromise = readStreamText(proc.stdout);
  const stderrPromise = readStreamText(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
  });

  try {
    const exit = await Promise.race([proc.exited, timeout]);

    if (exit === "timeout") {
      proc.kill();
      return { ok: false, message: `Version command timed out after ${timeoutMs}ms.` };
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (exit !== 0) {
      const detail = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout);
      return {
        ok: false,
        message: `Version command exited with status ${exit}${detail === null ? "." : `: ${detail.slice(0, 400)}`}`,
      };
    }

    const version = firstNonEmptyLine(stdout) ?? firstNonEmptyLine(stderr);
    return { ok: true, version: version === null ? null : version.slice(0, maxVersionChars) };
  } catch (error) {
    return {
      ok: false,
      message: `Version command failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

async function readStreamText(stream: ReadableStream<Uint8Array> | number | undefined | null) {
  if (stream === undefined || stream === null || typeof stream === "number") {
    return "";
  }

  try {
    return await new Response(stream).text();
  } catch {
    return "";
  }
}

async function resolveCliCommandPath(
  command: string,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  if (isPathLikeCommand(command)) {
    const candidate = isAbsolute(command) ? command : resolve(command);
    return (await canExecute(candidate)) ? candidate : null;
  }

  for (const directory of pathEntries(env.PATH)) {
    const candidate = join(directory, command);

    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathEntries(pathValue: string | undefined): string[] {
  if (pathValue === undefined || pathValue.trim().length === 0) {
    return [];
  }

  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isPathLikeCommand(command: string): boolean {
  return isAbsolute(command) || command.includes("/") || command.includes(sep);
}

function firstNonEmptyLine(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

function emptyStoredVersion(): StoredHarnessVersion {
  return {
    verifiedVersion: null,
    verifiedAt: null,
    verifiedBy: null,
    lastDetectedVersion: null,
    lastDetectedAt: null,
  };
}

function detectedEntry(input: {
  spec: HarnessCliProbeSpec;
  result: HarnessCliProbeResult;
  stored: StoredHarnessVersion;
  probedAt: string;
}): HarnessDetectedCli {
  const { spec, result, stored, probedAt } = input;
  const recommendSmoke =
    result.found &&
    result.version !== null &&
    stored.verifiedVersion !== null &&
    result.version !== stored.verifiedVersion;

  return harnessDetectedCliSchema.parse({
    kind: spec.kind,
    label: spec.label,
    command: result.command,
    found: result.found,
    path: result.path,
    version: result.version,
    lastVerifiedVersion: stored.verifiedVersion,
    recommendSmoke,
    probedAt,
    message: result.message,
  });
}

function normalizeState(raw: unknown): HarnessVersionState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { version: 1, harnesses: {} };
  }

  const harnessesRaw = (raw as { harnesses?: unknown }).harnesses;
  const harnesses: Record<string, StoredHarnessVersion> = {};

  if (typeof harnessesRaw === "object" && harnessesRaw !== null && !Array.isArray(harnessesRaw)) {
    for (const [kind, value] of Object.entries(harnessesRaw)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }

      const entry = value as Partial<StoredHarnessVersion>;
      harnesses[kind] = {
        verifiedVersion: nonEmptyOrNull(entry.verifiedVersion),
        verifiedAt: nonEmptyOrNull(entry.verifiedAt),
        verifiedBy:
          entry.verifiedBy === "baseline" || entry.verifiedBy === "smoke" ? entry.verifiedBy : null,
        lastDetectedVersion: nonEmptyOrNull(entry.lastDetectedVersion),
        lastDetectedAt: nonEmptyOrNull(entry.lastDetectedAt),
      };
    }
  }

  return { version: 1, harnesses };
}

function nonEmptyOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
