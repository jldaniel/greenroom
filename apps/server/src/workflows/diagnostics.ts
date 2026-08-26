import * as z from "zod";

import {
  workflowKindSchema,
  workflowRunIdSchema,
  workflowRunPhaseSchema,
  workflowRunStatusSchema,
  workflowValidationIssueSchema,
  type WorkflowRun,
  type WorkflowRunEvent,
} from "@greenroom/schemas";

import { redactDiagnostic } from "../config";
import {
  workflowRunTranscriptMetadataSchema,
  type WorkflowRunTranscript,
} from "../storage/transcripts";

/**
 * Read-only run diagnostics.
 *
 * `deriveWorkflowRunDiagnostics` is a pure function over the persisted run
 * record, its ordered event log, and its redacted transcripts. It never
 * re-reads storage and never surfaces unredacted content: the stderr tail
 * comes from the transcript store, which redacts before persisting.
 *
 * The payload is intentionally structured for follow-up tasks:
 * - `repairAttempts` lists every repair attempt with its issue codes, and
 *   `maxRepairAttempts` carries the attempt budget, so attempt-N-of-M
 *   progress can be rendered.
 * - `fingerprint` always carries the consented revision alongside the
 *   review's current revision so callers can offer a recovery action when the
 *   worktree fingerprint changed under a run.
 */

export const workflowRunFailureCategorySchema = z.enum([
  "bridge_down",
  "process_lost",
  "workspace_setup_failed",
  "workspace_cleanup_failed",
  "invalid_output",
  "unknown_anchor",
  "timeout",
  "fingerprint_changed",
  "unknown",
]);

export const workflowRunFailingStepSchema = z
  .object({
    stepId: z.string().nullable(),
    phase: z.string().nullable(),
  })
  .strict();

export const workflowRunRepairAttemptDiagnosticsSchema = z
  .object({
    attemptNumber: z.number().int().min(1),
    issueCodes: z.array(z.string().min(1)).default([]),
    timestamp: z.string().nullable(),
  })
  .strict();

export const workflowRunFingerprintDiagnosticsSchema = z
  .object({
    changed: z.boolean(),
    consentedRevisionId: z.string().min(1),
    currentRevisionId: z.string().nullable(),
  })
  .strict();

export const workflowRunRepositoryAccessDiagnosticsSchema = z
  .object({
    mode: z.string().nullable(),
    readScopeLabel: z.string().nullable(),
    revisionId: z.string().nullable(),
    baseSha: z.string().nullable(),
    headSha: z.string().nullable(),
    workspaceStrategy: z.string().nullable(),
    workspaceSetupStatus: z.string().nullable(),
    workspaceCleanupStatus: z.string().nullable(),
    workspaceErrorMessage: z.string().nullable(),
  })
  .strict();

export const workflowRunDiagnosticsSchema = z
  .object({
    runId: workflowRunIdSchema,
    workflowKind: workflowKindSchema,
    status: workflowRunStatusSchema,
    phase: workflowRunPhaseSchema,
    failureCategory: workflowRunFailureCategorySchema.nullable(),
    summary: z.string().min(1),
    errorMessage: z.string().nullable(),
    failingStep: workflowRunFailingStepSchema.nullable(),
    exitCode: z.number().int().nullable(),
    stderrTail: z.string().nullable(),
    validationIssues: z.array(workflowValidationIssueSchema),
    repairAttempts: z.array(workflowRunRepairAttemptDiagnosticsSchema),
    /** Repair attempts allowed for this run; null when no repair ever started. */
    maxRepairAttempts: z.number().int().min(1).nullable(),
    fingerprint: workflowRunFingerprintDiagnosticsSchema,
    repositoryAccess: workflowRunRepositoryAccessDiagnosticsSchema,
    timeoutMs: z.number().int().nullable(),
    timeoutBudgetMs: z.number().int().nullable(),
    transcripts: z.array(workflowRunTranscriptMetadataSchema),
    transcriptsUrl: z.string().min(1),
  })
  .strict();

export type WorkflowRunFailureCategory = z.infer<typeof workflowRunFailureCategorySchema>;
export type WorkflowRunFailingStep = z.infer<typeof workflowRunFailingStepSchema>;
export type WorkflowRunRepairAttemptDiagnostics = z.infer<
  typeof workflowRunRepairAttemptDiagnosticsSchema
>;
export type WorkflowRunFingerprintDiagnostics = z.infer<
  typeof workflowRunFingerprintDiagnosticsSchema
>;
export type WorkflowRunRepositoryAccessDiagnostics = z.infer<
  typeof workflowRunRepositoryAccessDiagnosticsSchema
>;
export type WorkflowRunDiagnostics = z.infer<typeof workflowRunDiagnosticsSchema>;

export interface DeriveWorkflowRunDiagnosticsInput {
  run: WorkflowRun;
  events: readonly WorkflowRunEvent[];
  transcripts: readonly WorkflowRunTranscript[];
  /** The review's current revision id, for fingerprint-change recovery context. */
  currentRevisionId?: string | null;
  /** Maximum number of stderr lines returned in the tail (default 40). */
  stderrTailMaxLines?: number;
}

const defaultStderrTailMaxLines = 40;
const stderrTailMaxChars = 4000;

// Timeout failures: orchestrator budget expiry records a failure
// event with `timeoutMs` metadata and a "timed out after Nms" message; bridge
// timeouts surface "Harness command timed out" / "timedOut=true" via
// formatHarnessRunFailureMessage.
const timeoutTextPatterns = [/\btimed out after \d+\s*ms\b/iu, /\btimedOut=true\b/u];

// Fingerprint failures: the harness bridge discards output when the git
// fingerprint changed during the run ("Harness modified repository state")
// and reports `repositoryChanged=true` in the formatted failure message.
const fingerprintTextPatterns = [
  /\brepositoryChanged=true\b/u,
  /harness modified repository state/iu,
  /fingerprint (?:changed|mismatch)/iu,
];

// Bridge-down failures: unset bridge config raises "Harness bridge is
// unavailable"/"not configured"; HTTP failures raise "Harness bridge returned
// HTTP N"; connection refusals raise fetch-level connection errors.
const bridgeDownTextPatterns = [
  /harness bridge is unavailable/iu,
  /harness bridge is not configured/iu,
  /harness bridge returned http/iu,
  /harness bridge health check/iu,
  /\bfetch failed\b/iu,
  /\beconnrefused\b/iu,
  /\beconnreset\b/iu,
  /\benotfound\b/iu,
  /connection refused/iu,
  /unable to connect/iu,
  /socket hang up/iu,
];

const processLostTextPatterns = [
  /bridge\/process heartbeat lost/iu,
  /heartbeat (?:lost|stopped|missing)/iu,
  /process (?:lost|exited|disappeared)/iu,
  /last process seen/iu,
  /harness bridge run finished without a result/iu,
];

const workspaceSetupTextPatterns = [
  /workspace setup (?:failed|failure)/iu,
  /failed to prepare (?:repository )?(?:snapshot )?workspace/iu,
  /snapshot workspace setup/iu,
  /repository snapshot access is disabled or unsupported/iu,
  /harness bridge does not advertise repository_snapshot/iu,
];

const workspaceCleanupTextPatterns = [
  /workspace cleanup (?:failed|failure)/iu,
  /failed to clean (?:repository )?(?:snapshot )?workspace/iu,
  /workspaceCleanupStatus=failed/u,
];

// Anchor failures: validators reject drafts with unknown-anchor-key /
// unknown-uncovered-anchor-key issue codes; post-validation thread creation
// throws "unknown anchor key" when the anchor registry no longer matches.
const unknownAnchorTextPattern = /unknown anchor key/iu;

// Invalid-output failures: the orchestrator fails runs that exhaust repair
// attempts ("failed validation after N repair attempts"), and harness steps
// fail when no structured output or MCP draft was produced.
const invalidOutputTextPatterns = [
  /failed validation after \d+ repair attempt/iu,
  /without returning structured stdout/iu,
  /draft validation failed/iu,
];

export function deriveWorkflowRunDiagnostics(
  input: DeriveWorkflowRunDiagnosticsInput,
): WorkflowRunDiagnostics {
  const { run, events, transcripts } = input;
  const failureEvents = events.filter((event) => event.eventType === "failure");
  const lastFailureEvent = failureEvents.at(-1) ?? null;
  const failureText = [run.errorMessage ?? "", ...failureEvents.map((event) => event.summary)]
    .filter((entry) => entry.length > 0)
    .join("\n");
  const repairAttempts = deriveRepairAttempts(events);
  const blockingIssueCodes = collectBlockingIssueCodes(run, lastFailureEvent);
  const timeoutMs = deriveTimeoutMs(run, lastFailureEvent, failureText);
  const failureCategory =
    run.status === "failed"
      ? classifyFailure({
          failureText,
          blockingIssueCodes,
          timeoutMsKnown: timeoutMs !== null,
        })
      : null;
  const failingStep = run.status === "failed" ? deriveFailingStep(run, events) : null;
  const fingerprint: WorkflowRunFingerprintDiagnostics = {
    changed: failureCategory === "fingerprint_changed",
    consentedRevisionId: run.approvedScope?.revisionId ?? run.revisionId,
    currentRevisionId: input.currentRevisionId ?? null,
  };
  const repositoryAccess = deriveRepositoryAccessDiagnostics(run);

  return workflowRunDiagnosticsSchema.parse({
    runId: run.id,
    workflowKind: run.workflowKind,
    status: run.status,
    phase: run.phase,
    failureCategory,
    summary: summaryForRun(run, failureCategory, timeoutMs, fingerprint),
    errorMessage: run.errorMessage,
    failingStep,
    exitCode: deriveExitCode(transcripts, failureText),
    stderrTail: deriveStderrTail(transcripts, input.stderrTailMaxLines),
    validationIssues: run.validationIssues,
    repairAttempts,
    maxRepairAttempts: deriveMaxRepairAttempts(run, events),
    fingerprint,
    repositoryAccess,
    timeoutMs,
    timeoutBudgetMs: positiveInteger(run.metadata.timeoutBudgetMs),
    transcripts: transcripts.map((transcript) =>
      workflowRunTranscriptMetadataSchema.parse(transcript),
    ),
    transcriptsUrl: `/api/workflow-runs/${run.id}/transcripts`,
  });
}

function classifyFailure(input: {
  failureText: string;
  blockingIssueCodes: readonly string[];
  timeoutMsKnown: boolean;
}): WorkflowRunFailureCategory {
  const { failureText, blockingIssueCodes } = input;

  if (input.timeoutMsKnown || timeoutTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "timeout";
  }

  if (fingerprintTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "fingerprint_changed";
  }

  if (bridgeDownTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "bridge_down";
  }

  if (processLostTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "process_lost";
  }

  if (workspaceSetupTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "workspace_setup_failed";
  }

  if (workspaceCleanupTextPatterns.some((pattern) => pattern.test(failureText))) {
    return "workspace_cleanup_failed";
  }

  if (
    blockingIssueCodes.some(isUnknownAnchorIssueCode) ||
    unknownAnchorTextPattern.test(failureText)
  ) {
    return "unknown_anchor";
  }

  if (
    blockingIssueCodes.length > 0 ||
    invalidOutputTextPatterns.some((pattern) => pattern.test(failureText))
  ) {
    return "invalid_output";
  }

  return "unknown";
}

function isUnknownAnchorIssueCode(code: string): boolean {
  const normalized = code.toLowerCase();
  return normalized.includes("unknown") && normalized.includes("anchor");
}

function collectBlockingIssueCodes(
  run: WorkflowRun,
  lastFailureEvent: WorkflowRunEvent | null,
): string[] {
  const codes = new Set<string>();

  for (const issue of run.validationIssues) {
    if (issue.severity === "error") {
      codes.add(issue.code);
    }
  }

  for (const code of stringArrayMetadata(lastFailureEvent?.metadata, "issueCodes")) {
    codes.add(code);
  }

  return [...codes];
}

function deriveFailingStep(
  run: WorkflowRun,
  events: readonly WorkflowRunEvent[],
): WorkflowRunFailingStep | null {
  const lastFailureEvent = events.filter((event) => event.eventType === "failure").at(-1) ?? null;
  const failureStepId =
    stringMetadata(lastFailureEvent?.metadata, "currentStepId") ??
    stringMetadata(lastFailureEvent?.metadata, "stepId");
  const failurePhase = stringMetadata(lastFailureEvent?.metadata, "phase");

  if (failureStepId !== null || failurePhase !== null) {
    return { stepId: failureStepId, phase: failurePhase };
  }

  const lastStartedStep = events
    .filter(
      (event) =>
        stringMetadata(event.metadata, "stepId") !== null &&
        stringMetadata(event.metadata, "status") === "running",
    )
    .at(-1);

  if (lastStartedStep !== undefined) {
    return {
      stepId: stringMetadata(lastStartedStep.metadata, "stepId"),
      phase: stringMetadata(lastStartedStep.metadata, "phase"),
    };
  }

  const currentStepId = stringMetadata(run.metadata, "currentStepId");

  if (currentStepId !== null) {
    return { stepId: currentStepId, phase: null };
  }

  return null;
}

function deriveRepairAttempts(
  events: readonly WorkflowRunEvent[],
): WorkflowRunRepairAttemptDiagnostics[] {
  const attemptsByNumber = new Map<number, WorkflowRunRepairAttemptDiagnostics>();

  for (const event of events) {
    if (event.eventType !== "repair_attempt") {
      continue;
    }

    const attemptNumber =
      positiveInteger(event.metadata.attemptNumber) ??
      positiveInteger(event.metadata.repairAttemptCount) ??
      attemptsByNumber.size + 1;

    attemptsByNumber.set(attemptNumber, {
      attemptNumber,
      issueCodes: stringArrayMetadata(event.metadata, "issueCodes"),
      timestamp: event.timestamp,
    });
  }

  return [...attemptsByNumber.values()].sort((a, b) => a.attemptNumber - b.attemptNumber);
}

function deriveMaxRepairAttempts(
  run: WorkflowRun,
  events: readonly WorkflowRunEvent[],
): number | null {
  const fromRunMetadata = positiveInteger(run.metadata.maxRepairAttempts);

  if (fromRunMetadata !== null) {
    return fromRunMetadata;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event === undefined || event.eventType !== "repair_attempt") {
      continue;
    }

    const fromEvent = positiveInteger(event.metadata.maxRepairAttempts);

    if (fromEvent !== null) {
      return fromEvent;
    }
  }

  return null;
}

function deriveRepositoryAccessDiagnostics(
  run: WorkflowRun,
): WorkflowRunRepositoryAccessDiagnostics {
  return {
    mode: stringMetadata(run.metadata, "repositoryAccessMode"),
    readScopeLabel: stringMetadata(run.metadata, "repositoryAccessReadScopeLabel"),
    revisionId: stringMetadata(run.metadata, "repositoryAccessRevisionId"),
    baseSha: stringMetadata(run.metadata, "repositoryAccessBaseSha"),
    headSha: stringMetadata(run.metadata, "repositoryAccessHeadSha"),
    workspaceStrategy:
      stringMetadata(run.metadata, "repositoryAccessWorkspaceStrategy") ??
      stringMetadata(run.metadata, "repositoryWorkspaceStrategy"),
    workspaceSetupStatus: stringMetadata(run.metadata, "workspaceSetupStatus"),
    workspaceCleanupStatus: stringMetadata(run.metadata, "workspaceCleanupStatus"),
    workspaceErrorMessage: redactedStringMetadata(run.metadata, "workspaceErrorMessage"),
  };
}

function deriveTimeoutMs(
  run: WorkflowRun,
  lastFailureEvent: WorkflowRunEvent | null,
  failureText: string,
): number | null {
  if (run.status !== "failed") {
    return null;
  }

  const eventTimeoutMs = positiveInteger(lastFailureEvent?.metadata?.timeoutMs);

  if (eventTimeoutMs !== null) {
    return eventTimeoutMs;
  }

  const match = /timed out after (\d+)\s*ms/iu.exec(failureText);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

function deriveExitCode(
  transcripts: readonly WorkflowRunTranscript[],
  failureText: string,
): number | null {
  for (let index = transcripts.length - 1; index >= 0; index -= 1) {
    const exitCode = transcripts[index]?.exitCode;

    if (typeof exitCode === "number") {
      return exitCode;
    }
  }

  const match = /\bexitCode=(-?\d+)\b/u.exec(failureText);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

function deriveStderrTail(
  transcripts: readonly WorkflowRunTranscript[],
  maxLines: number | undefined,
): string | null {
  const lineLimit = maxLines ?? defaultStderrTailMaxLines;

  for (let index = transcripts.length - 1; index >= 0; index -= 1) {
    const stderr = transcripts[index]?.stderr ?? "";

    if (stderr.trim().length === 0) {
      continue;
    }

    const lines = stderr.split(/\r?\n/u);
    const tail = lines.slice(Math.max(0, lines.length - lineLimit)).join("\n");
    return tail.length > stderrTailMaxChars ? tail.slice(tail.length - stderrTailMaxChars) : tail;
  }

  return null;
}

function summaryForRun(
  run: WorkflowRun,
  failureCategory: WorkflowRunFailureCategory | null,
  timeoutMs: number | null,
  fingerprint: WorkflowRunFingerprintDiagnostics,
): string {
  if (run.status === "completed") {
    return "Workflow run completed successfully.";
  }

  if (run.status === "cancelled") {
    return "Workflow run was cancelled.";
  }

  if (run.status !== "failed") {
    return `Workflow run is ${run.status.replaceAll("_", " ")}.`;
  }

  switch (failureCategory) {
    case "bridge_down":
      return "The harness bridge was unreachable or not configured; check GET /api/harness/status, GREENROOM_HARNESS_BASE_URL, and GREENROOM_HARNESS_TOKEN.";
    case "process_lost":
      return "The harness bridge accepted the run, but the job or child process stopped reporting liveness before producing a result.";
    case "workspace_setup_failed":
      return "The harness bridge could not prepare the approved repository snapshot workspace. Check snapshot access settings and bridge workspace configuration.";
    case "workspace_cleanup_failed":
      return "The harness finished, but cleanup of its temporary repository snapshot workspace failed. Check bridge workspace permissions and reaper configuration.";
    case "invalid_output":
      return "The harness output failed validation and could not be repaired; see validationIssues and repairAttempts.";
    case "unknown_anchor":
      return "The harness output referenced anchor keys that do not exist in the reviewed diff; see validationIssues.";
    case "timeout":
      return timeoutMs === null
        ? "The run exceeded its timeout budget before completing."
        : `The run exceeded its timeout budget of ${timeoutMs}ms before completing.`;
    case "fingerprint_changed":
      return fingerprint.currentRevisionId === null ||
        fingerprint.currentRevisionId === fingerprint.consentedRevisionId
        ? `The repository worktree changed while the harness ran, so its output was discarded. The run was consented against revision ${fingerprint.consentedRevisionId}; refresh the review and retry.`
        : `The repository worktree changed while the harness ran, so its output was discarded. The run was consented against revision ${fingerprint.consentedRevisionId}, but the review is now at revision ${fingerprint.currentRevisionId}; retry against the current revision.`;
    default:
      return run.errorMessage ?? "Workflow run failed for an unrecognized reason.";
  }
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function redactedStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = stringMetadata(metadata, key);
  return value === null ? null : redactDiagnostic(value, { maxChars: 1000 });
}

function stringArrayMetadata(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
