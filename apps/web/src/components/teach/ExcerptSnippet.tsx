import type { DiffLine, TeachingContextFile, TeachingExcerptRef } from "@greenroom/schemas";

import { resolveTeachingExcerpt } from "./excerptResolution";

/**
 * Inline code/diff snippet for a teaching excerpt reference. Uses
 * the same add/remove/context line styling tokens as the workspace DiffViewer
 * (`bg-addition` / `bg-deletion`) in a compact read-only table. Unresolvable
 * references degrade to a muted "excerpt unavailable" note.
 */
export function ExcerptSnippet({
  contextFiles,
  excerptRef,
}: {
  contextFiles: readonly TeachingContextFile[];
  excerptRef: TeachingExcerptRef;
}) {
  const resolution = resolveTeachingExcerpt(excerptRef, contextFiles);

  if (resolution.kind === "unresolved") {
    return (
      <p
        className="break-words rounded-md border border-dashed border-line bg-muted-surface px-3 py-2 text-xs text-muted"
        data-testid="teaching-excerpt-unavailable"
      >
        Excerpt unavailable - <span className="font-mono">{resolution.label}</span>.{" "}
        {resolution.reason}
      </p>
    );
  }

  return (
    <figure
      className="overflow-hidden rounded-md border border-line"
      data-testid="teaching-excerpt"
    >
      <figcaption className="break-all border-b border-line bg-muted-surface px-3 py-1.5 font-mono text-xs text-muted">
        {resolution.label}
      </figcaption>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left font-mono text-xs">
          <tbody>
            {resolution.segments.flatMap((segment, segmentIndex) => [
              <tr className="bg-hunk text-muted" key={`segment-${segmentIndex}-header`}>
                <td className="w-12 select-none border-r border-line px-2 py-0.5 text-right" />
                <td className="w-12 select-none border-r border-line px-2 py-0.5 text-right" />
                <td className="px-3 py-0.5">{segment.hunkHeader}</td>
              </tr>,
              ...segment.lines.map((line, lineIndex) => (
                <tr
                  className={excerptLineClassName(line.type)}
                  key={`segment-${segmentIndex}-line-${lineIndex}`}
                >
                  <td className="w-12 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted">
                    {line.oldLineNumber ?? ""}
                  </td>
                  <td className="w-12 select-none border-r border-line/70 px-2 py-0.5 text-right text-muted">
                    {line.newLineNumber ?? ""}
                  </td>
                  <td className="whitespace-pre-wrap break-words px-3 py-0.5">
                    <span className="select-none pr-2 text-muted">{linePrefix(line.type)}</span>
                    {line.content}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function excerptLineClassName(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-addition";
    case "deletion":
      return "bg-deletion";
    case "no_newline":
      return "bg-warning-soft text-warning-ink";
    default:
      return "bg-surface";
  }
}

function linePrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}
