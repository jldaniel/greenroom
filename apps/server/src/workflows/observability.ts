import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

import type { WorkflowRunEventType, WorkflowRunStatus } from "@greenroom/schemas";

import type { GreenroomWorkflowRuntimeConfig } from "../config";
import { redactJsonValue, redactString, type RedactionOptions } from "../config/redaction";

export interface WorkflowRuntimeLogEvent {
  timestamp: string;
  runId: string;
  reviewDisplayId: string | null;
  workflowKind: string;
  eventType: WorkflowRunEventType;
  severity: "debug" | "info" | "warning" | "error";
  status: WorkflowRunStatus | "unknown";
  phase: string | null;
  durationMs: number | null;
  summary: string;
  metadata: Record<string, unknown>;
  tracing: {
    enabled: boolean;
    mode: "disabled" | "redacted";
    otlpEndpointConfigured: boolean;
    langchainEnabled: boolean;
  };
}

export interface WorkflowRuntimeObserver {
  record: (event: WorkflowRuntimeLogEvent) => void;
}

export function createWorkflowRuntimeObserver(
  config: GreenroomWorkflowRuntimeConfig,
  redaction: RedactionOptions = {},
): WorkflowRuntimeObserver {
  const logPath = config.logs.enabled ? config.logs.path : null;

  return {
    record(event) {
      const sanitized = sanitizeEvent(event, redaction);

      if (logPath !== null) {
        appendJsonLine(logPath, sanitized, redaction);
      }
    },
  };
}

function sanitizeEvent(
  event: WorkflowRuntimeLogEvent,
  redaction: RedactionOptions,
): WorkflowRuntimeLogEvent {
  return {
    ...event,
    summary: redactString(event.summary, redaction),
    metadata: redactJsonValue(event.metadata, redaction) as Record<string, unknown>,
  };
}

function appendJsonLine(
  path: string,
  event: WorkflowRuntimeLogEvent,
  redaction: RedactionOptions,
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`Greenroom workflow log write failed: ${redactString(message, redaction)}`);
  }
}
