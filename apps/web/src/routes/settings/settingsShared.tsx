import type { ReactNode } from "react";
import { AlertCircle, Clipboard, X } from "lucide-react";

import { messageForError } from "../../utils";
import { redactDiagnostic, statusBadgeClassName, type StatusTone } from "./settingsUtils";

/**
 * Small presentational building blocks shared by the Settings sections.
 * Pure logic lives in `settingsUtils.ts`.
 */

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusBadgeClassName(
        tone,
      )}`}
    >
      {label}
    </span>
  );
}

export function StatusDetail({
  icon,
  label,
  meta,
  statusLabel,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  meta?: string | undefined;
  statusLabel: string;
  tone: StatusTone;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase text-muted">
        <span className="text-muted">{icon}</span>
        <span>{label}</span>
      </dt>
      <dd className="mt-1 min-w-0">
        <StatusBadge label={statusLabel} tone={tone} />
        <p className="mt-1 break-all font-mono text-xs text-ink">{value}</p>
        {meta === undefined ? null : <p className="mt-1 break-all text-xs text-muted">{meta}</p>}
      </dd>
    </div>
  );
}

export function RedactedActionError({ error, label }: { error: unknown; label: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger-ink"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words">
        <span className="font-medium">{label}:</span> {redactDiagnostic(messageForError(error))}
      </p>
    </div>
  );
}

/**
 * One-time plaintext token display. Rendered wherever a capability token was
 * just minted; the value is never shown again after dismissal.
 */
export function PlaintextTokenNotice({
  token,
  onDismiss,
}: {
  token: string;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-warning-ink">
      <div className="flex items-start gap-3">
        <Clipboard aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Plaintext token</p>
          <p className="mt-2 break-all rounded-md bg-surface px-3 py-2 font-mono text-sm text-ink">
            {token}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-surface text-warning-ink"
          aria-label="Dismiss plaintext token"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
