import type { WorkflowRunEvent } from "@greenroom/schemas";

/**
 * Follow-up conversation derivation for the Teach surface.
 *
 * Persistence: teaching runs are durable `workflow_runs` records, and every
 * answered follow-up records a `persistence` event on the ORIGINAL teaching
 * run with `{ followUpWorkflowRunId, question, answer }` metadata (see
 * `apps/server/src/workflows/teaching.ts`). The conversation therefore
 * survives restarts: it is rebuilt from the run's event log and merged with
 * the in-flight client entries (pending or failed questions that have no
 * persisted event yet).
 */

export type FollowUpEntryStatus = "answered" | "failed" | "pending";

export interface FollowUpEntry {
  key: string;
  question: string;
  answer: string | null;
  status: FollowUpEntryStatus;
  errorMessage: string | null;
  createdAt: string | null;
}

/** Rebuilds the persisted follow-up exchanges from the original run's events. */
export function followUpEntriesFromWorkflowEvents(
  events: readonly WorkflowRunEvent[],
): FollowUpEntry[] {
  const entries: FollowUpEntry[] = [];

  for (const event of events) {
    if (event.eventType !== "persistence") {
      continue;
    }

    const answer = stringValue(event.metadata.answer);
    const question = stringValue(event.metadata.question);

    if (answer === null || question === null) {
      continue;
    }

    entries.push({
      key: stringValue(event.metadata.followUpWorkflowRunId) ?? event.id,
      question,
      answer,
      status: "answered",
      errorMessage: null,
      createdAt: event.timestamp,
    });
  }

  return entries;
}

/**
 * Merges the persisted conversation with client-session entries. Session
 * entries that already landed as persisted events (same question and answer)
 * are dropped so the exchange does not render twice after the event query
 * refreshes; each persisted entry consumes at most one session duplicate so
 * repeated identical exchanges still render once each.
 */
export function mergeFollowUpConversation(
  persisted: readonly FollowUpEntry[],
  session: readonly FollowUpEntry[],
): FollowUpEntry[] {
  const remaining = new Map<string, number>();

  for (const entry of persisted) {
    const key = duplicateKey(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const merged = [...persisted];
  const persistedKeys = new Set(persisted.map((entry) => entry.key));

  for (const entry of session) {
    if (persistedKeys.has(entry.key)) {
      continue;
    }

    if (entry.status === "answered") {
      const key = duplicateKey(entry);
      const count = remaining.get(key) ?? 0;

      if (count > 0) {
        remaining.set(key, count - 1);
        continue;
      }
    }

    merged.push(entry);
  }

  return merged;
}

function duplicateKey(entry: FollowUpEntry): string {
  return `${entry.question}\u0000${entry.answer ?? ""}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
