import type { SpotlightViewRef, ThreadRef } from "@greenroom/schemas";

/**
 * The review workspace accepts pasted global refs as deep links:
 * A thread query parameter opens and scrolls to that thread, and a view query
 * parameter activates the Spotlight section with that view
 * selected. Refs that don't match the expected shape are dropped from the
 * search; refs that parse but don't resolve to loaded data degrade to a
 * no-op so stale links still land on the review.
 */
export interface ReviewWorkspaceSearch {
  thread?: ThreadRef;
  view?: SpotlightViewRef;
}

export function parseWorkspaceThreadSearch(value: unknown): ThreadRef | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return /^GT-[1-9]\d*$/u.test(trimmed) ? trimmed : undefined;
}

export function parseWorkspaceViewSearch(value: unknown): SpotlightViewRef | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return /^SV-[1-9]\d*$/u.test(trimmed) ? trimmed : undefined;
}

export function parseReviewWorkspaceSearch(search: Record<string, unknown>): ReviewWorkspaceSearch {
  const thread = parseWorkspaceThreadSearch(search.thread);
  const view = parseWorkspaceViewSearch(search.view);

  return {
    ...(thread === undefined ? {} : { thread }),
    ...(view === undefined ? {} : { view }),
  };
}
