import { describe, expect, it } from "vitest";

import { readHarnessBridgeConfig } from "./config";

describe("harness bridge config", () => {
  it("parses workspace defaults and environment overrides", () => {
    expect(readHarnessBridgeConfig({})).toMatchObject({
      workspaceDir: null,
      workspaceStaleGraceMs: 86_400_000,
      workspaceMaxActive: 16,
      workspaceMaxBytes: 5 * 1024 * 1024 * 1024,
    });

    expect(
      readHarnessBridgeConfig({
        GREENROOM_HARNESS_WORKSPACE_DIR: "/tmp/greenroom-workspaces",
        GREENROOM_HARNESS_WORKSPACE_STALE_GRACE_MS: "60000",
        GREENROOM_HARNESS_WORKSPACE_MAX_ACTIVE: "4",
        GREENROOM_HARNESS_WORKSPACE_MAX_BYTES: "1048576",
      }),
    ).toMatchObject({
      workspaceDir: "/tmp/greenroom-workspaces",
      workspaceStaleGraceMs: 60_000,
      workspaceMaxActive: 4,
      workspaceMaxBytes: 1_048_576,
    });

    expect(
      readHarnessBridgeConfig({
        GREENROOM_HARNESS_SNAPSHOT_ENABLED: "false",
        GREENROOM_HARNESS_WORKSPACE_DIR: "/tmp/greenroom-workspaces",
      }),
    ).toMatchObject({
      workspaceDir: null,
    });

    expect(
      readHarnessBridgeConfig({
        GREENROOM_HARNESS_SNAPSHOT_ENABLED: "yes",
        GREENROOM_HARNESS_WORKSPACE_DIR: "/tmp/greenroom-workspaces",
      }),
    ).toMatchObject({
      workspaceDir: "/tmp/greenroom-workspaces",
    });
  });

  it("rejects invalid workspace limits", () => {
    expect(() =>
      readHarnessBridgeConfig({ GREENROOM_HARNESS_WORKSPACE_STALE_GRACE_MS: "-1" }),
    ).toThrow("Invalid integer environment value");
    expect(() => readHarnessBridgeConfig({ GREENROOM_HARNESS_WORKSPACE_MAX_ACTIVE: "0" })).toThrow(
      "Invalid integer environment value",
    );
    expect(() => readHarnessBridgeConfig({ GREENROOM_HARNESS_WORKSPACE_MAX_BYTES: "0" })).toThrow(
      "Invalid integer environment value",
    );
    expect(() => readHarnessBridgeConfig({ GREENROOM_HARNESS_SNAPSHOT_ENABLED: "maybe" })).toThrow(
      "Invalid boolean environment value",
    );
  });
});
