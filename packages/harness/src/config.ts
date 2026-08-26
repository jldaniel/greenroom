import * as z from "zod";

const pathMappingSchema = z
  .object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  })
  .strict();

export interface HarnessPathMapping {
  from: string;
  to: string;
}

export interface HarnessBridgeConfig {
  host: string;
  port: number;
  token: string;
  /**
   * Directory where the bridge persists small state files such as detected
   * harness CLI versions. Null disables persistence; detection then
   * tracks versions in memory for the lifetime of the process.
   */
  stateDir: string | null;
  /**
   * Greenroom-managed tools directory (`<dataDir>/tools`). When set,
   * harness CLI detection probes managed installs (currently Pi at
   * `<toolsDir>/pi/node_modules/.bin/pi`) before the user PATH. Null limits
   * detection to the PATH.
   */
  toolsDir: string | null;
  defaultKind: string | null;
  enabledKinds: string[];
  command: string;
  args: string[];
  pathMappings: HarnessPathMapping[];
  envAllowlist: string[];
  maxStderrChars: number;
  maxStdoutChars: number;
  killGraceMs: number;
  defaultTimeoutMs: number;
  workspaceDir: string | null;
  workspaceStaleGraceMs: number;
  workspaceMaxActive: number;
  workspaceMaxBytes: number;
}

export function readHarnessBridgeConfig(
  env: Record<string, string | undefined> = process.env,
): HarnessBridgeConfig {
  return {
    host: nonEmpty(env.GREENROOM_HARNESS_HOST) ?? "127.0.0.1",
    port: parseIntegerEnv(env.GREENROOM_HARNESS_PORT, 49_343, 1, 65_535),
    token: nonEmpty(env.GREENROOM_HARNESS_TOKEN) ?? "",
    stateDir: nonEmpty(env.GREENROOM_HARNESS_STATE_DIR) ?? null,
    toolsDir: nonEmpty(env.GREENROOM_HARNESS_TOOLS_DIR) ?? null,
    defaultKind: nonEmpty(env.GREENROOM_HARNESS_KIND) ?? null,
    enabledKinds: parseEnabledKindsEnv(
      env.GREENROOM_HARNESS_ENABLED_KINDS,
      env.GREENROOM_HARNESS_KIND,
    ),
    command: nonEmpty(env.GREENROOM_HARNESS_COMMAND) ?? "",
    args: parseStringArrayEnv(env.GREENROOM_HARNESS_ARGS_JSON, []),
    pathMappings: parsePathMappingsEnv(env.GREENROOM_HARNESS_PATH_MAP_JSON),
    envAllowlist: parseCsvEnv(env.GREENROOM_HARNESS_ENV_ALLOWLIST),
    maxStderrChars: parseIntegerEnv(env.GREENROOM_HARNESS_MAX_STDERR_CHARS, 8000, 0, 65_000),
    maxStdoutChars: parseIntegerEnv(
      env.GREENROOM_HARNESS_MAX_STDOUT_CHARS,
      4_000_000,
      1000,
      16_000_000,
    ),
    killGraceMs: parseIntegerEnv(env.GREENROOM_HARNESS_KILL_GRACE_MS, 5000, 100, 60_000),
    defaultTimeoutMs: parseIntegerEnv(
      env.GREENROOM_HARNESS_TIMEOUT_MS,
      3_600_000,
      1000,
      86_400_000,
    ),
    workspaceDir: parseBooleanEnv(env.GREENROOM_HARNESS_SNAPSHOT_ENABLED, true)
      ? (nonEmpty(env.GREENROOM_HARNESS_WORKSPACE_DIR) ?? null)
      : null,
    workspaceStaleGraceMs: parseIntegerEnv(
      env.GREENROOM_HARNESS_WORKSPACE_STALE_GRACE_MS,
      24 * 60 * 60 * 1000,
      0,
      30 * 24 * 60 * 60 * 1000,
    ),
    workspaceMaxActive: parseIntegerEnv(env.GREENROOM_HARNESS_WORKSPACE_MAX_ACTIVE, 16, 1, 10_000),
    workspaceMaxBytes: parseIntegerEnv(
      env.GREENROOM_HARNESS_WORKSPACE_MAX_BYTES,
      5 * 1024 * 1024 * 1024,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function mapHarnessCwd(cwd: string, mappings: readonly HarnessPathMapping[]): string {
  const sorted = [...mappings].sort((left, right) => right.from.length - left.from.length);

  for (const mapping of sorted) {
    if (cwd === mapping.from) {
      return mapping.to;
    }

    if (cwd.startsWith(`${mapping.from}/`)) {
      return `${mapping.to}${cwd.slice(mapping.from.length)}`;
    }
  }

  return cwd;
}

export function substituteHarnessArg(
  arg: string,
  values: {
    schemaPath: string;
    schemaJson: string;
    promptPath: string;
    cwd: string;
    outputPath: string;
    mcpConfigPath: string | null;
    mcpUrl: string | null;
  },
): string {
  return arg
    .replaceAll("{schemaPath}", values.schemaPath)
    .replaceAll("{schemaJson}", values.schemaJson)
    .replaceAll("{promptPath}", values.promptPath)
    .replaceAll("{cwd}", values.cwd)
    .replaceAll("{outputPath}", values.outputPath)
    .replaceAll("{mcpConfigPath}", values.mcpConfigPath ?? "")
    .replaceAll("{mcpUrl}", values.mcpUrl ?? "");
}

export function buildHarnessSubprocessEnv(
  allowlist: readonly string[],
  env: Record<string, string | undefined> = process.env,
  injected: Record<string, string | undefined> = {},
): Record<string, string> {
  const forwarded = new Map<string, string>();
  const baseline = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL"];

  for (const name of [...baseline, ...allowlist]) {
    const value = env[name];

    if (value !== undefined) {
      forwarded.set(name, value);
    }
  }

  for (const [name, value] of Object.entries(injected)) {
    if (value !== undefined && value.length > 0) {
      forwarded.set(name, value);
    }
  }

  return Object.fromEntries(forwarded);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function parseIntegerEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer environment value: ${value}`);
  }

  return parsed;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean environment value: ${value}`);
}

function parseStringArrayEnv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return z.array(z.string()).parse(JSON.parse(value));
}

function parsePathMappingsEnv(value: string | undefined): HarnessPathMapping[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  return z.array(pathMappingSchema).parse(JSON.parse(value));
}

function parseEnabledKindsEnv(
  value: string | undefined,
  defaultKind: string | undefined,
): string[] {
  const explicit = parseCsvEnv(value);

  if (explicit.length > 0) {
    return uniqueStrings(explicit);
  }

  const fallback = nonEmpty(defaultKind);
  return fallback === undefined ? [] : [fallback];
}

function parseCsvEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
