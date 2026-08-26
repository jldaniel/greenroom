import { describe, expect, it } from "vitest";

import {
  clampWorkspaceDrawerWidth,
  WORKSPACE_DRAWER_MAX_WIDTH,
  WORKSPACE_DRAWER_MIN_WIDTH,
} from "./workspaceDrawerSizing";

describe("workspace drawer sizing", () => {
  it("rounds widths and clamps them to the supported range", () => {
    expect(clampWorkspaceDrawerWidth(400.6)).toBe(401);
    expect(clampWorkspaceDrawerWidth(WORKSPACE_DRAWER_MIN_WIDTH - 100)).toBe(
      WORKSPACE_DRAWER_MIN_WIDTH,
    );
    expect(clampWorkspaceDrawerWidth(WORKSPACE_DRAWER_MAX_WIDTH + 100)).toBe(
      WORKSPACE_DRAWER_MAX_WIDTH,
    );
  });
});
