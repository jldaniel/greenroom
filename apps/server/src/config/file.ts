import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as z from "zod";

import { resolveAppDataDir, type GreenroomEnvironment } from "./paths";

/**
 * Greenroom config file loader.
 *
 * A `greenroom.toml` file in the app data dir holds non-secret runtime
 * configuration: ports, harness bridge location + token *reference*, path
 * maps, workflow limits, and tracing/observability settings.
 *
 * Precedence is env var > config file > built-in defaults, applied per key.
 * The loader implements this by overlaying file values onto a copy of the
 * process environment: a file value is applied only when the matching env var
 * is unset, so the existing typed env readers keep their defaults and
 * validation behavior unchanged.
 *
 * Secrets never live in the file. The bridge token is referenced indirectly
 * with `tokenEnv` (an environment variable name) or `tokenFile` (a file path
 * whose contents are the token).
 */

export const greenroomConfigFileName = "greenroom.toml";

const portSchema = z.number().int().min(1).max(65_535);

const serverSectionSchema = z.strictObject({
  host: z.string().min(1).optional(),
  port: portSchema.optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  allowedOrigins: z.array(z.string().min(1)).optional(),
  setupTokenEndpoint: z.enum(["auto", "enabled", "disabled"]).optional(),
  databasePath: z.string().min(1).optional(),
  webDist: z.string().min(1).optional(),
});

const mcpSectionSchema = z.strictObject({
  host: z.string().min(1).optional(),
  port: portSchema.optional(),
});

const bridgeSectionSchema = z
  .strictObject({
    baseUrl: z
      .string()
      .regex(/^https?:\/\/\S+$/u, "must be an http(s) URL, for example http://127.0.0.1:49343")
      .optional(),
    tokenEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, "must be an environment variable name")
      .optional(),
    tokenFile: z.string().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(24 * 60 * 60 * 1000)
      .optional(),
  })
  .refine((section) => section.tokenEnv === undefined || section.tokenFile === undefined, {
    message: "tokenEnv and tokenFile are mutually exclusive; configure exactly one",
  });

const pathMapSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
});

const transcriptsSectionSchema = z.strictObject({
  enabled: z.boolean().optional(),
  maxAgeDays: z.number().int().min(1).max(3650).optional(),
  maxTotalBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024 * 1024)
    .optional(),
});

const workflowsSectionSchema = z.strictObject({
  maxConcurrentRuns: z.number().int().min(1).max(16).optional(),
  idleTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  absoluteTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  maxMcpResourceReads: z.number().int().min(1).max(10_000).optional(),
  maxRepairAttempts: z.number().int().min(0).max(20).optional(),
  transcripts: transcriptsSectionSchema.optional(),
});

const observabilitySectionSchema = z.strictObject({
  tracingEnabled: z.boolean().optional(),
  otlpEndpoint: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  langchainTracingEnabled: z.boolean().optional(),
  workflowLogsEnabled: z.boolean().optional(),
  workflowLogPath: z.string().min(1).optional(),
});

export const greenroomConfigFileSchema = z.strictObject({
  server: serverSectionSchema.optional(),
  mcp: mcpSectionSchema.optional(),
  bridge: bridgeSectionSchema.optional(),
  pathMaps: z.array(pathMapSchema).optional(),
  workflows: workflowsSectionSchema.optional(),
  observability: observabilitySectionSchema.optional(),
});

export type GreenroomConfigFile = z.infer<typeof greenroomConfigFileSchema>;

export interface ConfigFileIssue {
  key: string;
  message: string;
}

export class GreenroomConfigFileError extends Error {
  readonly filePath: string;
  readonly issues: readonly ConfigFileIssue[];

  constructor(filePath: string, issues: readonly ConfigFileIssue[]) {
    const details = issues.map((issue) => `  - ${issue.key}: ${issue.message}`).join("\n");
    super(`Invalid Greenroom config file at ${filePath}:\n${details}`);
    this.name = "GreenroomConfigFileError";
    this.filePath = filePath;
    this.issues = issues;
  }
}

export interface LoadedGreenroomConfig {
  /** Resolved config file path, whether or not the file exists. */
  path: string;
  /** Parsed file contents, or null when no config file exists. */
  file: GreenroomConfigFile | null;
  /** Environment with file values overlaid where no env var is set. */
  env: GreenroomEnvironment;
}

export function resolveConfigFilePath(env: GreenroomEnvironment = process.env): string {
  const explicit = env.GREENROOM_CONFIG_PATH?.trim();

  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  return join(resolveAppDataDir(env), greenroomConfigFileName);
}

/**
 * Reads and validates the config file. Returns `null` contents when the file
 * does not exist. Throws {@link GreenroomConfigFileError} with per-key issues
 * when the file is malformed or invalid.
 */
export function readGreenroomConfigFile(env: GreenroomEnvironment = process.env): {
  path: string;
  file: GreenroomConfigFile | null;
} {
  const path = resolveConfigFilePath(env);
  let contents: string;

  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return { path, file: null };
    }

    throw new GreenroomConfigFileError(path, [
      { key: "(file)", message: `unable to read config file: ${errorMessage(error)}` },
    ]);
  }

  return { path, file: parseGreenroomConfigFile(contents, path) };
}

export function parseGreenroomConfigFile(contents: string, path: string): GreenroomConfigFile {
  let raw: unknown;

  try {
    raw = Bun.TOML.parse(contents);
  } catch (error) {
    throw new GreenroomConfigFileError(path, [
      { key: "(file)", message: `not valid TOML: ${errorMessage(error)}` },
    ]);
  }

  return validateGreenroomConfigFileData(raw, path);
}

/**
 * Validates already-parsed config data (for example a JSON request body from
 * the config API) against the config file schema. Throws
 * {@link GreenroomConfigFileError} with per-key issues on failure, including
 * the inline-secret rejection for a literal `bridge.token` key.
 */
export function validateGreenroomConfigFileData(raw: unknown, path: string): GreenroomConfigFile {
  const result = greenroomConfigFileSchema.safeParse(raw);

  if (!result.success) {
    throw new GreenroomConfigFileError(path, result.error.issues.map(formatIssue));
  }

  return result.data;
}

/**
 * Serializes a validated config to TOML using the same section layout as the
 * annotated template. Comments from a previously edited file are not
 * preserved; the file is regenerated from the template structure. A config
 * with no set keys serializes to the fully commented template so the file
 * remains self-documenting.
 */
export function serializeGreenroomConfigFile(file: GreenroomConfigFile): string {
  const sections: string[] = [];

  appendTomlSection(sections, "server", {
    host: file.server?.host,
    port: file.server?.port,
    logLevel: file.server?.logLevel,
    allowedOrigins: file.server?.allowedOrigins,
    setupTokenEndpoint: file.server?.setupTokenEndpoint,
    databasePath: file.server?.databasePath,
    webDist: file.server?.webDist,
  });
  appendTomlSection(sections, "mcp", {
    host: file.mcp?.host,
    port: file.mcp?.port,
  });
  appendTomlSection(sections, "bridge", {
    baseUrl: file.bridge?.baseUrl,
    tokenEnv: file.bridge?.tokenEnv,
    tokenFile: file.bridge?.tokenFile,
    timeoutMs: file.bridge?.timeoutMs,
  });

  for (const pathMap of file.pathMaps ?? []) {
    sections.push(
      ["[[pathMaps]]", `from = ${tomlValue(pathMap.from)}`, `to = ${tomlValue(pathMap.to)}`].join(
        "\n",
      ),
    );
  }

  appendTomlSection(sections, "workflows", {
    maxConcurrentRuns: file.workflows?.maxConcurrentRuns,
    idleTimeoutMs: file.workflows?.idleTimeoutMs,
    absoluteTimeoutMs: file.workflows?.absoluteTimeoutMs,
    maxMcpResourceReads: file.workflows?.maxMcpResourceReads,
    maxRepairAttempts: file.workflows?.maxRepairAttempts,
  });
  appendTomlSection(sections, "observability", {
    tracingEnabled: file.observability?.tracingEnabled,
    otlpEndpoint: file.observability?.otlpEndpoint,
    serviceName: file.observability?.serviceName,
    langchainTracingEnabled: file.observability?.langchainTracingEnabled,
    workflowLogsEnabled: file.observability?.workflowLogsEnabled,
    workflowLogPath: file.observability?.workflowLogPath,
  });

  if (sections.length === 0) {
    return defaultGreenroomConfigFileContents();
  }

  return `${configFileHeaderComment}\n\n${sections.join("\n\n")}\n`;
}

const configFileHeaderComment = `# Greenroom configuration.
#
# Precedence: environment variable > this file > built-in default, per key.
# Secrets never belong in this file; the bridge token is referenced with
# tokenEnv (an env var name) or tokenFile (a file path), never inline.`;

type TomlScalar = string | number | boolean | readonly string[] | undefined;

function appendTomlSection(
  sections: string[],
  name: string,
  values: Record<string, TomlScalar>,
): void {
  const lines = Object.entries(values)
    .filter((entry): entry is [string, Exclude<TomlScalar, undefined>] => entry[1] !== undefined)
    .map(([key, value]) => `${key} = ${tomlValue(value)}`);

  if (lines.length === 0) {
    return;
  }

  sections.push([`[${name}]`, ...lines].join("\n"));
}

function tomlValue(value: Exclude<TomlScalar, undefined>): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/**
 * Loads the config file and returns an environment where file values fill in
 * env vars that are not already set. Existing consumers keep reading env vars
 * through their current typed readers, which preserves built-in defaults as
 * the lowest-precedence layer.
 */
export function loadGreenroomEnvironment(
  env: GreenroomEnvironment = process.env,
): LoadedGreenroomConfig {
  const { path, file } = readGreenroomConfigFile(env);

  if (file === null) {
    return { path, file, env };
  }

  return { path, file, env: applyConfigFileToEnvironment(file, env, path) };
}

export function applyConfigFileToEnvironment(
  file: GreenroomConfigFile,
  env: GreenroomEnvironment,
  filePath: string,
): GreenroomEnvironment {
  const merged: GreenroomEnvironment = { ...env };
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) {
      return;
    }

    const current = merged[name];

    if (current !== undefined && current.trim() !== "") {
      return;
    }

    merged[name] = value;
  };

  assign("GREENROOM_HOST", file.server?.host);
  assign("GREENROOM_PORT", numberString(file.server?.port));
  assign("GREENROOM_LOG_LEVEL", file.server?.logLevel);
  assign("GREENROOM_ALLOWED_ORIGINS", file.server?.allowedOrigins?.join(","));
  assign("GREENROOM_SETUP_TOKEN_ENDPOINT", file.server?.setupTokenEndpoint);
  assign("GREENROOM_DB_PATH", file.server?.databasePath);
  assign("GREENROOM_WEB_DIST", file.server?.webDist);

  assign("GREENROOM_MCP_HOST", file.mcp?.host);
  assign("GREENROOM_MCP_PORT", numberString(file.mcp?.port));

  // A GREENROOM_HARNESS_BASE_URL env var set to an empty value explicitly
  // disables the bridge, so any env value (even empty) wins over the file.
  if (merged.GREENROOM_HARNESS_BASE_URL === undefined && file.bridge?.baseUrl !== undefined) {
    merged.GREENROOM_HARNESS_BASE_URL = file.bridge.baseUrl;
  }

  assign("GREENROOM_HARNESS_TIMEOUT_MS", numberString(file.bridge?.timeoutMs));
  assign("GREENROOM_HARNESS_TOKEN", resolveBridgeTokenReference(file.bridge, env, filePath));

  assign(
    "GREENROOM_HARNESS_PATH_MAP_JSON",
    file.pathMaps === undefined ? undefined : JSON.stringify(file.pathMaps),
  );

  assign("GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS", numberString(file.workflows?.maxConcurrentRuns));
  assign("GREENROOM_WORKFLOW_IDLE_TIMEOUT_MS", numberString(file.workflows?.idleTimeoutMs));
  assign("GREENROOM_WORKFLOW_ABSOLUTE_TIMEOUT_MS", numberString(file.workflows?.absoluteTimeoutMs));
  assign(
    "GREENROOM_WORKFLOW_MAX_MCP_RESOURCE_READS",
    numberString(file.workflows?.maxMcpResourceReads),
  );
  assign("GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS", numberString(file.workflows?.maxRepairAttempts));

  assign("GREENROOM_TRANSCRIPTS_ENABLED", booleanString(file.workflows?.transcripts?.enabled));
  assign(
    "GREENROOM_TRANSCRIPTS_MAX_AGE_DAYS",
    numberString(file.workflows?.transcripts?.maxAgeDays),
  );
  assign(
    "GREENROOM_TRANSCRIPTS_MAX_TOTAL_BYTES",
    numberString(file.workflows?.transcripts?.maxTotalBytes),
  );

  assign("GREENROOM_TRACING_ENABLED", booleanString(file.observability?.tracingEnabled));
  assign("GREENROOM_OTLP_ENDPOINT", file.observability?.otlpEndpoint);
  assign("GREENROOM_TRACING_SERVICE_NAME", file.observability?.serviceName);
  assign(
    "GREENROOM_LANGCHAIN_TRACING_ENABLED",
    booleanString(file.observability?.langchainTracingEnabled),
  );
  assign("GREENROOM_WORKFLOW_LOGS_ENABLED", booleanString(file.observability?.workflowLogsEnabled));
  assign("GREENROOM_WORKFLOW_LOG_PATH", file.observability?.workflowLogPath);

  return merged;
}

/**
 * Annotated template for a fresh config file. Every key is commented out, so
 * writing this file changes no behavior until the user edits it.
 */
export function defaultGreenroomConfigFileContents(): string {
  return `# Greenroom configuration.
#
# Precedence: environment variable > this file > built-in default, per key.
# Secrets never belong in this file; the bridge token is referenced with
# tokenEnv (an env var name) or tokenFile (a file path), never inline.

[server]
# host = "127.0.0.1"
# port = 49331
# logLevel = "info"
# allowedOrigins = []
# setupTokenEndpoint = "auto"
# databasePath = "/path/to/greenroom.sqlite"
# webDist = "/path/to/apps/web/dist"

[mcp]
# host = "127.0.0.1"
# port = 49332

[bridge]
# baseUrl = "http://127.0.0.1:49343"
# tokenEnv = "GREENROOM_HARNESS_TOKEN"
# tokenFile = "/path/to/bridge-token"
# timeoutMs = 3600000

# [[pathMaps]]
# from = "/container/path"
# to = "/host/path"

[workflows]
# maxConcurrentRuns = 1
# idleTimeoutMs = 300000
# absoluteTimeoutMs = 3600000
# maxMcpResourceReads = 1000
# maxRepairAttempts = 2

[workflows.transcripts]
# enabled = true
# maxAgeDays = 30
# maxTotalBytes = 52428800

[observability]
# tracingEnabled = false
# otlpEndpoint = "http://127.0.0.1:4318/v1/traces"
# serviceName = "greenroom-server"
# langchainTracingEnabled = false
# workflowLogsEnabled = false
# workflowLogPath = "/path/to/workflows.jsonl"
`;
}

function resolveBridgeTokenReference(
  bridge: GreenroomConfigFile["bridge"],
  env: GreenroomEnvironment,
  filePath: string,
): string | undefined {
  if (bridge === undefined) {
    return undefined;
  }

  if (bridge.tokenEnv !== undefined) {
    // A referenced-but-unset env var keeps the bridge disabled, matching the
    // env-only behavior when GREENROOM_HARNESS_TOKEN is not exported.
    const value = env[bridge.tokenEnv]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  }

  if (bridge.tokenFile !== undefined) {
    let contents: string;

    try {
      contents = readFileSync(bridge.tokenFile, "utf8");
    } catch (error) {
      throw new GreenroomConfigFileError(filePath, [
        {
          key: "bridge.tokenFile",
          message: `unable to read token file ${bridge.tokenFile}: ${errorMessage(error)}`,
        },
      ]);
    }

    const token = contents.trim();

    if (token.length === 0) {
      throw new GreenroomConfigFileError(filePath, [
        { key: "bridge.tokenFile", message: `token file ${bridge.tokenFile} is empty` },
      ]);
    }

    return token;
  }

  return undefined;
}

function formatIssue(issue: z.core.$ZodIssue): ConfigFileIssue {
  const key = issue.path.length === 0 ? "(root)" : issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys;

    if (keys.some((name) => /token|secret|password|credential|key/iu.test(name))) {
      return {
        key: key === "(root)" ? keys.join(", ") : `${key}.${keys.join(", ")}`,
        message:
          "secret values are not allowed in the config file; reference the bridge token with tokenEnv or tokenFile instead",
      };
    }

    return { key, message: `unrecognized key(s): ${keys.join(", ")}` };
  }

  return { key, message: issue.message };
}

function numberString(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function booleanString(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "true" : "false";
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
