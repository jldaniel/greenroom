import { MessageSquarePlus } from "lucide-react";

import type {
  StructuredTeachingOutput,
  TeachingContextFile,
  TeachingDiagram,
  TeachingPoint,
} from "@greenroom/schemas";

import { ExcerptSnippet } from "./ExcerptSnippet";
import { TeachingDiagramBlock } from "./TeachingDiagramBlock";
import type { TeachingPromotedPoint } from "./teachingSessionUtils";

/**
 * Walkthrough section of the Teach page: one card per teaching
 * point with its inline excerpts, an adjacent diagram when the point
 * references one via `diagramId`, and the promote-to-thread affordance.
 * Diagrams no point references render in a trailing section so structured
 * output is never silently dropped.
 */
export function TeachingWalkthrough({
  contextFiles,
  onPromote,
  output,
}: {
  contextFiles: readonly TeachingContextFile[];
  onPromote: (point: TeachingPromotedPoint) => void;
  output: StructuredTeachingOutput;
}) {
  const diagramsById = new Map((output.diagrams ?? []).map((diagram) => [diagram.id, diagram]));
  const referencedDiagramIds = new Set(
    output.walkthrough
      .map((point) => point.diagramId ?? null)
      .filter((diagramId): diagramId is string => diagramId !== null),
  );
  const unreferencedDiagrams = (output.diagrams ?? []).filter(
    (diagram) => !referencedDiagramIds.has(diagram.id),
  );

  return (
    <section aria-label="Walkthrough" className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted">Walkthrough</p>
      {output.walkthrough.map((point) => (
        <TeachingPointCard
          contextFiles={contextFiles}
          diagram={point.diagramId === null ? null : (diagramsById.get(point.diagramId) ?? null)}
          key={point.id}
          onPromote={onPromote}
          point={point}
        />
      ))}
      {unreferencedDiagrams.length === 0 ? null : (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium uppercase text-muted">Diagrams</p>
          {unreferencedDiagrams.map((diagram) => (
            <TeachingDiagramBlock diagram={diagram} key={diagram.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function TeachingPointCard({
  contextFiles,
  diagram,
  onPromote,
  point,
}: {
  contextFiles: readonly TeachingContextFile[];
  diagram: TeachingDiagram | null;
  onPromote: (point: TeachingPromotedPoint) => void;
  point: TeachingPoint;
}) {
  const excerpts = point.excerpts ?? [];

  return (
    <article className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{point.title}</p>
          {point.filePath === null ? null : (
            <p className="mt-1 truncate font-mono text-xs text-muted">
              {point.filePath}
              {point.lineNumber === null ? "" : `:${point.lineNumber}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onPromote({ title: point.title, body: point.body, anchor: point.anchor })}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:bg-muted-surface hover:text-accent-ink"
          title="Promote to thread"
        >
          <MessageSquarePlus aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{point.body}</p>
      {excerpts.length === 0 ? null : (
        <div className="mt-3 space-y-2">
          {excerpts.map((excerptRef, index) => (
            <ExcerptSnippet contextFiles={contextFiles} excerptRef={excerptRef} key={index} />
          ))}
        </div>
      )}
      {diagram === null ? null : (
        <div className="mt-3">
          <TeachingDiagramBlock diagram={diagram} />
        </div>
      )}
    </article>
  );
}
