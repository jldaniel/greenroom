import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as z from "zod";

import {
  GreenroomConfigFileError,
  parseGreenroomConfigFile,
  readGreenroomConfigFile,
  resolveConfigFilePath,
  serializeGreenroomConfigFile,
  validateGreenroomConfigFileData,
  type GreenroomConfigFile,
} from "../config/file";
import type { GreenroomEnvironment } from "../config/paths";

/**
 * Config-file API: the Settings UI reads and writes the
 * editable, non-secret subset of `greenroom.toml` through these helpers.
 *
 * The environment passed here must be the *raw* process environment, not the
 * resolved environment produced by `loadGreenroomEnvironment` (which overlays
 * file values onto unset env vars). Override detection compares the file
 * against actually exported env vars so the UI can warn that a file edit will
 * not take effect until the env var is unset.
 *
 * Secrets never round-trip: the bridge token is only ever referenced with
 * `tokenEnv`/`tokenFile`, the strict file schema rejects an inline `token`
 * key, and the `bridge.token` key status never carries the env var's value.
 */

export const configFileUpdateRequestSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ConfigValueSource = "env" | "file" | "default";

export interface ConfigFileKeyStatus {
  /** Dotted config-file key, for example `server.port`. */
  key: string;
  /** Environment variable that overrides the file value when set. */
  envVar: string;
  /** Where the effective value comes from at boot. */
  source: ConfigValueSource;
  /** Secret-bearing keys never expose the env var's value. */
  secret: boolean;
  /** Value currently persisted in the file, or null when unset. */
  fileValue: string | number | boolean | readonly string[] | null;
  /** Raw env var value when it overrides the file; always null for secrets. */
  envValue: string | null;
}

export interface ConfigFileValidationIssue {
  path: string;
  message: string;
}

export interface ConfigFileResource {
  /** Resolved config file path, whether or not the file exists. */
  path: string;
  exists: boolean;
  /** Parsed file contents; empty object when the file is missing or invalid. */
  config: GreenroomConfigFile;
  /** Per-key problems when the on-disk file cannot be parsed. */
  fileError: { issues: ConfigFileValidationIssue[] } | null;
  /** Editable keys with env-override and effective-source context. */
  keys: ConfigFileKeyStatus[];
}

interface EditableKeySpec {
  key: string;
  envVar: string;
  secret?: boolean;
  /** Any set env value counts as an override, even an empty string. */
  envSetWhenEmpty?: boolean;
  fileValue: (
    file: GreenroomConfigFile,
  ) => string | number | boolean | readonly string[] | undefined;
}

const editableKeySpecs: readonly EditableKeySpec[] = [
  { key: "server.host", envVar: "GREENROOM_HOST", fileValue: (file) => file.server?.host },
  { key: "server.port", envVar: "GREENROOM_PORT", fileValue: (file) => file.server?.port },
  {
    key: "server.logLevel",
    envVar: "GREENROOM_LOG_LEVEL",
    fileValue: (file) => file.server?.logLevel,
  },
  {
    key: "server.allowedOrigins",
    envVar: "GREENROOM_ALLOWED_ORIGINS",
    fileValue: (file) => file.server?.allowedOrigins,
  },
  {
    key: "server.setupTokenEndpoint",
    envVar: "GREENROOM_SETUP_TOKEN_ENDPOINT",
    fileValue: (file) => file.server?.setupTokenEndpoint,
  },
  {
    key: "server.databasePath",
    envVar: "GREENROOM_DB_PATH",
    fileValue: (file) => file.server?.databasePath,
  },
  {
    key: "server.webDist",
    envVar: "GREENROOM_WEB_DIST",
    fileValue: (file) => file.server?.webDist,
  },
  { key: "mcp.host", envVar: "GREENROOM_MCP_HOST", fileValue: (file) => file.mcp?.host },
  { key: "mcp.port", envVar: "GREENROOM_MCP_PORT", fileValue: (file) => file.mcp?.port },
  {
    key: "bridge.baseUrl",
    envVar: "GREENROOM_HARNESS_BASE_URL",
    // An empty GREENROOM_HARNESS_BASE_URL explicitly disables the bridge and
    // wins over the file, so any set value counts as an override.
    envSetWhenEmpty: true,
    fileValue: (file) => file.bridge?.baseUrl,
  },
  {
    key: "bridge.token",
    envVar: "GREENROOM_HARNESS_TOKEN",
    secret: true,
    fileValue: (file) =>
      file.bridge?.tokenEnv !== undefined
        ? `env:${file.bridge.tokenEnv}`
        : file.bridge?.tokenFile !== undefined
          ? `file:${file.bridge.tokenFile}`
          : undefined,
  },
  {
    key: "bridge.timeoutMs",
    envVar: "GREENROOM_HARNESS_TIMEOUT_MS",
    fileValue: (file) => file.bridge?.timeoutMs,
  },
  {
    key: "pathMaps",
    envVar: "GREENROOM_HARNESS_PATH_MAP_JSON",
    fileValue: (file) => file.pathMaps?.map((pathMap) => `${pathMap.from} -> ${pathMap.to}`),
  },
  {
    key: "workflows.maxConcurrentRuns",
    envVar: "GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS",
    fileValue: (file) => file.workflows?.maxConcurrentRuns,
  },
  {
    key: "workflows.idleTimeoutMs",
    envVar: "GREENROOM_WORKFLOW_IDLE_TIMEOUT_MS",
    fileValue: (file) => file.workflows?.idleTimeoutMs,
  },
  {
    key: "workflows.absoluteTimeoutMs",
    envVar: "GREENROOM_WORKFLOW_ABSOLUTE_TIMEOUT_MS",
    fileValue: (file) => file.workflows?.absoluteTimeoutMs,
  },
  {
    key: "workflows.maxMcpResourceReads",
    envVar: "GREENROOM_WORKFLOW_MAX_MCP_RESOURCE_READS",
    fileValue: (file) => file.workflows?.maxMcpResourceReads,
  },
  {
    key: "workflows.maxRepairAttempts",
    envVar: "GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS",
    fileValue: (file) => file.workflows?.maxRepairAttempts,
  },
  {
    key: "observability.tracingEnabled",
    envVar: "GREENROOM_TRACING_ENABLED",
    fileValue: (file) => file.observability?.tracingEnabled,
  },
  {
    key: "observability.otlpEndpoint",
    envVar: "GREENROOM_OTLP_ENDPOINT",
    fileValue: (file) => file.observability?.otlpEndpoint,
  },
  {
    key: "observability.serviceName",
    envVar: "GREENROOM_TRACING_SERVICE_NAME",
    fileValue: (file) => file.observability?.serviceName,
  },
  {
    key: "observability.langchainTracingEnabled",
    envVar: "GREENROOM_LANGCHAIN_TRACING_ENABLED",
    fileValue: (file) => file.observability?.langchainTracingEnabled,
  },
  {
    key: "observability.workflowLogsEnabled",
    envVar: "GREENROOM_WORKFLOW_LOGS_ENABLED",
    fileValue: (file) => file.observability?.workflowLogsEnabled,
  },
  {
    key: "observability.workflowLogPath",
    envVar: "GREENROOM_WORKFLOW_LOG_PATH",
    fileValue: (file) => file.observability?.workflowLogPath,
  },
];

/**
 * Reads the current config file plus read-only context: the file path, and
 * per-key effective-value sources so the UI can warn when an env var override
 * makes a file edit ineffective. An invalid on-disk file is reported through
 * `fileError` instead of failing, so the Settings UI can overwrite it.
 */
export function readConfigFileResource(env: GreenroomEnvironment): ConfigFileResource {
  const path = resolveConfigFilePath(env);
  let file: GreenroomConfigFile | null = null;
  let exists: boolean;
  let fileError: ConfigFileResource["fileError"] = null;

  try {
    const read = readGreenroomConfigFile(env);
    file = read.file;
    exists = read.file !== null;
  } catch (error) {
    if (!(error instanceof GreenroomConfigFileError)) {
      throw error;
    }

    exists = true;
    fileError = {
      issues: error.issues.map((issue) => ({ path: issue.key, message: issue.message })),
    };
  }

  return {
    path,
    exists,
    config: file ?? {},
    fileError,
    keys: computeKeyStatuses(file ?? {}, env),
  };
}

/**
 * Validates the submitted config against the file schema (throwing
 * {@link GreenroomConfigFileError} with per-key issues, including inline
 * secret rejection) and persists it as regenerated TOML.
 */
export function writeConfigFileResource(
  env: GreenroomEnvironment,
  rawConfig: unknown,
): ConfigFileResource {
  const path = resolveConfigFilePath(env);
  const config = validateGreenroomConfigFileData(rawConfig, path);
  const contents = serializeGreenroomConfigFile(config);

  // Round-trip safety net: never persist TOML the boot loader cannot read.
  parseGreenroomConfigFile(contents, path);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");

  return readConfigFileResource(env);
}

function computeKeyStatuses(
  file: GreenroomConfigFile,
  env: GreenroomEnvironment,
): ConfigFileKeyStatus[] {
  return editableKeySpecs.map((spec) => {
    const envRaw = env[spec.envVar];
    const envSet = envRaw !== undefined && (spec.envSetWhenEmpty === true || envRaw.trim() !== "");
    const fileValue = spec.fileValue(file);
    const secret = spec.secret === true;

    return {
      key: spec.key,
      envVar: spec.envVar,
      source: envSet ? "env" : fileValue !== undefined ? "file" : "default",
      secret,
      fileValue: fileValue ?? null,
      envValue: envSet && !secret ? (envRaw ?? null) : null,
    };
  });
}
