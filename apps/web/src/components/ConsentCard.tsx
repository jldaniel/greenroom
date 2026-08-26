import type { ReactNode } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";

import type { WorkflowConsentSummary } from "@greenroom/schemas";

import { WorkflowConsentSummaryPanel } from "./WorkflowPanels";

/**
 * Shared consent card: the one rendering of "what this run may
 * inspect" plus the approve action for runs that are waiting on explicit
 * consent (strict two-step profiles, gated Spotlight runs). One-click and
 * trusted profiles never reach this card — their consent is the shared
 * RunConsentDialog confirmation or skipped entirely.
 *
 * `fallback` renders when the durable workflow consent summary is not
 * available yet (e.g. teaching or Spotlight runs whose linked workflow record
 * has not loaded); sections pass their run-local scope summary.
 */
export function ConsentCard({
  approveLabel = "Approve run",
  compact = false,
  consent,
  fallback = null,
  isApproving = false,
  onApprove,
}: {
  approveLabel?: string;
  compact?: boolean;
  consent: WorkflowConsentSummary | null;
  fallback?: ReactNode;
  isApproving?: boolean;
  onApprove?: () => void;
}) {
  const summary =
    consent === null ? (
      fallback
    ) : (
      <WorkflowConsentSummaryPanel compact={compact} consent={consent} />
    );

  if (summary === null && onApprove === undefined) {
    return null;
  }

  return (
    <div className="space-y-3">
      {summary}
      {onApprove === undefined ? null : (
        <button
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-surface disabled:opacity-60"
          disabled={isApproving}
          onClick={onApprove}
          type="button"
        >
          {isApproving ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          )}
          {approveLabel}
        </button>
      )}
    </div>
  );
}
