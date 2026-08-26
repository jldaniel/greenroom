import { DomainInvariantError, nowTimestamp } from "@greenroom/core";
import {
  workflowDraftOutputSchema,
  workflowRunRepairAttemptRecordSchema,
  type HarnessStreamEvent,
  type CapabilityTokenPublic,
  type WorkflowApprovedScope,
  type WorkflowDraftOutput,
  type WorkflowKind,
  type WorkflowRedactedMetadata,
  type WorkflowRun,
  type WorkflowRunEventCreateInput,
  type WorkflowRunId,
  type WorkflowRunRepairAttemptRecord,
  type WorkflowRunStatus,
  type WorkflowValidationIssue,
} from "@greenroom/schemas";

import type { AgentEventPersistenceService } from "../storage/agent-events";
import type { TokenPersistenceService } from "../storage/tokens";
import type { WorkflowPersistenceService } from "../storage/workflows";
import { readWorkflowRuntimeConfigFromEnv, type GreenroomWorkflowRuntimeConfig } from "../config";
import { redactDiagnostic, redactWorkflowMetadata } from "../config/redaction";
import { createWorkflowRuntimeObserver } from "./observability";
import type {
  WorkflowDefinition,
  WorkflowDraftSubmissionResult,
  WorkflowEventSink,
  WorkflowRepairPolicy,
  WorkflowRunMcpGrant,
  WorkflowRunner,
} from "./types";
import { acceptingWorkflowValidator, createDefaultWorkflowRepairPolicy } from "./validators";

const terminalStatuses = new Set<WorkflowRunStatus>(["completed", "failed", "cancelled"]);

/**
 * Slack added on top of a run's absolute timeout budget when computing the
 * MCP grant expiry, covering time spent waiting in the run queue plus modest
 * clock drift. Grants are still revoked eagerly on every terminal transition;
 * the expiry is the backstop that guarantees a grant cannot outlive its run
 * when that revocation is lost to a crash.
 */
export const mcpGrantExpiryGraceMs = 5 * 60_000;
const unavailableHarnessHelp =
  "Check workflow events for the current step; for harness-backed runs, verify /api/harness/status, GREENROOM_HARNESS_BASE_URL, and GREENROOM_HARNESS_TOKEN.";

const orchestratorReservedMetadataKeys = new Set([
  "absoluteTimeoutMs",
  "awaitingUserReason",
  "currentStepId",
  "definitionVersion",
  "idleTimeoutMs",
  "interruptedByServerRestart",
  "interruptedStatus",
  "lastActivityAgeMs",
  "lastActivityAt",
  "lastActivityKind",
  "lastActivitySummary",
  "lastCompletedStepId",
  "lastRepairContext",
  "maxRepairAttempts",
  "mcpGrantCreatedAt",
  "mcpGrantId",
  "mcpGrantRevokedAt",
  "mcpGrantScopes",
  "progressCompletedUnits",
  "progressPhase",
  "progressTotalUnits",
  "repairAttemptCount",
  "repairAttempts",
  "retryCreatedAt",
  "retryOfRunId",
  "retryOfStatus",
  "timeoutBudgetMs",
  "timeoutKind",
  "timeoutMs",
]);

/**
 * Removes workflow lifecycle and capability state that only the orchestrator
 * may write. API callers can attach diagnostic metadata, but it must never be
 * able to influence grant revocation, retries, repair state, or time budgets.
 */
export function stripOrchestratorReservedWorkflowMetadata(
  metadata: WorkflowRedactedMetadata,
): WorkflowRedactedMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !orchestratorReservedMetadataKeys.has(key)),
  );
}

export interface WorkflowOrchestratorOptions {
  workflows: WorkflowPersistenceService;
  tokens: TokenPersistenceService;
  agentEvents: AgentEventPersistenceService;
  definitions: readonly WorkflowDefinition[];
  clock?: () => string;
  autoResumeQueuedRuns?: boolean;
  runtimeConfig?: GreenroomWorkflowRuntimeConfig;
}

export function createWorkflowOrchestrator(options: WorkflowOrchestratorOptions): WorkflowRunner {
  const clock = options.clock ?? nowTimestamp;
  const runtimeConfig = options.runtimeConfig ?? readWorkflowRuntimeConfigFromEnv();
  const redaction = { env: process.env };
  const observer = createWorkflowRuntimeObserver(runtimeConfig, redaction);
  const definitions = new Map<WorkflowKind, WorkflowDefinition>();
  const queue: WorkflowRunId[] = [];
  const activeRuns = new Set<WorkflowRunId>();
  const controllers = new Map<WorkflowRunId, AbortController>();
  const pendingMcpGrants = new Map<WorkflowRunId, WorkflowRunMcpGrant>();
  const mcpResourceReadCounts = new Map<WorkflowRunId, number>();
  const runActivities = new Map<WorkflowRunId, WorkflowActivityReporterInternal>();
  const progressReports = new Map<WorkflowRunId, { count: number; lastAtMs: number }>();
  let draining = false;

  for (const definition of options.definitions) {
    definitions.set(definition.kind, definition);
  }

  const events: WorkflowEventSink = {
    record(input) {
      return recordWorkflowEvent(input.runId, {
        eventType: input.eventType,
        summary: input.summary,
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      });
    },
  };

  const runner: WorkflowRunner = {
    createRun(input) {
      const definition = requireDefinition(input.run.workflowKind);
      const run = options.workflows.createRun({
        ...input.run,
        status: "pending_consent",
        metadata: redactWorkflowMetadata({
          ...(definition.metadata ?? {}),
          ...input.run.metadata,
          definitionVersion: definition.version,
        }),
      });

      recordWorkflowEvent(run.id, {
        eventType: "lifecycle",
        summary: "Workflow run created and is pending consent.",
        metadata: { workflowKind: run.workflowKind, definitionVersion: definition.version },
      });
      recordAudit(run, "Workflow run is pending consent.");

      return run;
    },

    approveRun(runId) {
      const run = requireRun(runId);

      if (run.status !== "pending_consent") {
        throw new DomainInvariantError(
          `Workflow run ${run.id} cannot be approved from status ${run.status}`,
        );
      }

      const grant = createMcpGrant(run);
      let approved: WorkflowRun | null;

      try {
        approved = options.workflows.approveRun(run.id, approvedScopeFromConsent(run), {
          mcpGrantId: grant.id,
          mcpGrantScopes: grant.scopes,
          mcpGrantCreatedAt: clock(),
        });
      } catch (error) {
        options.tokens.revoke(grant.id);
        throw error;
      }

      if (approved === null) {
        options.tokens.revoke(grant.id);
        throw new DomainInvariantError(`Workflow run ${run.id} was not found during approval`);
      }

      pendingMcpGrants.set(run.id, grant);
      recordWorkflowEvent(run.id, {
        eventType: "lifecycle",
        summary: "Workflow consent approved and run queued.",
        metadata: { workflowKind: run.workflowKind, mcpGrantId: grant.id },
      });
      recordAudit(approved, "Workflow run was approved and queued.");
      enqueueRun(approved.id);

      return approved;
    },

    cancelRun(runId, reason) {
      const run = requireRun(runId);

      if (run.status === "cancelled") {
        return run;
      }

      if (run.status === "completed" || run.status === "failed") {
        throw new DomainInvariantError(
          `Workflow run ${run.id} cannot be cancelled from status ${run.status}`,
        );
      }

      const cancellationReason = redactDiagnostic(reason ?? "Workflow run cancelled.", redaction);
      controllers.get(run.id)?.abort(new Error(cancellationReason));
      const cancelled = options.workflows.cancelRun(
        run.id,
        reason === undefined
          ? "Workflow run cancelled by request."
          : redactDiagnostic(reason, redaction),
      );

      if (cancelled === null) {
        throw new DomainInvariantError(`Workflow run ${run.id} was not found during cancellation`);
      }

      queue.splice(0, queue.length, ...queue.filter((queuedRunId) => queuedRunId !== run.id));
      pendingMcpGrants.delete(run.id);
      recordWorkflowEvent(run.id, {
        eventType: "lifecycle",
        summary: "Workflow run cancelled.",
        severity: "warning",
        metadata: { reason: reason === undefined ? "cancelled" : cancellationReason },
      });
      recordAudit(cancelled, "Workflow run was cancelled.");
      revokeRunGrant(cancelled);

      return options.workflows.readRun(run.id) ?? cancelled;
    },

    retryRun(runId) {
      const run = requireRun(runId);

      if (run.status !== "failed" && run.status !== "cancelled") {
        throw new DomainInvariantError(
          `Workflow run ${run.id} cannot be retried from status ${run.status}`,
        );
      }

      const retry = runner.createRun({
        run: {
          workflowKind: run.workflowKind,
          revisionId: run.revisionId,
          profileId: run.profileId,
          harnessKind: run.harnessKind,
          consentSummary: run.consentSummary,
          metadata: {
            retryOfRunId: run.id,
            retryOfStatus: run.status,
            retryCreatedAt: clock(),
          },
        },
      });

      recordWorkflowEvent(run.id, {
        eventType: "lifecycle",
        summary: "Workflow retry run created.",
        metadata: { retryRunId: retry.id },
      });

      return retry;
    },

    readRun(runId) {
      return options.workflows.readRun(runId);
    },

    listRunsByReview(reviewId) {
      return options.workflows.listRunsByReview(reviewId);
    },

    listActiveRuns() {
      // Cross-review view for the app header run indicator and completion
      // toasts: every run that is currently occupying or waiting
      // for the workflow queue.
      return options.workflows.listRunsByStatus(["queued", "running", "repairing"]);
    },

    listEvents(runId) {
      return options.workflows.listEventsByRun(runId);
    },

    reportProgress(input) {
      const run = requireRun(input.runId);

      if (terminalStatuses.has(run.status)) {
        throw new DomainInvariantError(
          `Workflow run ${run.id} cannot accept progress from status ${run.status}`,
        );
      }

      enforceProgressRateLimit(run.id);

      return events.record({
        runId: run.id,
        eventType: "harness_progress",
        summary: input.message,
        metadata: {
          ...(input.completedUnits === undefined ? {} : { completedUnits: input.completedUnits }),
          ...(input.totalUnits === undefined ? {} : { totalUnits: input.totalUnits }),
          ...(input.phase === undefined ? {} : { phase: input.phase }),
        },
      });
    },

    async submitDraft(runId, draftInput) {
      const draft = workflowDraftOutputSchema.parse(draftInput);
      let run = requireRun(runId);

      if (run.status === "pending_consent") {
        throw new DomainInvariantError(
          `Workflow run ${run.id} requires approval before draft submission`,
        );
      }

      if (terminalStatuses.has(run.status)) {
        throw new DomainInvariantError(
          `Workflow run ${run.id} cannot accept drafts from status ${run.status}`,
        );
      }

      run = transitionToValidating(run);
      const currentRepairAttemptCount = repairAttemptCount(run.metadata);
      recordWorkflowEvent(run.id, {
        eventType: "draft_submission",
        summary: `Received ${draft.kind} draft output.`,
        metadata: {
          draftKind: draft.kind,
          repairAttemptCount: currentRepairAttemptCount,
          mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
        },
      });

      const withDraft = options.workflows.saveDraft(run.id, draft);
      run = withDraft ?? run;

      const definition = requireDefinition(run.workflowKind);
      // Definition-level repair policies win; otherwise the configurable
      // runtime default applies (GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS /
      // workflows.maxRepairAttempts, default 2).
      const repairPolicy =
        definition.repairPolicy ??
        createDefaultWorkflowRepairPolicy(runtimeConfig.operational.maxRepairAttempts);
      const validation = await (definition.validator ?? acceptingWorkflowValidator).validate(
        { run, attemptNumber: currentRepairAttemptCount + 1 },
        draft,
      );
      const issues = validation.issues;

      const blockingIssues = issues.filter((issue) => issue.severity === "error");

      if (issues.length > 0) {
        const withIssues = options.workflows.appendValidationIssues(run.id, issues);
        run = withIssues ?? run;
        recordWorkflowEvent(run.id, {
          eventType: "validation",
          summary:
            blockingIssues.length === 0
              ? `Draft validation passed with ${issues.length} warning${issues.length === 1 ? "" : "s"}.`
              : `Draft validation failed with ${blockingIssues.length} issue${blockingIssues.length === 1 ? "" : "s"}.`,
          severity: blockingIssues.length === 0 ? "warning" : "warning",
          metadata: {
            issueCodes: issues.map((issue) => issue.code),
            repairAttemptCount: currentRepairAttemptCount,
            mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
            validationFailureCount: validationFailureCount(run.validationIssues),
          },
        });
      }

      if (blockingIssues.length === 0) {
        return await completeValidDraft(run, draft, definition);
      }

      if (canAttemptRepair(blockingIssues, currentRepairAttemptCount, repairPolicy)) {
        const attemptNumber = currentRepairAttemptCount + 1;
        const repairContext = await repairPolicy.createRepairContext({
          run,
          draft,
          issues: blockingIssues,
          attemptNumber,
          createdAt: clock(),
        });
        // Run metadata carries "repair attempt N of M" plus the per-attempt
        // issue codes so run detail/status responses expose repair progress
        // (see workflowRunRepairProgressFromMetadata in @greenroom/schemas).
        const repairing = updateRunStatus(run, {
          status: "repairing",
          phase: "repairing",
          metadata: {
            repairAttemptCount: attemptNumber,
            maxRepairAttempts: repairPolicy.maxAttempts,
            repairAttempts: [
              ...repairAttemptHistory(run.metadata),
              {
                attemptNumber,
                issueCodes: [...repairContext.issueCodes],
                createdAt: repairContext.createdAt,
              },
            ],
            lastRepairContext: repairContext,
          },
        });
        recordWorkflowEvent(run.id, {
          eventType: "repair_attempt",
          summary: `Repair context generated for attempt ${attemptNumber} of ${repairPolicy.maxAttempts}.`,
          severity: "warning",
          metadata: {
            attemptNumber,
            repairAttemptCount: attemptNumber,
            maxRepairAttempts: repairPolicy.maxAttempts,
            issueCodes: repairContext.issueCodes,
            repairContext,
            mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
            validationFailureCount: validationFailureCount(run.validationIssues),
          },
        });
        const nextRun =
          definition.autoRepair === true
            ? updateRunStatus(repairing, {
                status: "queued",
                phase: "queued",
              })
            : updateRunStatus(repairing, {
                status: "awaiting_user",
                phase: "repairing",
              });

        if (definition.autoRepair === true) {
          enqueueRun(nextRun.id);
        }

        return {
          run: nextRun,
          valid: false,
          issues: blockingIssues,
          repairContext,
        };
      }

      const failed = failRun(
        run,
        `Workflow draft failed validation after ${currentRepairAttemptCount} repair attempt${currentRepairAttemptCount === 1 ? "" : "s"}.`,
        {
          issueCodes: issues.map((issue) => issue.code),
          maxRepairAttempts: repairPolicy.maxAttempts,
        },
      );

      return {
        run: failed,
        valid: false,
        issues: blockingIssues,
        repairContext: null,
      };
    },

    enqueueRun,
  };

  if (options.autoResumeQueuedRuns !== false) {
    // Startup reconciliation. Queued runs never started executing,
    // so re-enqueueing them is safe and follows the existing recovery
    // precedent. Runs persisted as running/repairing lost their in-process
    // execution state in a crash/restart and cannot be resumed, so they fail
    // through the normal failure path (failure event, audit record, MCP grant
    // revocation, onFailure handler) and stay retryable via retryRun.
    for (const stranded of options.workflows.listRunsByStatus(["running", "repairing"])) {
      failRun(
        stranded,
        `Workflow run was interrupted by a server restart while ${stranded.status}. Retry the run to continue.`,
        {
          interruptedByServerRestart: true,
          interruptedStatus: stranded.status,
          ...(stringMetadata(stranded.metadata, "currentStepId") === null
            ? {}
            : { currentStepId: stringMetadata(stranded.metadata, "currentStepId") }),
        },
      );
    }

    for (const run of options.workflows.listRunsByStatus(["queued"])) {
      enqueueRun(run.id);
    }

    // Terminal-state grant sweep: if a crash landed between a run's terminal
    // transition and its grant revocation, the run carries mcpGrantId without
    // mcpGrantRevokedAt. Revoke those now so no live read-scope credential
    // outlives its run, then sweep any tokens whose expiry already passed.
    for (const run of options.workflows.listRunsByStatus(["completed", "failed", "cancelled"])) {
      if (
        stringMetadata(run.metadata, "mcpGrantId") !== null &&
        stringMetadata(run.metadata, "mcpGrantRevokedAt") === null
      ) {
        revokeRunGrant(run);
      }
    }

    options.tokens.revokeExpired();
  }

  return runner;

  function requireDefinition(kind: WorkflowKind): WorkflowDefinition {
    const definition = definitions.get(kind);

    if (definition === undefined) {
      throw new DomainInvariantError(`Workflow kind ${kind} is not registered`);
    }

    return definition;
  }

  function requireRun(runId: WorkflowRunId): WorkflowRun {
    const run = options.workflows.readRun(runId);

    if (run === null) {
      throw new DomainInvariantError(`Workflow run ${runId} was not found`);
    }

    return run;
  }

  function enqueueRun(runId: WorkflowRunId): void {
    const run = options.workflows.readRun(runId);

    if (run === null || run.status !== "queued" || queue.includes(runId)) {
      return;
    }

    queue.push(runId);
    scheduleDrain();
  }

  async function drainQueue(): Promise<void> {
    if (draining) {
      return;
    }

    draining = true;

    try {
      while (queue.length > 0 && activeRuns.size < runtimeConfig.operational.maxConcurrentRuns) {
        const runId = queue.shift();

        if (runId !== undefined) {
          activeRuns.add(runId);
          void executeQueuedRun(runId).finally(() => {
            activeRuns.delete(runId);
            scheduleDrain();
          });
        }
      }
    } finally {
      draining = false;
    }
  }

  function scheduleDrain(): void {
    setTimeout(() => {
      void drainQueue();
    }, 0);
  }

  async function executeQueuedRun(runId: WorkflowRunId): Promise<void> {
    const run = options.workflows.readRun(runId);

    if (run === null || run.status !== "queued") {
      return;
    }

    const definition = requireDefinition(run.workflowKind);
    const controller = new AbortController();
    controllers.set(run.id, controller);
    const mcpGrant = consumeOrCreateMcpGrant(run);
    const timeouts = timeoutsForRun(run, definition, runtimeConfig.operational);
    const activity = createActivityReporter(run);

    try {
      await withRunTimeouts(
        executeDefinition(run, definition, controller.signal, mcpGrant, timeouts, activity),
        {
          idleTimeoutMs: timeouts.idleTimeoutMs,
          absoluteTimeoutMs: timeouts.absoluteTimeoutMs,
          controller,
          activity,
        },
      );
    } catch (error) {
      const latest = options.workflows.readRun(run.id);

      if (latest === null || terminalStatuses.has(latest.status)) {
        return;
      }

      if (error instanceof WorkflowTimeoutError) {
        const activitySnapshot = activity.snapshot();
        failRun(latest, actionableTimeoutMessage(latest, error, activitySnapshot), {
          timeoutMs: error.timeoutMs,
          timeoutKind: error.kind,
          idleTimeoutMs: timeouts.idleTimeoutMs,
          absoluteTimeoutMs: timeouts.absoluteTimeoutMs,
          currentStepId: stringMetadata(latest.metadata, "currentStepId"),
          phase: latest.phase,
          lastActivityAt: activitySnapshot.lastActivityAtIso,
          lastActivitySummary: activitySnapshot.summary,
          lastActivityAgeMs: activitySnapshot.ageMs,
        });
        return;
      }

      if (controller.signal.aborted) {
        const aborted = options.workflows.readRun(run.id);

        if (aborted !== null && aborted.status !== "cancelled") {
          failRun(aborted, "Workflow run aborted.", {});
        }
        return;
      }

      failRun(
        latest,
        error instanceof Error
          ? redactDiagnostic(error.message, redaction)
          : "Workflow run failed.",
        {},
      );
    } finally {
      controllers.delete(run.id);
      mcpResourceReadCounts.delete(run.id);
      runActivities.delete(run.id);
      progressReports.delete(run.id);
    }
  }

  async function executeDefinition(
    initialRun: WorkflowRun,
    definition: WorkflowDefinition,
    signal: AbortSignal,
    mcpGrant: WorkflowRunMcpGrant | null,
    timeouts: WorkflowRunTimeouts,
    activity: WorkflowActivityReporterInternal,
  ): Promise<void> {
    let run = initialRun;

    for (const step of definition.steps) {
      throwIfAborted(signal);
      const latest = options.workflows.readRun(run.id);

      if (latest === null || terminalStatuses.has(latest.status)) {
        return;
      }

      if (latest.status !== "queued" && latest.status !== "running") {
        return;
      }

      const stepStartedAt = Date.now();
      // timeoutBudgetMs is persisted so harness run requests built from this
      // run always carry the API-side absolute timeout backstop to the bridge.
      run = updateRunStatus(latest, {
        status: "running",
        phase: step.phase,
        metadata: {
          currentStepId: step.id,
          timeoutBudgetMs: timeouts.absoluteTimeoutMs,
          idleTimeoutMs: timeouts.idleTimeoutMs,
          absoluteTimeoutMs: timeouts.absoluteTimeoutMs,
        },
      });
      recordWorkflowEvent(run.id, {
        eventType: step.eventType ?? "lifecycle",
        summary: `Step started: ${step.summary}`,
        metadata: {
          stepId: step.id,
          phase: step.phase,
          status: "running",
          repairAttemptCount: repairAttemptCount(run.metadata),
          mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
          validationFailureCount: validationFailureCount(run.validationIssues),
        },
      });

      const result = await step.run({ run, signal, events, mcpGrant, activity });
      throwIfAborted(signal);
      const latestAfterStep = options.workflows.readRun(run.id);

      if (latestAfterStep === null || latestAfterStep.status !== "running") {
        return;
      }

      run = latestAfterStep;
      recordWorkflowEvent(run.id, {
        eventType: step.eventType ?? "lifecycle",
        summary: `Step completed: ${step.summary}`,
        metadata: {
          stepId: step.id,
          phase: step.phase,
          status: latestAfterStep.status,
          durationMs: Date.now() - stepStartedAt,
          repairAttemptCount: repairAttemptCount(latestAfterStep.metadata),
          mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
          validationFailureCount: validationFailureCount(latestAfterStep.validationIssues),
        },
      });
      run = updateRunStatus(run, {
        status: "running",
        phase: step.phase,
        metadata: { lastCompletedStepId: step.id },
      });

      if (result?.metadata !== undefined) {
        run = updateRunStatus(run, {
          status: "running",
          phase: step.phase,
          metadata: result.metadata,
        });
      }

      if (result?.draftOutput !== undefined) {
        const submission = await runner.submitDraft(run.id, result.draftOutput);
        run = submission.run;

        if (!submission.valid || terminalStatuses.has(run.status)) {
          return;
        }
      }

      if (result?.finalOutput !== undefined) {
        const withFinal = options.workflows.saveFinalOutput(run.id, result.finalOutput);
        run = withFinal ?? run;
        completeRun(run);
        return;
      }
    }

    const latest = options.workflows.readRun(run.id);

    if (latest !== null && latest.status === "running") {
      completeRun(latest);
    }
  }

  function transitionToValidating(run: WorkflowRun): WorkflowRun {
    if (run.status === "running") {
      return updateRunStatus(run, { status: "running", phase: "validating" });
    }

    return updateRunStatus(run, { status: "running", phase: "validating" });
  }

  async function completeValidDraft(
    run: WorkflowRun,
    draft: WorkflowDraftOutput,
    definition: WorkflowDefinition,
  ): Promise<WorkflowDraftSubmissionResult> {
    recordWorkflowEvent(run.id, {
      eventType: "validation",
      summary: "Draft validation passed.",
      metadata: {
        draftKind: draft.kind,
        repairAttemptCount: repairAttemptCount(run.metadata),
        mcpResourceReadCount: mcpResourceReadCounts.get(run.id) ?? 0,
        validationFailureCount: validationFailureCount(run.validationIssues),
      },
    });
    const validDraftResult = await definition.onValidDraft?.handle({ run, draft, events });
    let latest = options.workflows.readRun(run.id) ?? run;

    if (validDraftResult?.metadata !== undefined) {
      latest = updateRunStatus(latest, {
        status: latest.status,
        metadata: validDraftResult.metadata,
      });
    }

    if (validDraftResult?.disposition === "awaiting_user") {
      const awaitingUser = updateRunStatus(latest, {
        status: "awaiting_user",
        phase: "awaiting_user",
        metadata: {
          awaitingUserReason: redactDiagnostic(
            validDraftResult.summary ?? "Workflow is awaiting user action.",
            redaction,
          ),
        },
      });
      recordWorkflowEvent(run.id, {
        eventType: "lifecycle",
        summary: validDraftResult.summary ?? "Workflow is awaiting user action.",
        metadata: { workflowKind: run.workflowKind },
      });
      recordAudit(awaitingUser, validDraftResult.summary ?? "Workflow is awaiting user action.");
      revokeRunGrant(awaitingUser);

      return {
        run: options.workflows.readRun(run.id) ?? awaitingUser,
        valid: true,
        issues: [],
        repairContext: null,
      };
    }

    const finalOutput =
      validDraftResult?.finalOutput === null ? undefined : (validDraftResult?.finalOutput ?? draft);

    if (finalOutput !== undefined) {
      latest = options.workflows.saveFinalOutput(run.id, finalOutput) ?? latest;
    }

    const completed = completeRun(latest);

    return {
      run: completed,
      valid: true,
      issues: [],
      repairContext: null,
    };
  }

  function completeRun(run: WorkflowRun): WorkflowRun {
    const completed = updateRunStatus(run, { status: "completed", phase: "completed" });
    recordWorkflowEvent(run.id, {
      eventType: "persistence",
      summary: "Workflow run completed.",
      metadata: { workflowKind: run.workflowKind },
    });
    recordAudit(completed, "Workflow run completed.");
    revokeRunGrant(completed);

    return options.workflows.readRun(run.id) ?? completed;
  }

  function failRun(
    run: WorkflowRun,
    errorMessage: string,
    metadata: WorkflowRedactedMetadata,
  ): WorkflowRun {
    if (terminalStatuses.has(run.status)) {
      return run;
    }

    const failed = updateRunStatus(run, {
      status: "failed",
      phase: "failed",
      errorMessage,
      metadata,
    });
    recordWorkflowEvent(run.id, {
      eventType: "failure",
      summary: errorMessage,
      severity: "error",
      metadata,
    });
    recordAudit(failed, `Workflow run failed: ${errorMessage}`);
    revokeRunGrant(failed);
    const failureHandler = definitions.get(run.workflowKind)?.onFailure;

    if (failureHandler !== undefined) {
      void Promise.resolve(failureHandler.handle({ run: failed, errorMessage, events })).catch(
        () => undefined,
      );
    }

    return options.workflows.readRun(run.id) ?? failed;
  }

  function updateRunStatus(
    run: WorkflowRun,
    input: Parameters<WorkflowPersistenceService["updateStatus"]>[1],
  ): WorkflowRun {
    const updated = options.workflows.updateStatus(run.id, {
      ...input,
      ...(input.errorMessage === undefined
        ? {}
        : {
            errorMessage:
              input.errorMessage === null ? null : redactDiagnostic(input.errorMessage, redaction),
          }),
      ...(input.metadata === undefined
        ? {}
        : { metadata: redactWorkflowMetadata(input.metadata, redaction) }),
    });

    if (updated === null) {
      throw new DomainInvariantError(`Workflow run ${run.id} was not found`);
    }

    return updated;
  }

  function recordWorkflowEvent(
    runId: WorkflowRunId,
    input: Omit<WorkflowRunEventCreateInput, "runId" | "metadata"> & {
      metadata?: WorkflowRedactedMetadata;
    },
  ): ReturnType<WorkflowPersistenceService["recordEvent"]> {
    const countMetadata =
      input.eventType === "mcp_resource_read" ? nextMcpResourceReadMetadata(runId) : {};
    const metadata = redactWorkflowMetadata(
      {
        ...input.metadata,
        ...countMetadata,
      },
      redaction,
    );
    const event = options.workflows.recordEvent({
      runId,
      eventType: input.eventType,
      summary: redactDiagnostic(input.summary, redaction),
      severity: input.severity ?? "info",
      metadata,
    });

    emitWorkflowRuntimeEvent(
      runId,
      input.eventType,
      input.severity ?? "info",
      input.summary,
      metadata,
    );
    if (input.eventType === "mcp_resource_read" || input.eventType === "harness_progress") {
      runActivities.get(runId)?.record({
        runId,
        summary: input.summary,
        metadata: {
          eventType: input.eventType,
          ...metadata,
        },
      });
    }
    return event;
  }

  function recordAudit(run: WorkflowRun, summary: string): void {
    options.agentEvents.create({
      reviewDisplayId: run.reviewDisplayId,
      eventType: "status_update",
      source: {
        kind: "system",
        displayName: "Greenroom workflow orchestrator",
      },
      threadRefs: [],
      summary: redactDiagnostic(summary, redaction),
      metadata: redactWorkflowMetadata({
        workflowRunId: run.id,
        workflowKind: run.workflowKind,
        status: run.status,
      }),
    });
  }

  function emitWorkflowRuntimeEvent(
    runId: WorkflowRunId,
    eventType: WorkflowRunEventCreateInput["eventType"],
    severity: NonNullable<WorkflowRunEventCreateInput["severity"]>,
    summary: string,
    metadata: WorkflowRedactedMetadata,
  ): void {
    const run = options.workflows.readRun(runId);
    const tracingEnabled =
      runtimeConfig.tracing.enabled || run?.consentSummary.tracingStatus === "redacted";

    observer.record({
      timestamp: clock(),
      runId,
      reviewDisplayId: run?.reviewDisplayId ?? null,
      workflowKind: run?.workflowKind ?? "unknown",
      eventType,
      severity,
      status: run?.status ?? "unknown",
      phase: run?.phase ?? null,
      durationMs: numberMetadata(metadata, "durationMs"),
      summary,
      metadata,
      tracing: {
        enabled: tracingEnabled,
        mode: tracingEnabled ? "redacted" : "disabled",
        otlpEndpointConfigured: runtimeConfig.tracing.otlpEndpoint !== null,
        langchainEnabled: runtimeConfig.tracing.langchainEnabled,
      },
    });
  }

  function nextMcpResourceReadMetadata(runId: WorkflowRunId): WorkflowRedactedMetadata {
    const nextCount = (mcpResourceReadCounts.get(runId) ?? 0) + 1;
    const limit = runtimeConfig.operational.maxMcpResourceReadEvents;

    if (limit !== null && nextCount > limit) {
      throw new DomainInvariantError(
        `Workflow run ${runId} exceeded the maximum recorded MCP resource reads (${limit}).`,
      );
    }

    mcpResourceReadCounts.set(runId, nextCount);

    return {
      mcpResourceReadCount: nextCount,
      ...(limit === null ? {} : { mcpResourceReadLimit: limit }),
    };
  }

  function enforceProgressRateLimit(runId: WorkflowRunId): void {
    const now = Date.now();
    const current = progressReports.get(runId) ?? { count: 0, lastAtMs: 0 };
    const minIntervalMs = 2_000;
    const maxReports = 500;

    if (current.count >= maxReports) {
      throw new DomainInvariantError(
        `Workflow run ${runId} exceeded the maximum progress reports (${maxReports}).`,
      );
    }

    if (current.lastAtMs > 0 && now - current.lastAtMs < minIntervalMs) {
      throw new DomainInvariantError(
        `Workflow run ${runId} reported progress too frequently; wait at least ${minIntervalMs}ms between reports.`,
      );
    }

    progressReports.set(runId, { count: current.count + 1, lastAtMs: now });
  }

  function createActivityReporter(run: WorkflowRun): WorkflowActivityReporterInternal {
    const now = Date.now();
    let state: WorkflowActivityState = {
      runId: run.id,
      lastActivityAtMs: now,
      lastActivityAtIso: clock(),
      summary: "Workflow run started.",
      kind: "lifecycle",
    };
    const reporter: WorkflowActivityReporterInternal = {
      record(input) {
        state = {
          runId: input.runId,
          lastActivityAtMs: Date.now(),
          lastActivityAtIso: clock(),
          summary: redactDiagnostic(input.summary, redaction),
          kind: stringMetadata(input.metadata ?? {}, "eventType") ?? "activity",
        };
        runActivities.set(input.runId, reporter);
        const latest = options.workflows.readRun(input.runId);

        if (latest === null || terminalStatuses.has(latest.status)) {
          return;
        }

        options.workflows.updateStatus(input.runId, {
          status: latest.status,
          metadata: {
            lastActivityAt: state.lastActivityAtIso,
            lastActivitySummary: state.summary,
            lastActivityKind: state.kind,
            ...(numberMetadata(input.metadata ?? {}, "completedUnits") === null
              ? {}
              : { progressCompletedUnits: numberMetadata(input.metadata ?? {}, "completedUnits") }),
            ...(numberMetadata(input.metadata ?? {}, "totalUnits") === null
              ? {}
              : { progressTotalUnits: numberMetadata(input.metadata ?? {}, "totalUnits") }),
            ...(stringMetadata(input.metadata ?? {}, "phase") === null
              ? {}
              : { progressPhase: stringMetadata(input.metadata ?? {}, "phase") }),
          },
        });
      },
      recordHarnessEvent(event) {
        reporter.record({
          runId: run.id,
          summary: event.summary,
          metadata: {
            eventType: "harness_stream",
            harnessEventKind: event.kind,
            harnessEventSequence: event.sequence,
          },
        });
      },
      snapshot() {
        return { ...state, ageMs: Math.max(0, Date.now() - state.lastActivityAtMs) };
      },
    };
    runActivities.set(run.id, reporter);

    return reporter;
  }

  function createMcpGrant(run: WorkflowRun): WorkflowRunMcpGrant {
    // TTL backstop derived from the run's absolute timeout budget: even if a
    // crash prevents the terminal-state revocation, the grant expires shortly
    // after the run could last have been alive.
    const definition = definitions.get(run.workflowKind);
    const absoluteTimeoutMs =
      definition === undefined
        ? runtimeConfig.operational.absoluteTimeoutMs
        : timeoutsForRun(run, definition, runtimeConfig.operational).absoluteTimeoutMs;
    const expiresAt = new Date(
      Date.parse(clock()) + absoluteTimeoutMs + mcpGrantExpiryGraceMs,
    ).toISOString();
    const created = options.tokens.create({
      name: `Workflow ${run.id} MCP grant`,
      scopes: ["read"],
      expiresAt,
    });

    return {
      id: created.token.id,
      scopes: created.token.scopes,
      plaintextToken: created.plaintextToken,
    };
  }

  function consumeOrCreateMcpGrant(run: WorkflowRun): WorkflowRunMcpGrant | null {
    const pending = pendingMcpGrants.get(run.id);

    if (pending !== undefined) {
      pendingMcpGrants.delete(run.id);
      return pending;
    }

    const staleGrantId = stringMetadata(run.metadata, "mcpGrantId");
    const grant = createMcpGrant(run);

    if (staleGrantId !== null) {
      options.tokens.revoke(staleGrantId as CapabilityTokenPublic["id"]);
    }

    updateRunStatus(run, {
      status: run.status,
      metadata: {
        mcpGrantId: grant.id,
        mcpGrantScopes: grant.scopes,
        mcpGrantCreatedAt: clock(),
      },
    });

    return grant;
  }

  function revokeRunGrant(run: WorkflowRun): void {
    pendingMcpGrants.delete(run.id);
    const grantId = stringMetadata(run.metadata, "mcpGrantId");

    if (grantId === null) {
      return;
    }

    // The current token store has no expiry column; the durable public grant id lets
    // completed, cancelled, failed, and resumed runs explicitly revoke their grant.
    options.tokens.revoke(grantId as CapabilityTokenPublic["id"]);
    options.workflows.updateStatus(run.id, {
      status: run.status,
      metadata: { mcpGrantRevokedAt: clock() },
    });
  }

  function approvedScopeFromConsent(run: WorkflowRun): WorkflowApprovedScope {
    return {
      label: run.consentSummary.scopeLabel,
      revisionId: run.revisionId,
      filePaths: run.consentSummary.changedFiles.files.map((file) => file.path),
      changedFiles: run.consentSummary.changedFiles,
      metadata: {
        approvedAt: clock(),
        source: "workflow_consent",
        repositoryAccessMode: run.consentSummary.repositoryAccess.mode,
        repositoryAccessReadScopeLabel: run.consentSummary.repositoryAccess.readScopeLabel,
        ...(run.consentSummary.repositoryAccess.revisionId === null
          ? {}
          : { repositoryAccessRevisionId: run.consentSummary.repositoryAccess.revisionId }),
        ...(run.consentSummary.repositoryAccess.baseSha === null
          ? {}
          : { repositoryAccessBaseSha: run.consentSummary.repositoryAccess.baseSha }),
        ...(run.consentSummary.repositoryAccess.headSha === null
          ? {}
          : { repositoryAccessHeadSha: run.consentSummary.repositoryAccess.headSha }),
        ...(run.consentSummary.repositoryAccess.workspaceStrategy === null
          ? {}
          : {
              repositoryAccessWorkspaceStrategy:
                run.consentSummary.repositoryAccess.workspaceStrategy,
            }),
      },
    };
  }
}

function canAttemptRepair(
  issues: readonly WorkflowValidationIssue[],
  currentRepairAttemptCount: number,
  repairPolicy: WorkflowRepairPolicy,
): boolean {
  return (
    currentRepairAttemptCount < repairPolicy.maxAttempts &&
    issues.every((issue) => issue.recoverable !== false)
  );
}

function repairAttemptCount(metadata: WorkflowRedactedMetadata): number {
  const value = metadata.repairAttemptCount;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function repairAttemptHistory(
  metadata: WorkflowRedactedMetadata,
): WorkflowRunRepairAttemptRecord[] {
  const value = metadata.repairAttempts;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const parsed = workflowRunRepairAttemptRecordSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function validationFailureCount(issues: readonly WorkflowValidationIssue[]): number {
  return issues.filter((issue) => issue.severity === "error").length;
}

function stringMetadata(metadata: WorkflowRedactedMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberMetadata(metadata: WorkflowRedactedMetadata, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface WorkflowRunTimeouts {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}

interface WorkflowActivityState {
  runId: WorkflowRunId;
  lastActivityAtMs: number;
  lastActivityAtIso: string;
  summary: string;
  kind: string;
}

interface WorkflowActivitySnapshot extends WorkflowActivityState {
  ageMs: number;
}

interface WorkflowActivityReporterInternal {
  record: (input: {
    runId: WorkflowRunId;
    summary: string;
    metadata?: WorkflowRedactedMetadata;
  }) => void;
  recordHarnessEvent: (event: HarnessStreamEvent) => void;
  snapshot: () => WorkflowActivitySnapshot;
}

function timeoutsForRun(
  run: WorkflowRun,
  definition: WorkflowDefinition,
  operational: GreenroomWorkflowRuntimeConfig["operational"],
): WorkflowRunTimeouts {
  const idleOverride = positiveIntegerMetadata(run.metadata.idleTimeoutMs);
  const absoluteOverride = positiveIntegerMetadata(
    run.metadata.absoluteTimeoutMs ?? definition.defaultTimeoutMs,
  );

  return {
    idleTimeoutMs: idleOverride ?? operational.idleTimeoutMs,
    absoluteTimeoutMs: absoluteOverride ?? operational.absoluteTimeoutMs,
  };
}

function positiveIntegerMetadata(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function actionableTimeoutMessage(
  run: WorkflowRun,
  error: WorkflowTimeoutError,
  activity: WorkflowActivitySnapshot,
): string {
  const stepId = stringMetadata(run.metadata, "currentStepId");
  const stepText = stepId === null ? "" : ` during step ${stepId}`;
  const lastActivity = ` Last activity was ${activity.ageMs}ms ago: ${activity.summary}.`;

  if (error.kind === "idle_timeout") {
    return `Workflow idle timeout after ${error.timeoutMs}ms with no observed activity${stepText} while in phase ${run.phase}.${lastActivity} ${unavailableHarnessHelp}`;
  }

  return `Workflow absolute timeout after ${error.timeoutMs}ms${stepText} while in phase ${run.phase}.${lastActivity} ${unavailableHarnessHelp}`;
}

async function withRunTimeouts<T>(
  promise: Promise<T>,
  input: {
    idleTimeoutMs?: number;
    absoluteTimeoutMs: number;
    controller: AbortController;
    activity?: Pick<WorkflowActivityReporterInternal, "snapshot">;
  },
): Promise<T> {
  let absoluteTimeout: ReturnType<typeof setTimeout> | null = null;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    absoluteTimeout = setTimeout(() => {
      const error = new WorkflowTimeoutError("budget_exceeded", input.absoluteTimeoutMs);
      input.controller.abort(error);
      reject(error);
    }, input.absoluteTimeoutMs);

    const idleTimeoutMs = input.idleTimeoutMs;
    const activity = input.activity;

    if (idleTimeoutMs === undefined || idleTimeoutMs <= 0 || activity === undefined) {
      return;
    }

    // Resettable idle watchdog: sleep until the current activity window would
    // expire, then re-check the reporter's lastActivityAt. Activity recorded
    // while the timer was pending pushes the next check out by the remaining
    // window; a run with no observed activity for idleTimeoutMs aborts through
    // the same controller/failure path as the absolute timeout.
    const armIdleWatchdog = (delayMs: number): void => {
      idleTimeout = setTimeout(
        () => {
          const ageMs = activity.snapshot().ageMs;

          if (ageMs >= idleTimeoutMs) {
            const error = new WorkflowTimeoutError("idle_timeout", idleTimeoutMs);
            input.controller.abort(error);
            reject(error);
            return;
          }

          armIdleWatchdog(idleTimeoutMs - ageMs);
        },
        Math.max(1, delayMs),
      );
    };

    armIdleWatchdog(idleTimeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (absoluteTimeout !== null) {
      clearTimeout(absoluteTimeout);
    }

    if (idleTimeout !== null) {
      clearTimeout(idleTimeout);
    }

    promise.catch(() => undefined);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Workflow run aborted.");
  }
}

class WorkflowTimeoutError extends Error {
  constructor(
    readonly kind: "idle_timeout" | "budget_exceeded",
    readonly timeoutMs: number,
  ) {
    super(
      kind === "idle_timeout"
        ? `Workflow idle timeout after ${timeoutMs}ms.`
        : `Workflow absolute timeout after ${timeoutMs}ms.`,
    );
    this.name = "WorkflowTimeoutError";
  }
}
