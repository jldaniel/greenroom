import { Link } from "@tanstack/react-router";
import { KeyRound, LoaderCircle, Plus, RefreshCw } from "lucide-react";

import { GreenroomApiError } from "../api/client";
import { useMintBrowserToken } from "../api/hooks";
import { classifySetupTokenFailure } from "../routes/setupWizardUtils";
import { messageForError } from "../utils";
import type { ApiAuthPromptKind } from "./connectGreenroomUtils";

export const browserTokenCreateHint = 'greenroom token create --name "Browser" --scopes admin';

/**
 * Rendered by `ApiErrorBanner` in place of a raw 401 banner.
 *
 * - `connect`: no token is stored anywhere; one click mints a browser token
 *   through the loopback-only setup endpoint, stores it, and refetches every
 *   query so the page just works.
 * - `reconnect`: a browser-stored token was rejected (revoked or stale); the
 *   state is an honest error and the stored token is only replaced when the
 *   user clicks Reconnect and the mint succeeds.
 *
 * When minting fails (403: non-loopback bind or non-loopback client), the
 * prompt falls back to paste-a-token guidance with the CLI
 * hint and a link to the setup wizard, which has the paste field.
 */
export function ConnectGreenroomPrompt({ kind }: { kind: ApiAuthPromptKind }) {
  const mintToken = useMintBrowserToken();
  const failureStatus =
    mintToken.error instanceof GreenroomApiError ? mintToken.error.status : null;
  const failureKind = mintToken.error === null ? null : classifySetupTokenFailure(failureStatus);

  return (
    <div
      className="rounded-lg border border-line bg-surface p-4"
      role={kind === "reconnect" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {kind === "connect" ? "Connect to Greenroom" : "Stored API token was rejected"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {kind === "connect"
              ? "This browser has no API token yet. Create one with a single click — the API only allows this from the machine Greenroom runs on."
              : "The token stored in this browser is invalid or was revoked. Reconnect to replace it with a freshly minted token, or paste one in Settings."}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => mintToken.mutate()}
              disabled={mintToken.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              {mintToken.isPending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : kind === "connect" ? (
                <Plus aria-hidden="true" className="size-4" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-4" />
              )}
              {kind === "connect" ? "Create access token" : "Reconnect"}
            </button>
            <Link
              to="/setup"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
            >
              Open setup wizard
            </Link>
          </div>

          {failureKind === null ? null : (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-ink">
              <p>
                {failureKind === "non_loopback"
                  ? "The API refused to mint a token for this browser (it is not bound to loopback, or this client is not connecting from loopback)."
                  : failureKind === "token_exists"
                    ? "This Greenroom server only mints the first token unauthenticated."
                    : messageForError(mintToken.error)}{" "}
                Mint a token on the machine running Greenroom and paste it in the setup wizard or
                Settings:
              </p>
              <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 font-mono text-xs text-ink">
                {browserTokenCreateHint}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
