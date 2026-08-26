import type { GreenroomEnvironment } from "./paths";

/**
 * Transcript retention configuration.
 *
 * Redacted harness transcripts are persisted per workflow run by default,
 * bounded by a maximum total size and a maximum age. Both caps and the global
 * enable flag are configurable through the config file (`workflows.transcripts`)
 * or environment variables, with env var > file > built-in default precedence.
 */
export interface WorkflowTranscriptRetentionConfig {
  enabled: boolean;
  maxAgeDays: number;
  maxTotalBytes: number;
}

export const defaultTranscriptMaxAgeDays = 30;
export const defaultTranscriptMaxTotalBytes = 50 * 1024 * 1024;

export function readTranscriptRetentionConfigFromEnv(
  env: GreenroomEnvironment = process.env,
): WorkflowTranscriptRetentionConfig {
  return {
    enabled: parseBoolean(env.GREENROOM_TRANSCRIPTS_ENABLED) ?? true,
    maxAgeDays: parseInteger(
      env.GREENROOM_TRANSCRIPTS_MAX_AGE_DAYS,
      defaultTranscriptMaxAgeDays,
      1,
      3650,
    ),
    maxTotalBytes: parseInteger(
      env.GREENROOM_TRANSCRIPTS_MAX_TOTAL_BYTES,
      defaultTranscriptMaxTotalBytes,
      1024,
      10 * 1024 * 1024 * 1024,
    ),
  };
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
