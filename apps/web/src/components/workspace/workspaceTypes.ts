import type { SpotlightViewRef } from "@greenroom/schemas";

export type DiffMode = "unified" | "split";

/**
 * Sections hosted by the workspace right drawer. Teach is not a drawer
 * section: it lives on its own full-page route at `/reviews/:reviewId/teach`
 * and the workspace links to it instead.
 */
export type WorkspaceDrawerSection = "threads" | "ai_review" | "spotlight";

export type SpotlightSelection = { kind: "coverage" } | { kind: "view"; viewRef: SpotlightViewRef };

export type SpotlightRunKind = "generate" | "update" | "regenerate" | "refine_view";

export type PendingRunConfirmation =
  | { kind: "ai_review" }
  | { kind: "spotlight"; type: SpotlightRunKind }
  | { kind: "fingerprint_recovery" };

export const worktreeDirtyWarning =
  "Worktree has changed since this review's last revision — refresh first or the run may fail.";
