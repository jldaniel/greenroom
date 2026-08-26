import { describe, expect, it } from "vitest";

import type { RevisionSnapshot } from "@greenroom/schemas";

import { formatRelativeAge, revisionOptionLabel, revisionOriginLabel } from "./revisionLabels";

const nowMs = Date.parse("2026-06-27T12:00:00.000Z");

function isoBefore(deltaMs: number): string {
  return new Date(nowMs - deltaMs).toISOString();
}

const worktreeFingerprint = {
  headSha: "b".repeat(40),
  stagedDiffHash: "staged-hash",
  unstagedDiffHash: "unstaged-hash",
};

function revision(overrides: Partial<RevisionSnapshot>): RevisionSnapshot {
  return {
    id: "revision_1",
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    diffSummary: { fileCount: 1, additions: 1, deletions: 0, binaryFileCount: 0, renameCount: 0 },
    refreshReason: "initial",
    createdAt: isoBefore(0),
    ...overrides,
  };
}

describe("formatRelativeAge", () => {
  it("scales units from minutes to years", () => {
    expect(formatRelativeAge(isoBefore(10_000), nowMs)).toBe("just now");
    expect(formatRelativeAge(isoBefore(5 * 60_000), nowMs)).toBe("5m ago");
    expect(formatRelativeAge(isoBefore(2 * 3_600_000), nowMs)).toBe("2h ago");
    expect(formatRelativeAge(isoBefore(3 * 86_400_000), nowMs)).toBe("3d ago");
    expect(formatRelativeAge(isoBefore(20 * 86_400_000), nowMs)).toBe("2w ago");
    expect(formatRelativeAge(isoBefore(90 * 86_400_000), nowMs)).toBe("3mo ago");
    expect(formatRelativeAge(isoBefore(800 * 86_400_000), nowMs)).toBe("2y ago");
  });

  it("clamps future timestamps to just now", () => {
    expect(formatRelativeAge(isoBefore(-5_000), nowMs)).toBe("just now");
  });

  it("passes through unparseable timestamps", () => {
    expect(formatRelativeAge("not-a-date", nowMs)).toBe("not-a-date");
  });
});

describe("revisionOriginLabel", () => {
  it("labels the first snapshot", () => {
    expect(revisionOriginLabel(revision({ refreshReason: "initial" }))).toBe("initial snapshot");
    expect(revisionOriginLabel(revision({ refreshReason: "initial", worktreeFingerprint }))).toBe(
      "initial snapshot",
    );
  });

  it("labels refreshed worktree snapshots as worktree changes", () => {
    expect(
      revisionOriginLabel(revision({ refreshReason: "manual_refresh", worktreeFingerprint })),
    ).toBe("worktree change");
    expect(
      revisionOriginLabel(revision({ refreshReason: "detected_change", worktreeFingerprint })),
    ).toBe("worktree change");
  });

  it("labels refreshed committed-range snapshots as ref changes", () => {
    expect(revisionOriginLabel(revision({ refreshReason: "manual_refresh" }))).toBe("ref change");
    expect(revisionOriginLabel(revision({ refreshReason: "detected_change" }))).toBe("ref change");
  });
});

describe("revisionOptionLabel", () => {
  it("combines revision number, age, and origin", () => {
    expect(
      revisionOptionLabel({
        isCurrent: true,
        isLatest: true,
        nowMs,
        revision: revision({
          createdAt: isoBefore(2 * 3_600_000),
          refreshReason: "manual_refresh",
          worktreeFingerprint,
        }),
        revisionNumber: 3,
      }),
    ).toBe("Rev 3 · 2h ago · worktree change · current");
  });

  it("marks the latest non-current revision", () => {
    expect(
      revisionOptionLabel({
        isCurrent: false,
        isLatest: true,
        nowMs,
        revision: revision({ createdAt: isoBefore(60_000) }),
        revisionNumber: 2,
      }),
    ).toBe("Rev 2 · 1m ago · initial snapshot · latest");
  });

  it("leaves historical revisions unmarked", () => {
    expect(
      revisionOptionLabel({
        isCurrent: false,
        isLatest: false,
        nowMs,
        revision: revision({ createdAt: isoBefore(3 * 86_400_000) }),
        revisionNumber: 1,
      }),
    ).toBe("Rev 1 · 3d ago · initial snapshot");
  });
});
