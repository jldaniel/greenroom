import { useEffect, useState } from "react";

import { Workflow } from "lucide-react";

import type { TeachingDiagram } from "@greenroom/schemas";

import { renderTeachingDiagram } from "./mermaidRenderer";

type DiagramState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "fallback" };

/**
 * Diagram renderer for teaching output. Renders `mermaidSource` as
 * an actual diagram via the lazily loaded, sandboxed pipeline in
 * `mermaidRenderer.ts` (Mermaid `securityLevel: "strict"` + DOMPurify SVG
 * profile — see that module for the full reasoning; the injected markup below
 * is always the sanitizer's output, never raw model text). Any failure —
 * library load, parse, render, or over-aggressive sanitization — falls back
 * to the source-text block with a muted note, contained per diagram so
 * one bad diagram never blanks the walkthrough.
 */
export function TeachingDiagramBlock({ diagram }: { diagram: TeachingDiagram }) {
  const [state, setState] = useState<DiagramState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    renderTeachingDiagram(diagram.mermaidSource).then(
      (svg) => {
        if (!cancelled) setState({ status: "rendered", svg });
      },
      () => {
        if (!cancelled) setState({ status: "fallback" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [diagram.mermaidSource]);

  return (
    <figure
      className="overflow-hidden rounded-md border border-line"
      data-diagram-state={state.status}
      data-testid="teaching-diagram"
    >
      <figcaption className="flex min-w-0 items-center gap-2 break-words border-b border-line bg-muted-surface px-3 py-1.5 text-xs font-medium">
        <Workflow aria-hidden="true" className="size-3.5 shrink-0 text-accent-ink" />
        <span className="min-w-0">{diagram.title}</span>
      </figcaption>
      {state.status === "loading" ? (
        <p className="bg-surface px-3 py-2 text-xs text-muted">Rendering diagram…</p>
      ) : state.status === "rendered" ? (
        <div
          className="overflow-x-auto bg-surface px-3 py-2 [&_svg]:mx-auto [&_svg]:max-w-full"
          // Sanitized by DOMPurify in renderTeachingDiagram; see mermaidRenderer.ts.
          dangerouslySetInnerHTML={{ __html: state.svg }}
          role="img"
          aria-label={diagram.title}
        />
      ) : (
        <div className="bg-surface">
          <pre className="overflow-x-auto px-3 py-2 font-mono text-xs text-muted">
            {diagram.mermaidSource}
          </pre>
          <p className="border-t border-line px-3 py-1.5 text-xs text-muted">
            This diagram could not be rendered; showing its Mermaid source instead.
          </p>
        </div>
      )}
    </figure>
  );
}
