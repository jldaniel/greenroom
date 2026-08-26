import type { SpotlightViewRef } from "@greenroom/schemas";

/**
 * The dedicated Teach page accepts a Spotlight View preselection
 * through the `?view=` search param, so links like
 * links to the Teach route can open View-scoped teaching. Any
 * non-empty string is accepted here; the teaching panel only applies the
 * preselection once the ref matches a loaded Spotlight View, so stale or
 * foreign refs degrade to a View picker without a matching entry.
 */
export function parseTeachViewSearch(value: unknown): SpotlightViewRef | undefined {
  return typeof value === "string" && value.length > 0 ? (value as SpotlightViewRef) : undefined;
}
