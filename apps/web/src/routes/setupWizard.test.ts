import { describe, expect, it } from "vitest";

import type { HarnessDetectedCli } from "@greenroom/schemas";

import {
  classifySetupTokenFailure,
  deriveSetupWizardStepStatuses,
  nextSetupWizardStep,
  parseSetupWizardCompletionState,
  previousSetupWizardStep,
  setupWizardStepOrder,
  shouldAutoLaunchSetupWizard,
  summarizeDetectedHarnesses,
} from "./setupWizardUtils";

function detected(overrides: Partial<HarnessDetectedCli>): HarnessDetectedCli {
  return {
    kind: "claude-code",
    label: "Claude Code",
    command: "claude",
    found: true,
    path: "/usr/local/bin/claude",
    version: "claude 2.1.0",
    lastVerifiedVersion: null,
    recommendSmoke: false,
    probedAt: "2026-07-01T12:00:00.000Z",
    message: null,
    ...overrides,
  };
}

describe("shouldAutoLaunchSetupWizard", () => {
  it("launches only for a missing token with a confirmed 401 probe", () => {
    expect(
      shouldAutoLaunchSetupWizard({ tokenSource: "missing", pathname: "/", probeStatus: 401 }),
    ).toBe(true);
  });

  it("never hijacks when a token exists, regardless of probe outcome", () => {
    for (const tokenSource of ["environment", "browser"] as const) {
      expect(shouldAutoLaunchSetupWizard({ tokenSource, pathname: "/", probeStatus: 401 })).toBe(
        false,
      );
    }
  });

  it("stays quiet when the API does not demand auth or is unreachable", () => {
    // Mocked/unauthenticated APIs (200), missing routes (404), proxy errors
    // (500), and unreachable APIs (null) must not trigger the wizard.
    for (const probeStatus of [200, 404, 500, null]) {
      expect(
        shouldAutoLaunchSetupWizard({ tokenSource: "missing", pathname: "/", probeStatus }),
      ).toBe(false);
    }
  });

  it("never redirects away from the wizard itself or the Settings token tooling", () => {
    expect(
      shouldAutoLaunchSetupWizard({ tokenSource: "missing", pathname: "/setup", probeStatus: 401 }),
    ).toBe(false);
    expect(
      shouldAutoLaunchSetupWizard({
        tokenSource: "missing",
        pathname: "/settings",
        probeStatus: 401,
      }),
    ).toBe(false);
  });
});

describe("deriveSetupWizardStepStatuses", () => {
  it("marks everything pending or unknown on a fresh browser", () => {
    expect(
      deriveSetupWizardStepStatuses({
        tokenSource: "missing",
        repositoryCount: null,
        harnessProbeKnown: false,
        anyHarnessFound: false,
        profileCount: null,
      }),
    ).toEqual({
      token: "pending",
      repository: "unknown",
      harness: "unknown",
      profiles: "unknown",
      review: "pending",
    });
  });

  it("reflects existing state on a re-run (token, repos, harness, profiles present)", () => {
    expect(
      deriveSetupWizardStepStatuses({
        tokenSource: "browser",
        repositoryCount: 2,
        harnessProbeKnown: true,
        anyHarnessFound: true,
        profileCount: 3,
      }),
    ).toEqual({
      token: "done",
      repository: "done",
      harness: "done",
      profiles: "done",
      review: "pending",
    });
  });

  it("keeps resolved-but-empty collections pending, not unknown", () => {
    const statuses = deriveSetupWizardStepStatuses({
      tokenSource: "browser",
      repositoryCount: 0,
      harnessProbeKnown: true,
      anyHarnessFound: false,
      profileCount: 0,
    });

    expect(statuses.repository).toBe("pending");
    expect(statuses.harness).toBe("pending");
    expect(statuses.profiles).toBe("pending");
  });
});

describe("step navigation", () => {
  it("walks the five steps in order and stops at the ends", () => {
    expect(setupWizardStepOrder).toEqual(["token", "repository", "harness", "profiles", "review"]);
    expect(nextSetupWizardStep("token")).toBe("repository");
    expect(nextSetupWizardStep("profiles")).toBe("review");
    expect(nextSetupWizardStep("review")).toBeNull();
    expect(previousSetupWizardStep("token")).toBeNull();
    expect(previousSetupWizardStep("review")).toBe("profiles");
  });
});

describe("parseSetupWizardCompletionState", () => {
  it("accepts only the two persisted states", () => {
    expect(parseSetupWizardCompletionState("completed")).toBe("completed");
    expect(parseSetupWizardCompletionState("skipped")).toBe("skipped");
    expect(parseSetupWizardCompletionState(null)).toBeNull();
    expect(parseSetupWizardCompletionState("garbage")).toBeNull();
  });
});

describe("summarizeDetectedHarnesses", () => {
  it("splits found and missing harnesses and tracks smoke recommendations", () => {
    const summary = summarizeDetectedHarnesses([
      detected({ kind: "claude-code", recommendSmoke: true }),
      detected({ kind: "codex", label: "Codex", found: false, path: null, version: null }),
    ]);

    expect(summary.probed).toBe(true);
    expect(summary.anyFound).toBe(true);
    expect(summary.found.map((harness) => harness.kind)).toEqual(["claude-code"]);
    expect(summary.missing.map((harness) => harness.kind)).toEqual(["codex"]);
    expect(summary.smokeRecommended.map((harness) => harness.kind)).toEqual(["claude-code"]);
  });

  it("treats an undefined or empty list as not probed (Pi fallback territory)", () => {
    expect(summarizeDetectedHarnesses(undefined)).toEqual({
      probed: false,
      found: [],
      missing: [],
      anyFound: false,
      smokeRecommended: [],
    });
    expect(summarizeDetectedHarnesses([]).anyFound).toBe(false);
  });
});

describe("classifySetupTokenFailure", () => {
  it("maps 403 to non-loopback and 409 to token-exists guidance", () => {
    expect(classifySetupTokenFailure(403)).toBe("non_loopback");
    expect(classifySetupTokenFailure(409)).toBe("token_exists");
    expect(classifySetupTokenFailure(500)).toBe("other");
    expect(classifySetupTokenFailure(null)).toBe("other");
  });
});
