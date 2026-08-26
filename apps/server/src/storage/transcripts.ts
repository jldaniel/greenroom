import { randomUUID } from "node:crypto";

import { asc, eq, inArray, lt, sql } from "drizzle-orm";
import * as z from "zod";

import { nowTimestamp } from "@greenroom/core";
import {
  harnessStreamEventSchema,
  workflowRunIdSchema,
  type HarnessStreamEvent,
  type WorkflowRunId,
} from "@greenroom/schemas";

import {
  readTranscriptRetentionConfigFromEnv,
  type WorkflowTranscriptRetentionConfig,
} from "../config/transcripts";
import { redactString, type RedactionOptions } from "../config/redaction";
import { workflowRunHarnessEvents, workflowRunTranscripts } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type WorkflowRunTranscriptRow = typeof workflowRunTranscripts.$inferSelect;
type WorkflowRunHarnessEventRow = typeof workflowRunHarnessEvents.$inferSelect;

/**
 * Redacted per-run harness transcript persistence.
 *
 * Every field is passed through the shared redaction utility before it is
 * written, individual fields are truncated at a hard per-field cap, and the
 * store is bounded by configurable max-age and max-total-size retention caps
 * that evict the oldest transcripts first.
 */

export const workflowRunTranscriptStatusSchema = z.enum(["completed", "failed"]);

export const workflowRunTranscriptSchema = z.object({
  id: z.string().min(1),
  runId: workflowRunIdSchema,
  profileId: z.string().nullable(),
  workflowKind: z.string().min(1),
  attempt: z.number().int().min(0),
  status: workflowRunTranscriptStatusSchema,
  exitCode: z.number().int().nullable(),
  prompt: z.string(),
  output: z.string().nullable(),
  stderr: z.string(),
  redacted: z.boolean(),
  truncated: z.boolean(),
  promptBytes: z.number().int().min(0),
  outputBytes: z.number().int().min(0),
  stderrBytes: z.number().int().min(0),
  totalBytes: z.number().int().min(0),
  createdAt: z.string(),
});

export const workflowRunTranscriptMetadataSchema = workflowRunTranscriptSchema.omit({
  prompt: true,
  output: true,
  stderr: true,
});

export const workflowRunHarnessEventSchema = z.object({
  id: z.string().min(1),
  runId: workflowRunIdSchema,
  profileId: z.string().nullable(),
  workflowKind: z.string().min(1),
  attempt: z.number().int().min(0),
  sequenceNumber: z.number().int().min(1),
  event: harnessStreamEventSchema,
  redacted: z.boolean(),
  truncated: z.boolean(),
  totalBytes: z.number().int().min(0),
  createdAt: z.string(),
});

export type WorkflowRunTranscript = z.infer<typeof workflowRunTranscriptSchema>;
export type WorkflowRunTranscriptMetadata = z.infer<typeof workflowRunTranscriptMetadataSchema>;
export type WorkflowRunTranscriptStatus = z.infer<typeof workflowRunTranscriptStatusSchema>;
export type WorkflowRunHarnessEvent = z.infer<typeof workflowRunHarnessEventSchema>;

/** Hard cap applied to each persisted transcript field, in characters. */
export const maxTranscriptFieldChars = 200_000;

export interface SaveWorkflowRunTranscriptInput {
  runId: WorkflowRunId;
  profileId?: string | null;
  workflowKind: string;
  attempt?: number;
  status: WorkflowRunTranscriptStatus;
  exitCode?: number | null;
  prompt: string;
  output?: string | null;
  stderr?: string;
  /** Additional secret values (for example the run-scoped MCP token). */
  extraSecrets?: readonly string[];
}

export interface SaveWorkflowRunHarnessEventInput {
  runId: WorkflowRunId;
  profileId?: string | null;
  workflowKind: string;
  attempt?: number;
  event: HarnessStreamEvent;
  extraSecrets?: readonly string[];
}

export interface WorkflowTranscriptRetentionResult {
  deletedByAge: number;
  deletedBySize: number;
}

export interface WorkflowTranscriptPersistenceOptions {
  clock?: () => string;
  config?: WorkflowTranscriptRetentionConfig;
  env?: Record<string, string | undefined>;
}

export interface WorkflowTranscriptPersistenceService {
  config: WorkflowTranscriptRetentionConfig;
  save: (input: SaveWorkflowRunTranscriptInput) => WorkflowRunTranscript | null;
  saveEvent: (input: SaveWorkflowRunHarnessEventInput) => WorkflowRunHarnessEvent | null;
  listByRun: (runId: WorkflowRunId) => WorkflowRunTranscript[];
  listMetadataByRun: (runId: WorkflowRunId) => WorkflowRunTranscriptMetadata[];
  listEventsByRun: (runId: WorkflowRunId) => WorkflowRunHarnessEvent[];
  totalBytes: () => number;
  enforceRetention: () => WorkflowTranscriptRetentionResult;
  purgeAll: () => number;
}

export function createWorkflowTranscriptPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: WorkflowTranscriptPersistenceOptions = {},
): WorkflowTranscriptPersistenceService {
  const config = options.config ?? readTranscriptRetentionConfigFromEnv(options.env);
  const env = options.env ?? process.env;

  function save(input: SaveWorkflowRunTranscriptInput): WorkflowRunTranscript | null {
    if (!config.enabled) {
      return null;
    }

    const redaction: RedactionOptions = {
      env,
      extraSecrets: (input.extraSecrets ?? []).filter((secret) => secret.trim().length > 0),
    };
    const prompt = truncateHead(redactString(input.prompt, redaction));
    const output =
      input.output === undefined || input.output === null
        ? null
        : truncateHead(redactString(input.output, redaction));
    const stderr = truncateTail(redactString(input.stderr ?? "", redaction));
    const truncated = prompt.truncated || (output?.truncated ?? false) || stderr.truncated;
    const promptBytes = byteLength(prompt.value);
    const outputBytes = output === null ? 0 : byteLength(output.value);
    const stderrBytes = byteLength(stderr.value);
    const transcript = workflowRunTranscriptSchema.parse({
      id: `workflow_transcript_${randomUUID()}`,
      runId: input.runId,
      profileId: input.profileId ?? null,
      workflowKind: input.workflowKind,
      attempt: input.attempt ?? 0,
      status: input.status,
      exitCode: input.exitCode ?? null,
      prompt: prompt.value,
      output: output === null ? null : output.value,
      stderr: stderr.value,
      redacted: true,
      truncated,
      promptBytes,
      outputBytes,
      stderrBytes,
      totalBytes: promptBytes + outputBytes + stderrBytes,
      createdAt: currentTimestamp(),
    });

    db.insert(workflowRunTranscripts).values(transcript).run();
    enforceRetention();

    return transcript;
  }

  function saveEvent(input: SaveWorkflowRunHarnessEventInput): WorkflowRunHarnessEvent | null {
    if (!config.enabled) {
      return null;
    }

    const redaction: RedactionOptions = {
      env,
      extraSecrets: (input.extraSecrets ?? []).filter((secret) => secret.trim().length > 0),
    };
    const redactedEvent = redactHarnessEvent(input.event, redaction);
    const serialized = truncateTail(JSON.stringify(redactedEvent));
    const parsedEvent = harnessStreamEventSchema.parse(JSON.parse(serialized.value));
    const event = workflowRunHarnessEventSchema.parse({
      id: `workflow_harness_event_${randomUUID()}`,
      runId: input.runId,
      profileId: input.profileId ?? null,
      workflowKind: input.workflowKind,
      attempt: input.attempt ?? 0,
      sequenceNumber: parsedEvent.sequence,
      event: parsedEvent,
      redacted: true,
      truncated: serialized.truncated,
      totalBytes: byteLength(serialized.value),
      createdAt: currentTimestamp(),
    });

    db.insert(workflowRunHarnessEvents).values(event).onConflictDoNothing().run();
    enforceRetention();

    return event;
  }

  function listByRun(runId: WorkflowRunId): WorkflowRunTranscript[] {
    return db
      .select()
      .from(workflowRunTranscripts)
      .where(eq(workflowRunTranscripts.runId, runId))
      .orderBy(asc(workflowRunTranscripts.createdAt), asc(workflowRunTranscripts.id))
      .all()
      .map(parseTranscript);
  }

  function listMetadataByRun(runId: WorkflowRunId): WorkflowRunTranscriptMetadata[] {
    return listByRun(runId).map((transcript) =>
      workflowRunTranscriptMetadataSchema.parse(transcript),
    );
  }

  function listEventsByRun(runId: WorkflowRunId): WorkflowRunHarnessEvent[] {
    return db
      .select()
      .from(workflowRunHarnessEvents)
      .where(eq(workflowRunHarnessEvents.runId, runId))
      .orderBy(asc(workflowRunHarnessEvents.sequenceNumber))
      .all()
      .map(parseHarnessEvent);
  }

  function totalBytes(): number {
    const transcriptRow = db
      .select({
        total: sql<number | null>`sum(${workflowRunTranscripts.totalBytes})`,
      })
      .from(workflowRunTranscripts)
      .get();
    const eventRow = db
      .select({
        total: sql<number | null>`sum(${workflowRunHarnessEvents.totalBytes})`,
      })
      .from(workflowRunHarnessEvents)
      .get();

    return (transcriptRow?.total ?? 0) + (eventRow?.total ?? 0);
  }

  function enforceRetention(): WorkflowTranscriptRetentionResult {
    const cutoff = new Date(
      Date.parse(currentTimestamp()) - config.maxAgeDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const expiredTranscripts = db
      .select({ id: workflowRunTranscripts.id })
      .from(workflowRunTranscripts)
      .where(lt(workflowRunTranscripts.createdAt, cutoff))
      .all()
      .map((row) => row.id);
    const expiredEvents = db
      .select({ id: workflowRunHarnessEvents.id })
      .from(workflowRunHarnessEvents)
      .where(lt(workflowRunHarnessEvents.createdAt, cutoff))
      .all()
      .map((row) => row.id);

    if (expiredTranscripts.length > 0) {
      db.delete(workflowRunTranscripts)
        .where(inArray(workflowRunTranscripts.id, expiredTranscripts))
        .run();
    }

    if (expiredEvents.length > 0) {
      db.delete(workflowRunHarnessEvents)
        .where(inArray(workflowRunHarnessEvents.id, expiredEvents))
        .run();
    }

    const transcriptRows = db
      .select({
        kind: sql<"transcript">`'transcript'`,
        id: workflowRunTranscripts.id,
        totalBytes: workflowRunTranscripts.totalBytes,
        createdAt: workflowRunTranscripts.createdAt,
      })
      .from(workflowRunTranscripts)
      .orderBy(asc(workflowRunTranscripts.createdAt), asc(workflowRunTranscripts.id))
      .all();
    const eventRows = db
      .select({
        kind: sql<"event">`'event'`,
        id: workflowRunHarnessEvents.id,
        totalBytes: workflowRunHarnessEvents.totalBytes,
        createdAt: workflowRunHarnessEvents.createdAt,
      })
      .from(workflowRunHarnessEvents)
      .orderBy(asc(workflowRunHarnessEvents.createdAt), asc(workflowRunHarnessEvents.id))
      .all();
    const rows = [...transcriptRows, ...eventRows].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
    let remaining = rows.reduce((sum, row) => sum + row.totalBytes, 0);
    const evictedTranscripts: string[] = [];
    const evictedEvents: string[] = [];

    for (const row of rows) {
      if (remaining <= config.maxTotalBytes) {
        break;
      }

      if (row.kind === "transcript") {
        evictedTranscripts.push(row.id);
      } else {
        evictedEvents.push(row.id);
      }
      remaining -= row.totalBytes;
    }

    if (evictedTranscripts.length > 0) {
      db.delete(workflowRunTranscripts)
        .where(inArray(workflowRunTranscripts.id, evictedTranscripts))
        .run();
    }

    if (evictedEvents.length > 0) {
      db.delete(workflowRunHarnessEvents)
        .where(inArray(workflowRunHarnessEvents.id, evictedEvents))
        .run();
    }

    return {
      deletedByAge: expiredTranscripts.length + expiredEvents.length,
      deletedBySize: evictedTranscripts.length + evictedEvents.length,
    };
  }

  function purgeAll(): number {
    const transcriptCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(workflowRunTranscripts)
        .get()?.count ?? 0;
    const eventCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(workflowRunHarnessEvents)
        .get()?.count ?? 0;

    db.delete(workflowRunTranscripts).run();
    db.delete(workflowRunHarnessEvents).run();

    return transcriptCount + eventCount;
  }

  function currentTimestamp(): string {
    return options.clock?.() ?? nowTimestamp();
  }

  return {
    config,
    save,
    saveEvent,
    listByRun,
    listMetadataByRun,
    listEventsByRun,
    totalBytes,
    enforceRetention,
    purgeAll,
  };
}

function parseTranscript(row: WorkflowRunTranscriptRow): WorkflowRunTranscript {
  return workflowRunTranscriptSchema.parse(row);
}

function parseHarnessEvent(row: WorkflowRunHarnessEventRow): WorkflowRunHarnessEvent {
  return workflowRunHarnessEventSchema.parse(row);
}

function redactHarnessEvent(
  event: HarnessStreamEvent,
  redaction: RedactionOptions,
): HarnessStreamEvent {
  return harnessStreamEventSchema.parse({
    ...event,
    summary: redactString(event.summary, redaction),
    text: event.text === null ? null : redactString(event.text, redaction),
    name: event.name === null ? null : redactString(event.name, redaction),
    data: redactUnknown(event.data, redaction),
  });
}

function redactUnknown(value: unknown, redaction: RedactionOptions): unknown {
  if (typeof value === "string") {
    return redactString(value, redaction);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, redaction));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactUnknown(entry, redaction)]),
    );
  }

  return value;
}

interface TruncatedField {
  value: string;
  truncated: boolean;
}

function truncateHead(value: string): TruncatedField {
  if (value.length <= maxTranscriptFieldChars) {
    return { value, truncated: false };
  }

  return { value: value.slice(0, maxTranscriptFieldChars), truncated: true };
}

function truncateTail(value: string): TruncatedField {
  if (value.length <= maxTranscriptFieldChars) {
    return { value, truncated: false };
  }

  return { value: value.slice(value.length - maxTranscriptFieldChars), truncated: true };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
