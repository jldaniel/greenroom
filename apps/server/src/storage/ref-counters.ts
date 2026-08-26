import { sql } from "drizzle-orm";

import { refCounters } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

export type RefCounterScope = "review" | "thread" | "spotlight_view";

// Monotonic per-scope sequence for human-facing display refs.
// Unlike a max-scan over existing rows, numbers are never reused after
// deletes, so a stale ref fails to resolve instead of pointing at unrelated
// content (spotlight regenerate replaces every view for a review).
export function allocateDisplayNumber(
  db: GreenroomDrizzleDatabase,
  scope: RefCounterScope,
): number {
  const row = db
    .insert(refCounters)
    .values({ scope, nextValue: 2 })
    .onConflictDoUpdate({
      target: refCounters.scope,
      set: { nextValue: sql`${refCounters.nextValue} + 1` },
    })
    .returning({ nextValue: refCounters.nextValue })
    .get();

  return row.nextValue - 1;
}
