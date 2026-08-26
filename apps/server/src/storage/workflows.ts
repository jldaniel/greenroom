import { randomUUID } from "node:crypto";

import { asc, desc, eq, inArray } from "drizzle-orm";
import type * as z from "zod";

import { nowTimestamp } from "@greenroom/core";
import {
  defaultWorkflowRunPhaseForStatus,
  workflowApprovedScopeSchema,
  workflowDraftOutputSchema,
  workflowFinalOutputSchema,
  workflowRedactedMetadataSchema,
  workflowRunCreateInputSchema,
  workflowRunEventCreateInputSchema,
  workflowRunEventSchema,
  workflowRunSchema,
  workflowRunStatusSchema,
  workflowRunStatusTransitionSchema,
  workflowRunStatusUpdateInputSchema,
  workflowValidationIssueSchema,
  type ReviewPrId,
  type WorkflowRun,
  type WorkflowRunCreateInput,
  type WorkflowRunEvent,
  type WorkflowRunEventCreateInput,
  type WorkflowRunId,
  type WorkflowRunStatus,
  type WorkflowRunStatusUpdateInput,
} from "@greenroom/schemas";

import { reviewPrs, workflowRunEvents, workflowRuns } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type WorkflowRunRow = typeof workflowRuns.$inferSelect;
type WorkflowRunEventRow = typeof workflowRunEvents.$inferSelect;
type WorkflowRunInsert = typeof workflowRuns.$inferInsert;
type WorkflowRunEventInsert = typeof workflowRunEvents.$inferInsert;

export type WorkflowStorageIdPrefix = "workflow_run" | "workflow_event";
export type WorkflowStorageIdFactory = (prefix: WorkflowStorageIdPrefix) => string;
export type WorkflowDraftOutputInput = z.input<typeof workflowDraftOutputSchema>;
export type WorkflowFinalOutputInput = z.input<typeof workflowFinalOutputSchema>;
export type WorkflowValidationIssueInput = z.input<typeof workflowValidationIssueSchema>;
export type WorkflowApprovedScopeInput = z.input<typeof workflowApprovedScopeSchema>;
export type WorkflowRedactedMetadataInput = z.input<typeof workflowRedactedMetadataSchema>;

export interface WorkflowPersistenceOptions {
  clock?: () => string;
  idFactory?: WorkflowStorageIdFactory;
}

export interface WorkflowPersistenceService {
  createRun: (input: WorkflowRunCreateInput) => WorkflowRun;
  readRun: (id: WorkflowRunId) => WorkflowRun | null;
  listRunsByReview: (reviewId: ReviewPrId) => WorkflowRun[];
  listRunsByStatus: (statuses: WorkflowRunStatus[]) => WorkflowRun[];
  approveRun: (
    id: WorkflowRunId,
    approvedScope: WorkflowApprovedScopeInput,
    metadata?: WorkflowRedactedMetadataInput,
  ) => WorkflowRun | null;
  updateStatus: (id: WorkflowRunId, input: WorkflowRunStatusUpdateInput) => WorkflowRun | null;
  recordEvent: (input: WorkflowRunEventCreateInput) => WorkflowRunEvent | null;
  listEventsByRun: (runId: WorkflowRunId) => WorkflowRunEvent[];
  appendValidationIssues: (
    id: WorkflowRunId,
    issues: WorkflowValidationIssueInput[],
  ) => WorkflowRun | null;
  saveDraft: (id: WorkflowRunId, draft: WorkflowDraftOutputInput) => WorkflowRun | null;
  saveFinalOutput: (id: WorkflowRunId, output: WorkflowFinalOutputInput) => WorkflowRun | null;
  cancelRun: (id: WorkflowRunId, errorMessage?: string) => WorkflowRun | null;
}

export function createWorkflowPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: WorkflowPersistenceOptions = {},
): WorkflowPersistenceService {
  function createRun(input: WorkflowRunCreateInput): WorkflowRun {
    const parsed = workflowRunCreateInputSchema.parse(input);
    const reviewRow = db
      .select({ id: reviewPrs.id })
      .from(reviewPrs)
      .where(eq(reviewPrs.displayId, parsed.consentSummary.reviewDisplayId))
      .get();

    if (reviewRow === undefined) {
      throw new Error(`Review ${parsed.consentSummary.reviewDisplayId} was not found`);
    }

    const timestamp = currentTimestamp(options);
    const timing = timingForStatus(parsed.status, timestamp, emptyTiming());
    const run = workflowRunSchema.parse({
      id: createId(options, "workflow_run"),
      workflowKind: parsed.workflowKind,
      reviewDisplayId: parsed.consentSummary.reviewDisplayId,
      revisionId: parsed.revisionId,
      profileId: parsed.profileId,
      harnessKind: parsed.harnessKind,
      status: parsed.status,
      phase: parsed.phase,
      consentSummary: parsed.consentSummary,
      approvedScope: parsed.approvedScope,
      draftOutput: null,
      finalOutput: null,
      validationIssues: [],
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...timing,
      metadata: parsed.metadata,
    });

    db.insert(workflowRuns).values(runToInsert(run, reviewRow.id)).run();
    return run;
  }

  function readRun(id: WorkflowRunId): WorkflowRun | null {
    const row = db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
    return row === undefined ? null : parseWorkflowRun(row);
  }

  function listRunsByReview(reviewId: ReviewPrId): WorkflowRun[] {
    return db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.reviewId, reviewId))
      .orderBy(desc(workflowRuns.createdAt))
      .all()
      .map(parseWorkflowRun);
  }

  function listRunsByStatus(statuses: WorkflowRunStatus[]): WorkflowRun[] {
    const parsedStatuses = workflowRunStatusSchema.array().parse(statuses);

    if (parsedStatuses.length === 0) {
      return [];
    }

    return db
      .select()
      .from(workflowRuns)
      .where(inArray(workflowRuns.status, parsedStatuses))
      .orderBy(asc(workflowRuns.createdAt))
      .all()
      .map(parseWorkflowRun);
  }

  function approveRun(
    id: WorkflowRunId,
    approvedScope: WorkflowApprovedScopeInput,
    metadata: WorkflowRedactedMetadataInput = {},
  ): WorkflowRun | null {
    const parsedScope = workflowApprovedScopeSchema.parse(approvedScope);
    const parsedMetadata = workflowRedactedMetadataSchema.parse(metadata);

    return db.transaction((transaction) => {
      const row = transaction.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();

      if (row === undefined) {
        return null;
      }

      const current = parseWorkflowRun(row);
      workflowRunStatusTransitionSchema.parse({ from: current.status, to: "queued" });

      const timestamp = currentTimestamp(options);
      const timing = timingForStatus("queued", timestamp, current);
      const updated = workflowRunSchema.parse({
        ...current,
        status: "queued",
        phase: "queued",
        approvedScope: parsedScope,
        updatedAt: timestamp,
        ...timing,
        metadata: { ...current.metadata, ...parsedMetadata },
      });

      transaction
        .update(workflowRuns)
        .set(runToInsert(updated, row.reviewId))
        .where(eq(workflowRuns.id, id))
        .run();
      return updated;
    });
  }

  function updateStatus(
    id: WorkflowRunId,
    input: WorkflowRunStatusUpdateInput,
  ): WorkflowRun | null {
    const parsed = workflowRunStatusUpdateInputSchema.parse(input);

    return db.transaction((transaction) => {
      const row = transaction.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();

      if (row === undefined) {
        return null;
      }

      const current = parseWorkflowRun(row);
      workflowRunStatusTransitionSchema.parse({ from: current.status, to: parsed.status });

      const timestamp = currentTimestamp(options);
      const timing = timingForStatus(parsed.status, timestamp, current);
      const updated = workflowRunSchema.parse({
        ...current,
        status: parsed.status,
        phase:
          input.phase ??
          (current.status === parsed.status
            ? current.phase
            : defaultWorkflowRunPhaseForStatus(parsed.status)),
        errorMessage:
          parsed.errorMessage === undefined ? current.errorMessage : parsed.errorMessage,
        updatedAt: timestamp,
        ...timing,
        metadata:
          parsed.metadata === undefined
            ? current.metadata
            : { ...current.metadata, ...parsed.metadata },
      });

      transaction
        .update(workflowRuns)
        .set(runToInsert(updated, row.reviewId))
        .where(eq(workflowRuns.id, id))
        .run();
      return updated;
    });
  }

  function recordEvent(input: WorkflowRunEventCreateInput): WorkflowRunEvent | null {
    const parsed = workflowRunEventCreateInputSchema.parse(input);

    return db.transaction((transaction) => {
      const runRow = transaction
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, parsed.runId))
        .get();

      if (runRow === undefined) {
        return null;
      }

      const latestEvent = transaction
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, parsed.runId))
        .orderBy(desc(workflowRunEvents.sequenceNumber))
        .limit(1)
        .get();
      const timestamp = currentTimestamp(options);
      const event = workflowRunEventSchema.parse({
        id: createId(options, "workflow_event"),
        runId: parsed.runId,
        reviewDisplayId: consentSummaryReviewDisplayId(runRow),
        sequenceNumber: (latestEvent?.sequenceNumber ?? 0) + 1,
        eventType: parsed.eventType,
        summary: parsed.summary,
        severity: parsed.severity,
        timestamp,
        metadata: parsed.metadata,
      });

      transaction.insert(workflowRunEvents).values(eventToInsert(event, runRow.reviewId)).run();
      transaction
        .update(workflowRuns)
        .set({ updatedAt: timestamp })
        .where(eq(workflowRuns.id, parsed.runId))
        .run();
      return event;
    });
  }

  function listEventsByRun(runId: WorkflowRunId): WorkflowRunEvent[] {
    return db
      .select({ event: workflowRunEvents, reviewDisplayId: reviewPrs.displayId })
      .from(workflowRunEvents)
      .innerJoin(reviewPrs, eq(workflowRunEvents.reviewId, reviewPrs.id))
      .where(eq(workflowRunEvents.runId, runId))
      .orderBy(asc(workflowRunEvents.sequenceNumber))
      .all()
      .map((row) => parseWorkflowRunEvent(row.event, row.reviewDisplayId));
  }

  function appendValidationIssues(
    id: WorkflowRunId,
    issues: WorkflowValidationIssueInput[],
  ): WorkflowRun | null {
    const parsedIssues = workflowValidationIssueSchema.array().max(200).parse(issues);

    return updateRunPayload(id, (current, timestamp) =>
      workflowRunSchema.parse({
        ...current,
        validationIssues: [...current.validationIssues, ...parsedIssues],
        updatedAt: timestamp,
      }),
    );
  }

  function saveDraft(id: WorkflowRunId, draft: WorkflowDraftOutputInput): WorkflowRun | null {
    const parsedDraft = workflowDraftOutputSchema.parse(draft);

    return updateRunPayload(id, (current, timestamp) =>
      workflowRunSchema.parse({
        ...current,
        draftOutput: parsedDraft,
        updatedAt: timestamp,
      }),
    );
  }

  function saveFinalOutput(
    id: WorkflowRunId,
    output: WorkflowFinalOutputInput,
  ): WorkflowRun | null {
    const parsedOutput = workflowFinalOutputSchema.parse(output);

    return updateRunPayload(id, (current, timestamp) =>
      workflowRunSchema.parse({
        ...current,
        finalOutput: parsedOutput,
        updatedAt: timestamp,
      }),
    );
  }

  function cancelRun(id: WorkflowRunId, errorMessage?: string): WorkflowRun | null {
    const input: WorkflowRunStatusUpdateInput = {
      status: "cancelled",
      phase: "cancelled",
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };

    return updateStatus(id, input);
  }

  function updateRunPayload(
    id: WorkflowRunId,
    build: (current: WorkflowRun, timestamp: string) => WorkflowRun,
  ): WorkflowRun | null {
    return db.transaction((transaction) => {
      const row = transaction.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();

      if (row === undefined) {
        return null;
      }

      const updated = build(parseWorkflowRun(row), currentTimestamp(options));
      transaction
        .update(workflowRuns)
        .set(runToInsert(updated, row.reviewId))
        .where(eq(workflowRuns.id, id))
        .run();
      return updated;
    });
  }

  return {
    createRun,
    readRun,
    listRunsByReview,
    listRunsByStatus,
    approveRun,
    updateStatus,
    recordEvent,
    listEventsByRun,
    appendValidationIssues,
    saveDraft,
    saveFinalOutput,
    cancelRun,
  };
}

export function parseWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return workflowRunSchema.parse({
    id: row.id,
    workflowKind: row.workflowKind,
    reviewDisplayId: consentSummaryReviewDisplayId(row),
    revisionId: row.revisionId,
    profileId: row.profileId,
    harnessKind: row.harnessKind,
    status: row.status,
    phase: row.phase,
    consentSummary: row.consentSummary,
    approvedScope: row.approvedScope ?? null,
    draftOutput: row.draftOutput ?? null,
    finalOutput: row.finalOutput ?? null,
    validationIssues: row.validationIssues,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    metadata: row.metadata,
  });
}

export function parseWorkflowRunEvent(
  row: WorkflowRunEventRow,
  reviewDisplayId: string,
): WorkflowRunEvent {
  return workflowRunEventSchema.parse({
    id: row.id,
    runId: row.runId,
    reviewDisplayId,
    sequenceNumber: row.sequenceNumber,
    eventType: row.eventType,
    summary: row.summary,
    severity: row.severity,
    timestamp: row.timestamp,
    metadata: row.metadata,
  });
}

/**
 * The run's external reviewDisplayId is sourced from the consent summary
 * snapshot: display ids are immutable, so the snapshot can never go stale.
 */
function consentSummaryReviewDisplayId(row: WorkflowRunRow): string {
  return (row.consentSummary as { reviewDisplayId: string }).reviewDisplayId;
}

function runToInsert(run: WorkflowRun, reviewId: ReviewPrId): WorkflowRunInsert {
  return {
    id: run.id,
    workflowKind: run.workflowKind,
    reviewId,
    revisionId: run.revisionId,
    profileId: run.profileId,
    harnessKind: run.harnessKind,
    status: run.status,
    phase: run.phase,
    consentSummary: run.consentSummary,
    approvedScope: run.approvedScope,
    draftOutput: run.draftOutput,
    finalOutput: run.finalOutput,
    validationIssues: run.validationIssues,
    errorMessage: run.errorMessage,
    metadata: run.metadata,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    completedAt: run.completedAt,
    cancelledAt: run.cancelledAt,
  };
}

function eventToInsert(event: WorkflowRunEvent, reviewId: ReviewPrId): WorkflowRunEventInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = event;
  return { ...rest, reviewId };
}

function currentTimestamp(options: WorkflowPersistenceOptions): string {
  return options.clock?.() ?? nowTimestamp();
}

function createId(options: WorkflowPersistenceOptions, prefix: WorkflowStorageIdPrefix): string {
  return options.idFactory?.(prefix) ?? `${prefix}_${randomUUID()}`;
}

function emptyTiming(): WorkflowRunTiming {
  return {
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    completedAt: null,
    cancelledAt: null,
  };
}

function timingForStatus(
  status: WorkflowRunStatus,
  timestamp: string,
  current: WorkflowRunTiming,
): WorkflowRunTiming {
  const timing: WorkflowRunTiming = {
    queuedAt: current.queuedAt,
    startedAt: current.startedAt,
    finishedAt: current.finishedAt,
    completedAt: current.completedAt,
    cancelledAt: current.cancelledAt,
  };

  if (status === "queued") {
    timing.queuedAt ??= timestamp;
  }

  if (status === "running") {
    timing.queuedAt ??= timestamp;
    timing.startedAt ??= timestamp;
  }

  if (status === "completed" || status === "failed" || status === "cancelled") {
    timing.finishedAt ??= timestamp;
  }

  if (status === "completed") {
    timing.completedAt ??= timestamp;
  }

  if (status === "cancelled") {
    timing.cancelledAt ??= timestamp;
  }

  return timing;
}

interface WorkflowRunTiming {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}
