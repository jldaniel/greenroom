import { join } from "node:path";

import type { Profile } from "@greenroom/schemas";

import { resolveAppDataDir, type GreenroomEnvironment } from "./paths";

export interface GreenroomWorkflowRuntimeConfig {
  logs: WorkflowLogConfig;
  tracing: WorkflowTracingConfig;
  operational: WorkflowOperationalConfig;
}

export interface WorkflowLogConfig {
  enabled: boolean;
  path: string | null;
}

export interface WorkflowTracingConfig {
  enabled: boolean;
  mode: "disabled" | "redacted";
  otlpEndpoint: string | null;
  langchainEnabled: boolean;
  serviceName: string;
}

export interface WorkflowOperationalConfig {
  maxConcurrentRuns: number;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  maxMcpResourceReadEvents: number | null;
  /**
   * Repair attempts allowed when a workflow definition does not set its own
   * repair policy. `0` disables the repair loop.
   */
  maxRepairAttempts: number;
}

const defaultWorkflowIdleTimeoutMs = 5 * 60_000;
const defaultWorkflowAbsoluteTimeoutMs = 60 * 60_000;

/** Default repair attempts per run before a validation failure is terminal. */
export const defaultWorkflowMaxRepairAttempts = 2;

export function readWorkflowRuntimeConfigFromEnv(
  env: GreenroomEnvironment = process.env,
): GreenroomWorkflowRuntimeConfig {
  const logPath = nonEmpty(env.GREENROOM_WORKFLOW_LOG_PATH);
  const explicitLogsEnabled = parseBoolean(env.GREENROOM_WORKFLOW_LOGS_ENABLED);
  const logsEnabled = explicitLogsEnabled ?? logPath !== null;
  const otlpEndpoint =
    nonEmpty(env.GREENROOM_OTLP_ENDPOINT) ??
    nonEmpty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) ??
    nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const langchainEnabled = parseBoolean(env.GREENROOM_LANGCHAIN_TRACING_ENABLED) === true;
  const explicitTracingEnabled = parseBoolean(env.GREENROOM_TRACING_ENABLED);
  const tracingEnabled = explicitTracingEnabled ?? (otlpEndpoint !== null || langchainEnabled);

  return {
    logs: {
      enabled: logsEnabled,
      path:
        logPath ?? (logsEnabled ? join(resolveAppDataDir(env), "logs", "workflows.jsonl") : null),
    },
    tracing: {
      enabled: tracingEnabled,
      mode: tracingEnabled ? "redacted" : "disabled",
      otlpEndpoint,
      langchainEnabled,
      serviceName: nonEmpty(env.GREENROOM_TRACING_SERVICE_NAME) ?? "greenroom-server",
    },
    operational: {
      maxConcurrentRuns: parseInteger(env.GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS, 1, 1, 16),
      idleTimeoutMs: parseInteger(
        env.GREENROOM_WORKFLOW_IDLE_TIMEOUT_MS,
        defaultWorkflowIdleTimeoutMs,
        1000,
        24 * 60 * 60 * 1000,
      ),
      absoluteTimeoutMs: parseInteger(
        env.GREENROOM_WORKFLOW_ABSOLUTE_TIMEOUT_MS,
        defaultWorkflowAbsoluteTimeoutMs,
        1000,
        24 * 60 * 60 * 1000,
      ),
      maxMcpResourceReadEvents: parseOptionalInteger(
        env.GREENROOM_WORKFLOW_MAX_MCP_RESOURCE_READS,
        1,
        10_000,
      ),
      maxRepairAttempts: parseInteger(
        env.GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS,
        defaultWorkflowMaxRepairAttempts,
        0,
        20,
      ),
    },
  };
}

export function workflowTracingStatusForProfile(
  profile: Pick<Profile, "contextPreferences" | "modelSettings">,
  config: GreenroomWorkflowRuntimeConfig,
): "disabled" | "redacted" {
  return config.tracing.enabled || profileRequestsTracing(profile) ? "redacted" : "disabled";
}

function profileRequestsTracing(
  profile: Pick<Profile, "contextPreferences" | "modelSettings">,
): boolean {
  return (
    booleanSetting(profile.contextPreferences, "tracingEnabled") === true ||
    booleanSetting(objectSetting(profile.contextPreferences, "tracing"), "enabled") === true ||
    booleanSetting(objectSetting(profile.modelSettings, "workflow"), "tracingEnabled") === true ||
    booleanSetting(objectSetting(profile.modelSettings, "tracing"), "enabled") === true
  );
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseInteger(
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
    return fallback;
  }

  return parsed;
}

function parseOptionalInteger(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function objectSetting(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanSetting(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
}
