import { describe, expect, it } from "vitest";

import type { HarnessStatusResponse } from "@greenroom/schemas";

import { deriveAiRunReadiness } from "./aiReadinessUtils";

function status(overrides: Partial<HarnessStatusResponse>): HarnessStatusResponse {
  return {
    configured: true,
    baseUrl: "http://127.0.0.1:8790",
    healthy: true,
    runtimeMode: "http",
    availableKinds: [],
    harnesses: [],
    detectedHarnesses: [],
    errorMessage: null,
    ...overrides,
  } as HarnessStatusResponse;
}

function detected(overrides: Record<string, unknown>) {
  return {
    kind: "claude-code",
    label: "Claude Code",
    command: "claude",
    found: true,
    path: "/usr/local/bin/claude",
    version: "2.1.0",
    lastVerifiedVersion: null,
    recommendSmoke: false,
    probedAt: "2026-06-28T12:00:00.000Z",
    message: null,
    ...overrides,
  };
}

describe("deriveAiRunReadiness", () => {
  it("never blocks mock profiles and explains why", () => {
    const readiness = deriveAiRunReadiness({
      provider: "mock",
      status: status({ configured: false, healthy: false }),
    });

    expect(readiness.blocked).toBe(false);
    expect(readiness.detail).toContain("Mock profile");
  });

  it("fails open while the status is unknown", () => {
    expect(deriveAiRunReadiness({ provider: "harness", status: undefined }).blocked).toBe(false);
    expect(deriveAiRunReadiness({ provider: "harness", status: null }).blocked).toBe(false);
    expect(deriveAiRunReadiness({ provider: null, status: undefined }).blocked).toBe(false);
  });

  it("blocks harness profiles when the bridge is not configured", () => {
    const readiness = deriveAiRunReadiness({
      provider: "harness",
      status: status({ configured: false, healthy: false }),
    });

    expect(readiness).toMatchObject({ blocked: true, showConnectionsLink: true });
    expect(readiness.reason).toContain("not configured");
  });

  it("blocks harness profiles when the bridge is unreachable", () => {
    const readiness = deriveAiRunReadiness({
      provider: "harness",
      status: status({ healthy: false }),
    });

    expect(readiness).toMatchObject({ blocked: true, showConnectionsLink: true });
    expect(readiness.reason).toContain("unreachable");
  });

  it("blocks harness profiles when detection found no coding agent CLI", () => {
    const readiness = deriveAiRunReadiness({
      provider: "harness",
      status: status({
        detectedHarnesses: [detected({ found: false, path: null, version: null })],
      } as Partial<HarnessStatusResponse>),
    });

    expect(readiness).toMatchObject({ blocked: true, showConnectionsLink: true });
    expect(readiness.reason).toContain("No coding agent CLI");
  });

  it("reports the detected harnesses when ready", () => {
    const readiness = deriveAiRunReadiness({
      provider: "harness",
      status: status({
        detectedHarnesses: [detected({})],
      } as Partial<HarnessStatusResponse>),
    });

    expect(readiness.blocked).toBe(false);
    expect(readiness.detail).toBe("Bridge connected — Claude Code 2.1.0");
  });
});
