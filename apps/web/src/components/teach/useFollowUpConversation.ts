import { useMemo, useRef, useState } from "react";

import type { TeachingRunId, WorkflowRunEvent } from "@greenroom/schemas";

import { useTeachingFollowUp } from "../../api/hooks";
import {
  followUpEntriesFromWorkflowEvents,
  mergeFollowUpConversation,
  type FollowUpEntry,
} from "./followUpConversation";

/**
 * Owns the follow-up conversation state for a teaching session:
 * persisted exchanges rebuilt from the original run's workflow events merged
 * with in-flight client entries (pending question, inline failure). Asking
 * appends a pending bubble immediately and settles it from the mutation
 * result; `useTeachingFollowUp` invalidates the run's event query on success
 * so persisted history catches up on its own.
 */
export function useFollowUpConversation({
  events,
  runId,
}: {
  events: readonly WorkflowRunEvent[] | undefined;
  runId: TeachingRunId | null;
}): {
  ask: (question: string) => Promise<void>;
  conversation: FollowUpEntry[];
  isAsking: boolean;
  reset: () => void;
} {
  const followUp = useTeachingFollowUp();
  const [sessionEntries, setSessionEntries] = useState<FollowUpEntry[]>([]);
  const entryCounter = useRef(0);
  const persistedEntries = useMemo(() => followUpEntriesFromWorkflowEvents(events ?? []), [events]);
  const conversation = useMemo(
    () => mergeFollowUpConversation(persistedEntries, sessionEntries),
    [persistedEntries, sessionEntries],
  );

  async function ask(question: string): Promise<void> {
    if (runId === null) {
      return;
    }

    entryCounter.current += 1;
    const key = `session-follow-up-${entryCounter.current}`;
    setSessionEntries((current) => [
      ...current,
      { key, question, answer: null, status: "pending", errorMessage: null, createdAt: null },
    ]);

    try {
      const response = await followUp.mutateAsync({ runId, input: { question } });
      setSessionEntries((current) =>
        current.map((entry) =>
          entry.key === key
            ? {
                ...entry,
                key: response.followUpRunId ?? entry.key,
                answer: response.answer,
                status: response.answer === null ? "pending" : "answered",
                createdAt: response.createdAt,
              }
            : entry,
        ),
      );
    } catch (error) {
      setSessionEntries((current) =>
        current.map((entry) =>
          entry.key === key
            ? {
                ...entry,
                status: "failed",
                errorMessage: error instanceof Error ? error.message : "Unknown error",
              }
            : entry,
        ),
      );
    }
  }

  return {
    ask,
    conversation,
    isAsking: followUp.isPending,
    reset: () => setSessionEntries([]),
  };
}
