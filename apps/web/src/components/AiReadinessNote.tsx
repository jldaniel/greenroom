import { Link } from "@tanstack/react-router";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

import type { AiRunReadiness } from "./aiReadinessUtils";

/**
 * Inline AI readiness state for run CTAs: a warning with a fix-it
 * link to Settings > Connections when the backing runtime cannot run, a
 * short positive line when it can, and a subtle checking state while the
 * harness status loads.
 */
export function AiReadinessNote({
  className = "",
  isChecking,
  readiness,
}: {
  className?: string;
  isChecking: boolean;
  readiness: AiRunReadiness;
}) {
  if (readiness.blocked) {
    return (
      <div
        className={`rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-ink ${className}`}
      >
        <p className="flex items-start gap-1.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{readiness.reason}</span>
        </p>
        {readiness.showConnectionsLink ? (
          <Link
            className="mt-1.5 inline-flex font-medium underline underline-offset-2 hover:opacity-80"
            search={{ section: "connections" }}
            to="/settings"
          >
            Fix in Connections
          </Link>
        ) : null}
      </div>
    );
  }

  if (readiness.detail !== null) {
    return (
      <p className={`flex min-w-0 items-center gap-1.5 text-xs text-muted ${className}`}>
        <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0 text-success-ink" />
        <span className="min-w-0 break-words">{readiness.detail}</span>
      </p>
    );
  }

  if (isChecking) {
    return (
      <p className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
        <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
        Checking AI runtime status
      </p>
    );
  }

  return null;
}
