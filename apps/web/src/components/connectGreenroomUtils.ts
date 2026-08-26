import type { GreenroomApiTokenSource } from "../api/client";

/**
 * Central 401 handling. Every query/mutation error rendered through
 * `ApiErrorBanner` runs through this derivation so a 401 is never shown as a
 * raw error banner when the browser can do something about it:
 *
 * - `connect`: no token anywhere — offer one-click browser-token minting
 *   against the loopback-only `POST /api/setup/tokens` endpoint.
 * - `reconnect`: a browser-stored token was rejected (revoked or stale) —
 *   show an honest error with an explicit re-mint action. The stored token
 *   is only replaced when the user clicks and the mint succeeds; it is never
 *   swapped silently.
 * - `null`: not a 401, or the token came from the environment. Those
 *   tokens are not browser-managed, so replacing them here would mask a
 *   misconfiguration; the plain error banner stays.
 */
export type ApiAuthPromptKind = "connect" | "reconnect";

export function deriveApiAuthPrompt(input: {
  status: number | null;
  tokenSource: GreenroomApiTokenSource;
}): ApiAuthPromptKind | null {
  if (input.status !== 401) {
    return null;
  }

  if (input.tokenSource === "missing") {
    return "connect";
  }

  if (input.tokenSource === "browser") {
    return "reconnect";
  }

  return null;
}
