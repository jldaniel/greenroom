import type { Profile, ProfileConsentMode } from "@greenroom/schemas";

import { ApiHttpError } from "./errors";

/**
 * Trusted profiles skip pre-run confirmation entirely: run-creation
 * requests start immediately even without `start: true`, and the built-in
 * review workflow auto-creates threads from validated findings. Trusted mode
 * reduces clicks, not records — the consent summary and approved scope are
 * still recorded exactly as in one-click mode.
 */
export function isTrustedProfile(profile: Profile): boolean {
  return profile.privacy.consentMode === "trusted";
}

/**
 * Consent mode actually exercised by a run-creation request. Trusted profiles
 * always start immediately, so every run they create is a trusted run;
 * otherwise `start: true` combines context consent and run approval into one
 * action (one-click), while the default keeps the strict create-then-approve
 * flow (two-step).
 */
export function consentModeForRequest(start: boolean, profile: Profile): ProfileConsentMode {
  if (isTrustedProfile(profile)) {
    return "trusted";
  }

  return start ? "one_click" : "two_step";
}

/**
 * Rejects atomic create-and-start requests for profiles that opted into the
 * strict two-step consent flow. Must run before any run state is created so
 * a rejected one-click request leaves no pending run behind. One-click and
 * trusted profiles both pass; trusted additionally starts without `start`.
 */
export function assertProfileAllowsOneClickConsent(profile: Profile): void {
  if (profile.privacy.consentMode === "two_step") {
    throw new ApiHttpError(
      409,
      "conflict",
      `Profile ${profile.name} requires two-step consent; create the run first and approve it separately`,
    );
  }
}
