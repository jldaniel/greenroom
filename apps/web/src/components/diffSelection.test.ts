import { describe, expect, it } from "vitest";

import { subtractSelectionInterval } from "./DiffViewer";

describe("diff drag selection intervals", () => {
  it("adds only the newly entered tail when a drag range expands", () => {
    expect(subtractSelectionInterval({ low: 2, high: 8 }, { low: 2, high: 5 })).toEqual([
      { low: 6, high: 8 },
    ]);
  });

  it("removes only the abandoned edges when a drag reverses and shrinks", () => {
    expect(subtractSelectionInterval({ low: 2, high: 8 }, { low: 4, high: 6 })).toEqual([
      { low: 2, high: 3 },
      { low: 7, high: 8 },
    ]);
  });

  it("returns the full source for disjoint or cleared selections", () => {
    expect(subtractSelectionInterval({ low: 2, high: 4 }, { low: 8, high: 10 })).toEqual([
      { low: 2, high: 4 },
    ]);
    expect(subtractSelectionInterval({ low: 2, high: 4 }, null)).toEqual([{ low: 2, high: 4 }]);
    expect(subtractSelectionInterval(null, { low: 2, high: 4 })).toEqual([]);
  });
});
