import { AlertCircle, LoaderCircle } from "lucide-react";

import { GreenroomApiError, readGreenroomApiTokenStatus } from "../api/client";
import { messageForError } from "../utils";
import { ConnectGreenroomPrompt } from "./ConnectGreenroom";
import { deriveApiAuthPrompt } from "./connectGreenroomUtils";
import { dedupeErrorsForDisplay, errorDisplayKey } from "./feedbackUtils";

/**
 * The workspace's one deduplicated error banner: pass every query
 * and mutation error; identical failures render once, in first-seen order.
 */
export function ApiErrorBannerGroup({ errors }: { errors: readonly unknown[] }) {
  const unique = dedupeErrorsForDisplay(errors);

  if (unique.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {unique.map((error) => (
        <ApiErrorBanner error={error} key={errorDisplayKey(error)} />
      ))}
    </div>
  );
}

export function ApiErrorBanner({ error }: { error: unknown }) {
  // Central 401 handling: instead of a raw banner, tokenless 401s
  // offer one-click browser-token minting and rejected browser-stored tokens
  // offer an explicit reconnect. Environment tokens keep the plain
  // error below.
  const authPrompt = deriveApiAuthPrompt({
    status: error instanceof GreenroomApiError ? error.status : null,
    tokenSource: readGreenroomApiTokenStatus().source,
  });

  if (authPrompt !== null) {
    return <ConnectGreenroomPrompt kind={authPrompt} />;
  }

  const action = actionForError(error);

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">
        <p>{messageForError(error)}</p>
        {action === null ? null : <p className="mt-1 text-xs text-danger-ink/90">{action}</p>}
      </div>
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm text-muted">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="break-words rounded-lg border border-dashed border-line bg-muted-surface px-4 py-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {body === undefined ? null : <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

function actionForError(error: unknown): string | null {
  if (error instanceof GreenroomApiError) {
    if (error.status === 0) {
      return "Start the local API or update the configured API base URL, then retry.";
    }

    if (error.status === 401) {
      return "Create or paste a valid local capability token in Settings.";
    }

    if (error.status === 403) {
      return "Use a token with the required scope for this action.";
    }

    if (error.status === 400 || error.status === 409) {
      return "Check the selected repository, refs, revision, or provider profile and retry.";
    }

    if (error.status >= 500) {
      return "Check the server log for the failing local operation, then retry.";
    }
  }

  return null;
}
