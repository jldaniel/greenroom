import { describe, expect, it } from "vitest";

import { parseTeachViewSearch } from "./teachPageUtils";

describe("parseTeachViewSearch", () => {
  it("accepts a non-empty view ref string", () => {
    expect(parseTeachViewSearch("SV-1")).toBe("SV-1");
  });

  it("rejects missing, empty, and non-string values", () => {
    expect(parseTeachViewSearch(undefined)).toBeUndefined();
    expect(parseTeachViewSearch(null)).toBeUndefined();
    expect(parseTeachViewSearch("")).toBeUndefined();
    expect(parseTeachViewSearch(42)).toBeUndefined();
    expect(parseTeachViewSearch(["SV-1"])).toBeUndefined();
  });
});
