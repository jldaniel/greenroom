import type { SpotlightRun, SpotlightViewHealth } from "@greenroom/schemas";

export function SpotlightIntentBadge({ intent }: { intent: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center [overflow-wrap:anywhere] rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">
      {intent}
    </span>
  );
}

export function SpotlightHealthBadge({ health }: { health: SpotlightViewHealth }) {
  const className =
    health === "current"
      ? "border-success/30 bg-success-soft text-success-ink"
      : health === "drifted"
        ? "border-warning/30 bg-warning-soft text-warning-ink"
        : "border-danger/30 bg-danger-soft text-danger-ink";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {health}
    </span>
  );
}

export function spotlightRunStatusLabel(run: SpotlightRun): string {
  switch (run.status) {
    case "pending_consent":
      return "Pending consent";
    case "awaiting_plan_approval":
      return "Awaiting plan approval";
    case "generating":
      return run.type === "regenerate" ? "Regenerating views" : "Generating views";
    case "updating":
      return run.type === "refine_view" ? "Refining View" : "Updating views";
    case "completed":
      return run.type === "update"
        ? "Views updated"
        : run.type === "regenerate"
          ? "Views regenerated"
          : run.type === "refine_view"
            ? "View refined"
            : "Views generated";
    case "failed":
      return "Spotlight run failed";
    default:
      return run.status[0]!.toUpperCase() + run.status.slice(1).replaceAll("_", " ");
  }
}
