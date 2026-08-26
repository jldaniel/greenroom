import { desc, eq } from "drizzle-orm";

import { createAgentEvent, type DomainFactoryOptions } from "@greenroom/core";
import {
  agentEventCreateInputSchema,
  agentEventSchema,
  type AgentEvent,
  type AgentEventCreateInput,
  type ReviewPrId,
} from "@greenroom/schemas";

import { agentEvents, reviewPrs } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type AgentEventRow = typeof agentEvents.$inferSelect;
type AgentEventInsert = typeof agentEvents.$inferInsert;

export interface AgentEventPersistenceService {
  create: (input: AgentEventCreateInput) => AgentEvent;
  listByReview: (reviewId: ReviewPrId) => AgentEvent[];
}

export function createAgentEventPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): AgentEventPersistenceService {
  return {
    create(input) {
      const parsed = agentEventCreateInputSchema.parse(input);
      const event = createAgentEvent(parsed, options);
      const reviewId =
        event.reviewDisplayId === null
          ? null
          : (db
              .select({ id: reviewPrs.id })
              .from(reviewPrs)
              .where(eq(reviewPrs.displayId, event.reviewDisplayId))
              .get()?.id ?? null);

      if (event.reviewDisplayId !== null && reviewId === null) {
        throw new Error(`Review ${event.reviewDisplayId} was not found`);
      }

      db.insert(agentEvents).values(agentEventToInsert(event, reviewId)).run();
      return event;
    },

    listByReview(reviewId) {
      return db
        .select({ event: agentEvents, reviewDisplayId: reviewPrs.displayId })
        .from(agentEvents)
        .leftJoin(reviewPrs, eq(agentEvents.reviewId, reviewPrs.id))
        .where(eq(agentEvents.reviewId, reviewId))
        .orderBy(desc(agentEvents.createdAt))
        .all()
        .map((row) => parseAgentEvent(row.event, row.reviewDisplayId));
    },
  };
}

export function parseAgentEvent(row: AgentEventRow, reviewDisplayId: string | null): AgentEvent {
  return agentEventSchema.parse({
    id: row.id,
    reviewDisplayId,
    eventType: row.eventType,
    source: row.source,
    threadRefs: row.threadRefs,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}

function agentEventToInsert(event: AgentEvent, reviewId: ReviewPrId | null): AgentEventInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = event;
  return { ...rest, reviewId };
}
