import { describe, expect, it } from "vitest";

import { bridgeLivenessFromRun, repositoryWorkspaceFromRun } from "./RunStatus";

describe("bridgeLivenessFromRun", () => {
  it("returns null for runs without bridge metadata", () => {
    expect(bridgeLivenessFromRun({ metadata: {} }, Date.parse("2026-07-03T12:00:00.000Z"))).toBe(
      null,
    );
  });

  it("derives bridge heartbeat and process ages from workflow metadata", () => {
    expect(
      bridgeLivenessFromRun(
        {
          metadata: {
            bridgeJobId: "harness_job_123456789abcdef",
            bridgeJobStatus: "running",
            bridgeHeartbeatAt: "2026-07-03T11:59:30.000Z",
            harnessProcessLastSeenAt: "2026-07-03T11:58:00.000Z",
            bridgeCancelRequestedAt: "2026-07-03T11:59:45.000Z",
          },
        },
        Date.parse("2026-07-03T12:00:00.000Z"),
      ),
    ).toEqual({
      jobId: "harness_job_123456789abcdef",
      status: "running",
      heartbeatAgeLabel: "30s",
      processAgeLabel: "2m",
      cancelRequested: true,
    });
  });
});

describe("repositoryWorkspaceFromRun", () => {
  it("returns null for old runs without repository access metadata", () => {
    expect(repositoryWorkspaceFromRun({ metadata: {} })).toBe(null);
  });

  it("derives repository snapshot and cleanup status from workflow metadata", () => {
    expect(
      repositoryWorkspaceFromRun({
        metadata: {
          repositoryAccessMode: "snapshot_readonly",
          repositoryAccessReadScopeLabel:
            "Tracked repository files at the approved commit may be read.",
          repositoryAccessRevisionId: "revision_1",
          repositoryAccessBaseSha: "a".repeat(40),
          repositoryAccessHeadSha: "b".repeat(40),
          repositoryAccessWorkspaceStrategy: "git_archive",
          workspaceSetupStatus: "succeeded",
          workspaceCleanupStatus: "failed",
          workspaceErrorMessage: "Workspace cleanup failed",
        },
      }),
    ).toEqual({
      accessMode: "snapshot_readonly",
      readScopeLabel: "Tracked repository files at the approved commit may be read.",
      revisionId: "revision_1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      workspaceStrategy: "git_archive",
      workspaceSetupStatus: "succeeded",
      workspaceCleanupStatus: "failed",
      workspaceErrorMessage: "Workspace cleanup failed",
    });
  });

  it("derives MCP-only access without requiring workspace metadata", () => {
    expect(
      repositoryWorkspaceFromRun({
        metadata: {
          repositoryAccessMode: "mcp_only",
          repositoryAccessReadScopeLabel: "Greenroom MCP context only",
        },
      }),
    ).toMatchObject({
      accessMode: "mcp_only",
      readScopeLabel: "Greenroom MCP context only",
      workspaceStrategy: null,
      workspaceSetupStatus: null,
      workspaceCleanupStatus: null,
      workspaceErrorMessage: null,
    });
  });
});
