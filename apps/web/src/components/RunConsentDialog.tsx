import { useEffect } from "react";
import { LoaderCircle, ShieldCheck, X } from "lucide-react";

export interface RunConsentDetail {
  label: string;
  value: string;
}

/**
 * Shared one-click consent confirmation: a single dialog that shows the scope
 * the AI run will see (profile, review, revision, files) and starts the run
 * on confirm. Profiles that opt into two-step consent keep the older
 * create-then-approve flow and never see this dialog; trusted profiles skip
 * it entirely and start runs immediately.
 */
export function RunConsentDialog({
  confirmLabel = "Confirm & start",
  description,
  details,
  isConfirming,
  onCancel,
  onConfirm,
  title,
}: {
  confirmLabel?: string;
  description?: string;
  details: readonly RunConsentDetail[];
  isConfirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isConfirming) {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConfirming, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        aria-label={title}
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-line bg-surface p-4 shadow-xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck aria-hidden="true" className="size-4 text-accent-ink" />
            <span className="min-w-0 break-words">{title}</span>
          </div>
          <button
            aria-label="Cancel run"
            className="inline-flex size-8 items-center justify-center rounded-md border border-line text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
            disabled={isConfirming}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-muted">
          Confirming shares the scope below with the AI profile and starts the run immediately.
        </p>

        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-line bg-muted-surface p-3 text-xs text-muted">
          {details.map((detail) => (
            <div className="contents" key={detail.label}>
              <dt>{detail.label}</dt>
              <dd className="min-w-0 break-words text-ink">{detail.value}</dd>
            </div>
          ))}
        </dl>

        {description === undefined ? null : (
          <p className="mt-3 break-words rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink">
            {description}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted hover:bg-muted-surface hover:text-ink disabled:opacity-60"
            disabled={isConfirming}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3 text-sm font-medium text-surface disabled:opacity-60"
            disabled={isConfirming}
            onClick={onConfirm}
            type="button"
          >
            {isConfirming ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
