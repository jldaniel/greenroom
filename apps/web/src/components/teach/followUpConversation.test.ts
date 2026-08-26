import { describe, expect, it } from "vitest";

import type { WorkflowRunEvent } from "@greenroom/schemas";

import {
  followUpEntriesFromWorkflowEvents,
  mergeFollowUpConversation,
  type FollowUpEntry,
} from "./followUpConversation";

function event(overrides: Partial<WorkflowRunEvent>): WorkflowRunEvent {
  return {
    id: "workflow_event_1",
    runId: "workflow_run_1",
    reviewDisplayId: "GR-1",
    sequenceNumber: 1,
    eventType: "persistence",
    summary: "Teaching follow-up answered.",
    severity: "info",
    timestamp: "2026-07-02T10:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

function entry(overrides: Partial<FollowUpEntry>): FollowUpEntry {
  return {
    key: "session-1",
    question: "Why?",
    answer: "Because.",
    status: "answered",
    errorMessage: null,
    createdAt: "2026-07-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("followUpEntriesFromWorkflowEvents", () => {
  it("rebuilds answered exchanges from persistence events on the original run", () => {
    const events = [
      event({
        id: "workflow_event_1",
        metadata: {
          followUpWorkflowRunId: "workflow_run_9",
          question: "Why start there?",
          answer: "Because the diff is scoped.",
        },
      }),
      event({
        id: "workflow_event_2",
        eventType: "lifecycle",
        summary: "Teaching generation started.",
        metadata: { question: "not-a-follow-up", answer: "still not" },
      }),
      event({
        id: "workflow_event_3",
        metadata: { answerLength: 12 },
      }),
    ];

    expect(followUpEntriesFromWorkflowEvents(events)).toEqual([
      {
        key: "workflow_run_9",
        question: "Why start there?",
        answer: "Because the diff is scoped.",
        status: "answered",
        errorMessage: null,
        createdAt: "2026-07-02T10:00:00.000Z",
      },
    ]);
  });

  it("falls back to the event id when the follow-up run id is missing", () => {
    const entries = followUpEntriesFromWorkflowEvents([
      event({ id: "workflow_event_7", metadata: { question: "Q", answer: "A" } }),
    ]);

    expect(entries[0]?.key).toBe("workflow_event_7");
  });
});

describe("mergeFollowUpConversation", () => {
  it("keeps persisted entries first and appends pending or failed session entries", () => {
    const persisted = [entry({ key: "p1", question: "Q1", answer: "A1" })];
    const session = [
      entry({ key: "s1", question: "Q2", answer: null, status: "pending" }),
      entry({
        key: "s2",
        question: "Q3",
        answer: null,
        status: "failed",
        errorMessage: "bridge down",
      }),
    ];

    expect(mergeFollowUpConversation(persisted, session).map((item) => item.key)).toEqual([
      "p1",
      "s1",
      "s2",
    ]);
  });

  it("drops session entries that already landed as persisted events", () => {
    const persisted = [entry({ key: "p1", question: "Q1", answer: "A1" })];
    const session = [entry({ key: "s1", question: "Q1", answer: "A1" })];

    expect(mergeFollowUpConversation(persisted, session)).toEqual(persisted);
  });

  it("drops pending session entries when the same follow-up workflow persists an answer", () => {
    const persisted = [entry({ key: "workflow_run_9", question: "Q1", answer: "A1" })];
    const session = [
      entry({ key: "workflow_run_9", question: "Q1", answer: null, status: "pending" }),
    ];

    expect(mergeFollowUpConversation(persisted, session)).toEqual(persisted);
  });

  it("consumes one persisted duplicate per session entry so repeats still render", () => {
    const persisted = [
      entry({ key: "p1", question: "Q1", answer: "A1" }),
      entry({ key: "p2", question: "Q1", answer: "A1" }),
    ];
    const session = [
      entry({ key: "s1", question: "Q1", answer: "A1" }),
      entry({ key: "s2", question: "Q1", answer: "A1" }),
      entry({ key: "s3", question: "Q1", answer: "A1" }),
    ];

    expect(mergeFollowUpConversation(persisted, session).map((item) => item.key)).toEqual([
      "p1",
      "p2",
      "s3",
    ]);
  });
});
