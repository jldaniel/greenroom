import { describe, expect, it } from "vitest";

import { parseReviewWorkspaceSearch } from "./reviewWorkspaceSearchUtils";

describe("review workspace deep-link search params", () => {
  it("accepts well-formed GT and SV refs", () => {
    expect(parseReviewWorkspaceSearch({ thread: "GT-5", view: "SV-3" })).toEqual({
      thread: "GT-5",
      view: "SV-3",
    });
    expect(parseReviewWorkspaceSearch({ thread: " GT-12 " })).toEqual({ thread: "GT-12" });
  });

  it("drops malformed or foreign refs", () => {
    expect(parseReviewWorkspaceSearch({ thread: "GR-5" })).toEqual({});
    expect(parseReviewWorkspaceSearch({ view: "GT-5" })).toEqual({});
    expect(parseReviewWorkspaceSearch({ thread: "GT-0" })).toEqual({});
    expect(parseReviewWorkspaceSearch({ thread: "gt-5" })).toEqual({});
    expect(parseReviewWorkspaceSearch({ thread: 5, view: null })).toEqual({});
    expect(parseReviewWorkspaceSearch({})).toEqual({});
  });
});
