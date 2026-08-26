import type { RevisionSnapshot } from "@greenroom/schemas";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const weekMs = 7 * dayMs;
const monthMs = 30 * dayMs;
const yearMs = 365 * dayMs;

/**
 * Compact relative age ("just now", "2h ago") for revision labels. Pure so
 * the revision selector labels are unit-testable; clamps future timestamps
 * (clock skew) to "just now".
 */
export function formatRelativeAge(createdAt: string, nowMs: number): string {
  const createdMs = new Date(createdAt).valueOf();

  if (Number.isNaN(createdMs)) {
    return createdAt;
  }

  const elapsed = nowMs - createdMs;

  if (elapsed < minuteMs) {
    return "just now";
  }

  if (elapsed < hourMs) {
    return `${Math.floor(elapsed / minuteMs)}m ago`;
  }

  if (elapsed < dayMs) {
    return `${Math.floor(elapsed / hourMs)}h ago`;
  }

  if (elapsed < 2 * weekMs) {
    return `${Math.floor(elapsed / dayMs)}d ago`;
  }

  if (elapsed < 2 * monthMs) {
    return `${Math.floor(elapsed / weekMs)}w ago`;
  }

  if (elapsed < yearMs) {
    return `${Math.floor(elapsed / monthMs)}mo ago`;
  }

  return `${Math.floor(elapsed / yearMs)}y ago`;
}

/**
 * Human origin of a revision snapshot derived from what the record stores:
 * the refresh reason plus whether the snapshot fingerprinted the worktree
 * (worktree reviews) or captured committed refs only.
 */
export function revisionOriginLabel(
  revision: Pick<RevisionSnapshot, "refreshReason" | "worktreeFingerprint">,
): string {
  if (revision.refreshReason === "initial") {
    return "initial snapshot";
  }

  // Both manual refreshes and detected changes only store a new revision when
  // the snapshot actually changed, so for worktree reviews the change is a
  // worktree change; committed-range reviews changed because a ref moved.
  return revision.worktreeFingerprint !== null ? "worktree change" : "ref change";
}

/**
 * The revision selector's option label, e.g.
 * "Rev 3 · 2h ago · worktree change · current". Revision numbers count from
 * the review's first snapshot; current/latest markers keep the previous
 * selector semantics visible.
 */
export function revisionOptionLabel({
  isCurrent,
  isLatest,
  nowMs,
  revision,
  revisionNumber,
}: {
  isCurrent: boolean;
  isLatest: boolean;
  nowMs: number;
  revision: RevisionSnapshot;
  revisionNumber: number;
}): string {
  const parts = [
    `Rev ${revisionNumber}`,
    formatRelativeAge(revision.createdAt, nowMs),
    revisionOriginLabel(revision),
  ];

  if (isCurrent) {
    parts.push("current");
  } else if (isLatest) {
    parts.push("latest");
  }

  return parts.join(" · ");
}
