/**
 * Lazy, sandboxed Mermaid rendering for teaching diagrams.
 *
 * The `mermaidSource` in structured teaching output is model-authored and only
 * structurally validated server-side, so it is untrusted input. Two
 * layers keep it from executing anything in the app origin:
 *
 * 1. Mermaid itself is initialized with `securityLevel: "strict"` (tags in
 *    labels are encoded, click/interaction callbacks disabled) and HTML
 *    labels are turned off so label text renders as plain SVG `<text>` nodes
 *    instead of `<foreignObject>` HTML.
 * 2. The SVG string Mermaid returns is sanitized with DOMPurify using an
 *    SVG-only profile before it is ever inserted into the document:
 *    `<script>`/`<foreignObject>`/embedding tags are forbidden and DOMPurify
 *    strips event-handler attributes and `javascript:` URLs by default.
 *
 * We chose sanitize-then-inline over a sandboxed iframe because the diagrams
 * are static pictures (strict mode already disables Mermaid interactivity):
 * inline SVG sizes naturally inside the walkthrough cards and inherits the
 * app font, whereas an iframe needs manual height plumbing and a duplicated
 * style pipeline. Both libraries load via dynamic `import()` on first diagram
 * mount so the main bundle does not grow for users who never open Teach.
 */

export const MERMAID_INIT_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  fontFamily: "inherit",
  // Force SVG <text> labels everywhere (root-level htmlLabels overrides the
  // per-diagram settings) so forbidding <foreignObject> below never strips
  // visible label text out of a legitimate diagram.
  htmlLabels: false,
} as const;

export const MERMAID_SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignobject", "iframe", "object", "embed", "math"],
  // DOMPurify drops on* handlers by default; forbid the SVG animation/link
  // attributes that can smuggle URLs or retarget elements as defense in depth.
  FORBID_ATTR: ["href", "xlink:href", "from", "to", "autofocus"],
} satisfies import("dompurify").Config;

/** Minimal DOMPurify surface `sanitizeMermaidSvg` needs, for unit tests. */
export type SvgSanitizer = {
  sanitize: (dirty: string, config: typeof MERMAID_SVG_SANITIZE_CONFIG) => string;
};

/**
 * Sanitizes a Mermaid-produced SVG string for inline insertion. Throws when
 * sanitization leaves no `<svg>` root (everything meaningful was stripped),
 * so callers fall back to the source-text view instead of an empty block.
 */
export function sanitizeMermaidSvg(svg: string, sanitizer: SvgSanitizer): string {
  const clean = sanitizer.sanitize(svg, MERMAID_SVG_SANITIZE_CONFIG);
  if (!clean.toLowerCase().includes("<svg")) {
    throw new Error("Sanitized Mermaid output contained no SVG element");
  }
  return clean;
}

type LoadedModules = {
  mermaid: (typeof import("mermaid"))["default"];
  purify: SvgSanitizer;
};

let modulesPromise: Promise<LoadedModules> | null = null;
let renderSequence = 0;

function loadModules(): Promise<LoadedModules> {
  modulesPromise ??= Promise.all([import("mermaid"), import("dompurify")]).then(
    ([mermaidModule, dompurifyModule]) => {
      const mermaid = mermaidModule.default;
      mermaid.initialize(MERMAID_INIT_CONFIG);
      return { mermaid, purify: dompurifyModule.default };
    },
  );
  // Allow later diagrams to retry if a chunk fails to load transiently.
  modulesPromise.catch(() => {
    modulesPromise = null;
  });
  return modulesPromise;
}

/**
 * Renders untrusted Mermaid source to a sanitized SVG string. Rejects on
 * library load failure, parse failure, render failure, or empty sanitizer
 * output; callers render the source-text fallback in every rejection case.
 */
export async function renderTeachingDiagram(mermaidSource: string): Promise<string> {
  const { mermaid, purify } = await loadModules();
  // Parse first: it rejects invalid source without touching the DOM, keeping
  // failed renders from leaving Mermaid error artifacts on the page.
  await mermaid.parse(mermaidSource);
  renderSequence += 1;
  const { svg } = await mermaid.render(`teaching-diagram-svg-${renderSequence}`, mermaidSource);
  return sanitizeMermaidSvg(svg, purify);
}
