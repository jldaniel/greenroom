import { describe, expect, it } from "vitest";

import { promotionTitle } from "./teachingSessionUtils";

describe("promotionTitle", () => {
  it("passes titles at or below the 240-character API cap through unchanged", () => {
    expect(promotionTitle("Review the exported value")).toBe("Review the exported value");
    expect(promotionTitle("x".repeat(240))).toBe("x".repeat(240));
  });

  it("clamps longer titles (quiz missedConcept allows 400 characters) to the cap", () => {
    const clamped = promotionTitle("y".repeat(400));

    expect(clamped).toHaveLength(240);
    expect(clamped.endsWith("…")).toBe(true);
    expect(clamped.startsWith("y".repeat(239))).toBe(true);
  });

  it("does not leave trailing whitespace before the ellipsis", () => {
    const title = `${"z".repeat(238)} ${"tail".repeat(20)}`;
    const clamped = promotionTitle(title);

    expect(clamped).toBe(`${"z".repeat(238)}…`);
    expect(clamped.length).toBeLessThanOrEqual(240);
  });
});
