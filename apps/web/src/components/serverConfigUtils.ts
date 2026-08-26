import type {
  ConfigFileKeyStatus,
  ConfigFileValidationIssue,
  GreenroomConfigFileData,
} from "../api/client";

/**
 * Pure form-state helpers for the server configuration panel. The form edits
 * the editable subset of greenroom.toml (server host/port, MCP port, bridge
 * base URL/token reference/timeout, workflow limits); every other key in the
 * loaded config round-trips untouched through `configFromFormState`.
 */

export type BridgeTokenRefKind = "none" | "tokenEnv" | "tokenFile";

export interface ServerConfigFormState {
  serverHost: string;
  serverPort: string;
  mcpPort: string;
  bridgeBaseUrl: string;
  bridgeTokenRefKind: BridgeTokenRefKind;
  bridgeTokenRefValue: string;
  bridgeTimeoutMs: string;
  workflowMaxConcurrentRuns: string;
  workflowIdleTimeoutMs: string;
  workflowAbsoluteTimeoutMs: string;
  workflowMaxMcpResourceReads: string;
}

export function formStateFromConfig(config: GreenroomConfigFileData): ServerConfigFormState {
  const tokenRefKind: BridgeTokenRefKind =
    config.bridge?.tokenEnv !== undefined
      ? "tokenEnv"
      : config.bridge?.tokenFile !== undefined
        ? "tokenFile"
        : "none";

  return {
    serverHost: config.server?.host ?? "",
    serverPort: numberToField(config.server?.port),
    mcpPort: numberToField(config.mcp?.port),
    bridgeBaseUrl: config.bridge?.baseUrl ?? "",
    bridgeTokenRefKind: tokenRefKind,
    bridgeTokenRefValue: config.bridge?.tokenEnv ?? config.bridge?.tokenFile ?? "",
    bridgeTimeoutMs: numberToField(config.bridge?.timeoutMs),
    workflowMaxConcurrentRuns: numberToField(config.workflows?.maxConcurrentRuns),
    workflowIdleTimeoutMs: numberToField(config.workflows?.idleTimeoutMs),
    workflowAbsoluteTimeoutMs: numberToField(config.workflows?.absoluteTimeoutMs),
    workflowMaxMcpResourceReads: numberToField(config.workflows?.maxMcpResourceReads),
  };
}

export interface ConfigFromFormStateResult {
  config: GreenroomConfigFileData;
  /** Client-side problems keyed by config key, for example `server.port`. */
  errors: Record<string, string>;
}

/**
 * Merges the form fields into the last-loaded config so keys the form does
 * not edit (log level, allowed origins, observability, path maps, ...) are
 * preserved on save. Empty fields remove the corresponding key so the
 * built-in default applies again.
 */
export function configFromFormState(
  base: GreenroomConfigFileData,
  form: ServerConfigFormState,
): ConfigFromFormStateResult {
  const errors: Record<string, string> = {};

  const readNumber = (key: string, raw: string): number | undefined => {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      return undefined;
    }

    const value = Number(trimmed);

    if (!Number.isInteger(value)) {
      errors[key] = "Must be a whole number";
      return undefined;
    }

    return value;
  };

  const tokenRefValue = form.bridgeTokenRefValue.trim();

  if (form.bridgeTokenRefKind !== "none" && tokenRefValue.length === 0) {
    errors["bridge." + form.bridgeTokenRefKind] =
      form.bridgeTokenRefKind === "tokenEnv"
        ? "Environment variable name is required"
        : "Token file path is required";
  }

  const server = pruneSection({
    ...base.server,
    host: emptyToUndefined(form.serverHost),
    port: readNumber("server.port", form.serverPort),
  });
  const mcp = pruneSection({
    ...base.mcp,
    port: readNumber("mcp.port", form.mcpPort),
  });
  const bridge = pruneSection({
    ...base.bridge,
    baseUrl: emptyToUndefined(form.bridgeBaseUrl),
    tokenEnv: form.bridgeTokenRefKind === "tokenEnv" ? emptyToUndefined(tokenRefValue) : undefined,
    tokenFile:
      form.bridgeTokenRefKind === "tokenFile" ? emptyToUndefined(tokenRefValue) : undefined,
    timeoutMs: readNumber("bridge.timeoutMs", form.bridgeTimeoutMs),
  });
  const workflows = pruneSection({
    ...base.workflows,
    maxConcurrentRuns: readNumber("workflows.maxConcurrentRuns", form.workflowMaxConcurrentRuns),
    idleTimeoutMs: readNumber("workflows.idleTimeoutMs", form.workflowIdleTimeoutMs),
    absoluteTimeoutMs: readNumber("workflows.absoluteTimeoutMs", form.workflowAbsoluteTimeoutMs),
    maxMcpResourceReads: readNumber(
      "workflows.maxMcpResourceReads",
      form.workflowMaxMcpResourceReads,
    ),
  });

  const config: GreenroomConfigFileData = {
    ...(server === undefined ? {} : { server }),
    ...(mcp === undefined ? {} : { mcp }),
    ...(bridge === undefined ? {} : { bridge }),
    ...(base.pathMaps === undefined ? {} : { pathMaps: base.pathMaps }),
    ...(workflows === undefined ? {} : { workflows }),
    ...(base.observability === undefined ? {} : { observability: base.observability }),
  };

  return { config, errors };
}

/**
 * Maps API validation issues (`error.details.issues`) to per-field messages
 * keyed by config key. Issues on nested paths collapse onto their closest
 * editable key so `bridge.tokenEnv` problems land on the token field.
 */
export function fieldErrorsFromIssues(
  issues: readonly ConfigFileValidationIssue[] | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues ?? []) {
    errors[issue.path] ??= issue.message;
  }

  return errors;
}

export function envOverridesFromKeys(
  keys: readonly ConfigFileKeyStatus[] | undefined,
): Record<string, ConfigFileKeyStatus> {
  const overrides: Record<string, ConfigFileKeyStatus> = {};

  for (const key of keys ?? []) {
    if (key.source === "env") {
      overrides[key.key] = key;
    }
  }

  return overrides;
}

function numberToField(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

type Pruned<Section> = { [Key in keyof Section]?: Exclude<Section[Key], undefined> };

function pruneSection<Section extends Record<string, unknown>>(
  section: Section,
): Pruned<Section> | undefined {
  const entries = Object.entries(section).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Pruned<Section>;
}
