import type { DiffFileStatus, ReviewStatus } from "@greenroom/schemas";

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const className =
    status === "open"
      ? "border-success/30 bg-success-soft text-success-ink"
      : "border-line bg-muted-surface text-muted";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {status === "open" ? "Open" : "Closed"}
    </span>
  );
}

export function FileStatusBadge({ status }: { status: DiffFileStatus }) {
  const className = fileStatusClassName(status);

  return (
    <span
      className={`inline-flex min-w-16 justify-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function fileStatusClassName(status: DiffFileStatus): string {
  switch (status) {
    case "added":
      return "border-success/30 bg-success-soft text-success-ink";
    case "deleted":
      return "border-danger/30 bg-danger-soft text-danger-ink";
    case "renamed":
    case "copied":
      return "border-accent/30 bg-accent-soft text-accent-ink";
    case "binary":
      return "border-warning/30 bg-warning-soft text-warning-ink";
    default:
      return "border-line bg-muted-surface text-muted";
  }
}

function statusLabel(status: DiffFileStatus): string {
  switch (status) {
    case "mode_changed":
      return "mode";
    case "type_changed":
      return "type";
    default:
      return status;
  }
}
