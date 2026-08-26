import type { Repository, ReviewPr, RevisionSnapshot, TokenId } from "@greenroom/schemas";

/**
 * Internal API event bus.
 *
 * This is an in-process extension point, not a public API: nothing in
 * Greenroom subscribes by default, so emitting is a no-op until a follow-up
 * feature such as auto-run-on-review-creation registers a listener. Listeners run
 * synchronously and their errors are isolated so a failing subscriber can
 * never break the emitting request.
 *
 * Consent semantics for subscribers that enqueue workflow runs: enqueue
 * through the normal run-creation path (`createWorkflowRunForReview`), which
 * creates the run in `pending_consent`. The run stays inert until the user
 * approves it, so an auto-enqueued run never bypasses consent.
 */

/** Who triggered the review creation. */
export interface ReviewCreatedActor {
  /** `api_token` for authenticated API requests, `internal` for direct service calls. */
  kind: "api_token" | "internal";
  tokenId: TokenId | null;
  tokenName: string | null;
}

export interface ReviewCreatedEvent {
  review: ReviewPr;
  repository: Repository;
  revision: RevisionSnapshot;
  createdBy: ReviewCreatedActor;
  createdAt: string;
}

export interface GreenroomApiEventMap {
  "review.created": ReviewCreatedEvent;
}

export type GreenroomApiEventName = keyof GreenroomApiEventMap;

export type GreenroomApiEventListener<Name extends GreenroomApiEventName> = (
  event: GreenroomApiEventMap[Name],
) => void;

export interface GreenroomApiEvents {
  /** Registers a listener and returns an unsubscribe function. */
  on: <Name extends GreenroomApiEventName>(
    name: Name,
    listener: GreenroomApiEventListener<Name>,
  ) => () => void;
  emit: <Name extends GreenroomApiEventName>(name: Name, event: GreenroomApiEventMap[Name]) => void;
  listenerCount: (name: GreenroomApiEventName) => number;
}

export const INTERNAL_REVIEW_CREATED_ACTOR: ReviewCreatedActor = {
  kind: "internal",
  tokenId: null,
  tokenName: null,
};

export function createGreenroomApiEvents(): GreenroomApiEvents {
  const listeners = new Map<GreenroomApiEventName, Set<(event: never) => void>>();

  return {
    on(name, listener) {
      const existing = listeners.get(name) ?? new Set();
      existing.add(listener);
      listeners.set(name, existing);

      return () => {
        existing.delete(listener);
      };
    },
    emit(name, event) {
      for (const listener of listeners.get(name) ?? []) {
        try {
          (listener as GreenroomApiEventListener<typeof name>)(event);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          console.warn(`Greenroom ${name} listener failed: ${message}`);
        }
      }
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}
