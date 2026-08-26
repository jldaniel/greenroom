import { describe, expect, it } from "vitest";

import { clampFileTreeWidth, FILE_TREE_MAX_WIDTH, FILE_TREE_MIN_WIDTH } from "./fileTreeSizing";

describe("file tree sizing", () => {
  it("rounds widths and clamps them to the supported range", () => {
    expect(clampFileTreeWidth(320.6)).toBe(321);
    expect(clampFileTreeWidth(FILE_TREE_MIN_WIDTH - 100)).toBe(FILE_TREE_MIN_WIDTH);
    expect(clampFileTreeWidth(FILE_TREE_MAX_WIDTH + 100)).toBe(FILE_TREE_MAX_WIDTH);
  });
});
