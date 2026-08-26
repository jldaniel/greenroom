import type { HarnessDetectedCli } from "@greenroom/schemas";

import type { GreenroomApiTokenSource } from "../api/client";

/**
 * Persisted completion marker for the first-run wizard. "completed" and
 * "skipped" both stop the wizard from auto-launching while a working token
 * exists; when the app genuinely has no token (the unauthenticated probe
 * 401s) the wizard still auto-launches so a fresh browser is never left on
 * raw error banners.
 */
export const setupWizardStorageKey = "greenroom.setupWizard";

export type SetupWizardCompletionState = "completed" | "skipped" | null;

export type SetupWizardStepId = "token" | "repository" | "harness" | "profiles" | "review";

export const setupWizardStepOrder: readonly SetupWizardStepId[] = [
  "token",
  "repository",
  "harness",
  "profiles",
  "review",
];

export const setupWizardStepTitles: Record<SetupWizardStepId, string> = {
  token: "Token",
  repository: "Repository",
  harness: "Harness",
  profiles: "Profiles",
  review: "First review",
};

export type SetupWizardStepStatus = "done" | "pending" | "unknown";

export interface SetupWizardStepInputs {
  tokenSource: GreenroomApiTokenSource;
  /** null while the repositories query has not resolved. */
  repositoryCount: number | null;
  /** true once `/api/harness/status` has resolved. */
  harnessProbeKnown: boolean;
  anyHarnessFound: boolean;
  /** null while the profiles query has not resolved. */
  profileCount: number | null;
}

/**
 * Derives per-step completion from current app state so a re-run of the
 * wizard (Settings -> "Run setup wizard") shows what already exists instead
 * of pretending the app is fresh.
 */
export function deriveSetupWizardStepStatuses(
  inputs: SetupWizardStepInputs,
): Record<SetupWizardStepId, SetupWizardStepStatus> {
  return {
    token: inputs.tokenSource === "missing" ? "pending" : "done",
    repository:
      inputs.repositoryCount === null ? "unknown" : inputs.repositoryCount > 0 ? "done" : "pending",
    harness: inputs.harnessProbeKnown ? (inputs.anyHarnessFound ? "done" : "pending") : "unknown",
    profiles:
      inputs.profileCount === null ? "unknown" : inputs.profileCount > 0 ? "done" : "pending",
    // The wizard never marks the review step done: it hands off to the
    // existing review-creation flow instead of tracking review counts.
    review: "pending",
  };
}

export function nextSetupWizardStep(current: SetupWizardStepId): SetupWizardStepId | null {
  const index = setupWizardStepOrder.indexOf(current);
  return setupWizardStepOrder[index + 1] ?? null;
}

export function previousSetupWizardStep(current: SetupWizardStepId): SetupWizardStepId | null {
  const index = setupWizardStepOrder.indexOf(current);
  return index <= 0 ? null : (setupWizardStepOrder[index - 1] ?? null);
}

/**
 * First-launch detection. The wizard auto-launches only when the browser has
 * no stored token AND an unauthenticated probe of the API returned 401 —
 * i.e. the API is reachable and genuinely requires a token the app does not
 * have. Any other probe outcome (success, 404, proxy error, unreachable)
 * means either the API does not require auth or something else is wrong, and
 * normal error surfaces handle it; the wizard must not hijack those flows.
 * `/setup` itself and `/settings` (the manual token tooling) are never
 * redirected away from.
 */
export function shouldAutoLaunchSetupWizard(input: {
  tokenSource: GreenroomApiTokenSource;
  pathname: string;
  probeStatus: number | null;
}): boolean {
  if (input.pathname.startsWith("/setup") || input.pathname.startsWith("/settings")) {
    return false;
  }

  if (input.tokenSource !== "missing") {
    return false;
  }

  return input.probeStatus === 401;
}

export function parseSetupWizardCompletionState(value: string | null): SetupWizardCompletionState {
  return value === "completed" || value === "skipped" ? value : null;
}

export function readSetupWizardCompletionState(): SetupWizardCompletionState {
  if (typeof window === "undefined") {
    return null;
  }

  return parseSetupWizardCompletionState(window.localStorage.getItem(setupWizardStorageKey));
}

export function writeSetupWizardCompletionState(
  state: Exclude<SetupWizardCompletionState, null>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(setupWizardStorageKey, state);
}

export interface DetectedHarnessSummary {
  probed: boolean;
  found: HarnessDetectedCli[];
  missing: HarnessDetectedCli[];
  anyFound: boolean;
  smokeRecommended: HarnessDetectedCli[];
}

export function summarizeDetectedHarnesses(
  detected: readonly HarnessDetectedCli[] | undefined,
): DetectedHarnessSummary {
  const list = [...(detected ?? [])];
  const found = list.filter((harness) => harness.found);

  return {
    probed: list.length > 0,
    found,
    missing: list.filter((harness) => !harness.found),
    anyFound: found.length > 0,
    smokeRecommended: found.filter((harness) => harness.recommendSmoke),
  };
}

/**
 * Classifies a failed `POST /api/setup/tokens` call. 403 means the endpoint
 * refused this mint: the API is not bound to loopback, or — after
 * the first token exists — the requesting client is not connecting from
 * loopback. 409 only comes from older servers whose one-time
 * setup window closed after the first token (e.g. the `greenroom up`
 * supervisor bootstrap). Current servers let loopback clients keep minting, so
 * the normal browser flow succeeds instead. All failure kinds fall back to
 * the paste-a-token path with a `greenroom token create` hint.
 */
export type SetupTokenFailureKind = "non_loopback" | "token_exists" | "other";

export function classifySetupTokenFailure(status: number | null): SetupTokenFailureKind {
  if (status === 403) {
    return "non_loopback";
  }

  if (status === 409) {
    return "token_exists";
  }

  return "other";
}
