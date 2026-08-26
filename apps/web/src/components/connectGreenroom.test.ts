import { describe, expect, it } from "vitest";

import { deriveApiAuthPrompt } from "./connectGreenroomUtils";

describe("deriveApiAuthPrompt", () => {
  it("offers connect for a 401 with no token anywhere", () => {
    expect(deriveApiAuthPrompt({ status: 401, tokenSource: "missing" })).toBe("connect");
  });

  it("offers reconnect for a 401 with a rejected browser-stored token", () => {
    expect(deriveApiAuthPrompt({ status: 401, tokenSource: "browser" })).toBe("reconnect");
  });

  it("keeps the plain error for tokens the browser does not manage", () => {
    expect(deriveApiAuthPrompt({ status: 401, tokenSource: "environment" })).toBeNull();
  });

  it("never prompts for non-401 failures", () => {
    expect(deriveApiAuthPrompt({ status: 403, tokenSource: "missing" })).toBeNull();
    expect(deriveApiAuthPrompt({ status: 500, tokenSource: "browser" })).toBeNull();
    expect(deriveApiAuthPrompt({ status: 0, tokenSource: "missing" })).toBeNull();
    expect(deriveApiAuthPrompt({ status: null, tokenSource: "missing" })).toBeNull();
  });
});
