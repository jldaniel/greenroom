import type {
  ParticipantKind,
  ThreadRef,
  ThreadAnchor,
  ThreadSeverity,
  ThreadSource,
  ThreadStatus,
  ThreadType,
  ThreadWithComments,
} from "@greenroom/schemas";

export type ThreadFilter =
  | "open"
  | "current-file-unresolved"
  | "ai-external"
  | "question"
  | "has-severity"
  | "outdated"
  | "dismissed";

export const threadFilterOptions: { id: ThreadFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "current-file-unresolved", label: "Current file" },
  { id: "ai-external", label: "AI/external" },
  { id: "question", label: "Question" },
  { id: "has-severity", label: "Severity" },
  { id: "outdated", label: "Outdated" },
  { id: "dismissed", label: "Dismissed" },
];

export function filterThreads(
  threads: readonly ThreadWithComments[],
  filters: readonly ThreadFilter[],
  selectedFilePath: string | null,
): ThreadWithComments[] {
  if (filters.length === 0) {
    return [...threads];
  }

  return threads.filter((thread) =>
    filters.every((filter) => threadMatchesFilter(thread, filter, selectedFilePath)),
  );
}

export function threadMatchesFilter(
  thread: ThreadWithComments,
  filter: ThreadFilter,
  selectedFilePath: string | null,
): boolean {
  switch (filter) {
    case "open":
      return thread.status === "open";
    case "current-file-unresolved":
      return (
        selectedFilePath !== null &&
        thread.status === "open" &&
        threadAnchors(thread).some((anchor) => anchor.filePath === selectedFilePath)
      );
    case "ai-external":
      return thread.source.kind !== "human";
    case "question":
      return thread.type === "question";
    case "has-severity":
      return thread.severity !== null;
    case "outdated":
      return thread.outdated;
    case "dismissed":
      return thread.status === "dismissed";
  }
}

export function threadAnchorKey(anchor: ThreadAnchor): string {
  return [
    anchor.revisionId,
    anchor.filePath,
    anchor.oldFilePath ?? "",
    anchor.side,
    anchor.lineType,
    anchor.lineNumber,
    anchor.hunkId ?? "",
  ].join(":");
}

export function threadAnchors(thread: ThreadWithComments): ThreadAnchor[] {
  return thread.anchors.length === 0 ? [thread.anchor] : thread.anchors;
}

export function threadAnchorLabel(thread: ThreadWithComments): string {
  const anchors = threadAnchors(thread)
    .filter((anchor) => anchor.filePath === thread.anchor.filePath)
    .toSorted((left, right) => left.lineNumber - right.lineNumber);

  if (anchors.length <= 1) {
    return `${thread.anchor.filePath}:${thread.anchor.lineNumber}`;
  }

  const first = anchors[0];
  const last = anchors.at(-1);

  if (first === undefined || last === undefined) {
    return `${thread.anchor.filePath}:${thread.anchor.lineNumber}`;
  }

  const contiguous = anchors.every(
    (anchor, index) => index === 0 || anchor.lineNumber === anchors[index - 1]!.lineNumber + 1,
  );

  if (contiguous) {
    return `${thread.anchor.filePath}:${first.lineNumber}-${last.lineNumber}`;
  }

  const lineNumbers = anchors.map((anchor) => anchor.lineNumber);
  const visibleLineNumbers = lineNumbers.slice(0, 3).join(",");
  const suffix = lineNumbers.length > 3 ? `,+${lineNumbers.length - 3}` : "";

  return `${thread.anchor.filePath}:${visibleLineNumbers}${suffix}`;
}

export function sourceKindLabel(kind: ParticipantKind): string {
  switch (kind) {
    case "mcp_client":
      return "MCP client";
    case "external_agent":
      return "External agent";
    case "teaching":
      return "Teaching";
    case "builtin_reviewer":
      return "Built-in reviewer";
    case "system":
      return "System";
    default:
      return "Human";
  }
}

export function statusLabel(status: ThreadStatus): string {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    default:
      return "Open";
  }
}

export function typeLabel(type: ThreadType): string {
  switch (type) {
    case "question":
      return "Question";
    case "issue":
      return "Issue";
    case "suggestion":
      return "Suggestion";
    default:
      return "Note";
  }
}

export function severityLabel(severity: ThreadSeverity | null): string {
  switch (severity) {
    case "blocking":
      return "Blocking";
    case "major":
      return "Major";
    case "minor":
      return "Minor";
    case "nit":
      return "Nit";
    default:
      return "No severity";
  }
}

export function sourceDisplayName(source: ThreadSource): string {
  const parts = [source.displayName];

  if (source.clientName !== undefined && source.clientName !== null) {
    parts.push(source.clientName);
  }

  if (source.toolName !== undefined && source.toolName !== null) {
    parts.push(source.toolName);
  }

  return parts.join(" / ");
}

export function threadDomId(shortRef: ThreadRef): string {
  return `thread-${shortRef}`;
}
