import { describe, expect, it } from "vitest";

import { dedupeErrorsForDisplay, errorDisplayKey } from "./feedbackUtils";

class FakeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GreenroomApiError";
    this.status = status;
  }
}

describe("dedupeErrorsForDisplay", () => {
  it("drops null and undefined entries", () => {
    expect(dedupeErrorsForDisplay([null, undefined, null])).toEqual([]);
  });

  it("collapses errors with the same name, status, and message", () => {
    const first = new FakeApiError(401, "Unauthorized");
    const second = new FakeApiError(401, "Unauthorized");

    expect(dedupeErrorsForDisplay([first, null, second])).toEqual([first]);
  });

  it("keeps errors that differ by status or message", () => {
    const unauthorized = new FakeApiError(401, "Unauthorized");
    const missing = new FakeApiError(404, "Missing review");
    const plain = new Error("Missing review");

    expect(dedupeErrorsForDisplay([unauthorized, missing, plain])).toEqual([
      unauthorized,
      missing,
      plain,
    ]);
  });

  it("preserves first-seen order", () => {
    const first = new Error("first");
    const second = new Error("second");

    expect(dedupeErrorsForDisplay([first, second, first])).toEqual([first, second]);
  });

  it("keys non-error values by their string form", () => {
    expect(errorDisplayKey("boom")).toBe(errorDisplayKey("boom"));
    expect(errorDisplayKey("boom")).not.toBe(errorDisplayKey(new Error("boom")));
  });
});
