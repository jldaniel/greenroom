import type {
  DiffLine,
  DiffSide,
  TeachingContextFile,
  TeachingExcerptRef,
} from "@greenroom/schemas";

/**
 * Excerpt resolution for the Teach surface. Teaching output
 * excerpt references are only scope-validated server-side: the API checks
 * that a `{ kind: "lines" }` excerpt names a changed file in the approved
 * scope, but never verifies that the line range or anchor line actually
 * exists on the chosen side. The renderer therefore resolves every reference
 * against the teaching context pack (`run.context.files[].hunks[].lines`,
 * whose diff lines carry old/new line numbers) and reports a structured
 * failure so the UI can fall back to a muted "excerpt unavailable" note with
 * the file/line label instead of rendering a wrong or empty snippet.
 */

export interface TeachingExcerptSegment {
  hunkHeader: string;
  lines: DiffLine[];
}

export interface ResolvedTeachingExcerpt {
  kind: "resolved";
  label: string;
  filePath: string;
  side: DiffSide;
  segments: TeachingExcerptSegment[];
}

export interface UnresolvedTeachingExcerpt {
  kind: "unresolved";
  label: string;
  reason: string;
}

export type TeachingExcerptResolution = ResolvedTeachingExcerpt | UnresolvedTeachingExcerpt;

const anchorContextRadius = 2;

/** Human label for an excerpt reference, shown even when it fails to resolve. */
export function teachingExcerptLabel(ref: TeachingExcerptRef): string {
  if (ref.kind === "anchor") {
    return `${ref.anchor.filePath}:${ref.anchor.lineNumber} (${ref.anchor.side})`;
  }

  const range =
    ref.startLine === ref.endLine ? `${ref.startLine}` : `${ref.startLine}-${ref.endLine}`;
  return `${ref.filePath}:${range} (${ref.side})`;
}

export function resolveTeachingExcerpt(
  ref: TeachingExcerptRef,
  contextFiles: readonly TeachingContextFile[],
): TeachingExcerptResolution {
  return ref.kind === "anchor"
    ? resolveAnchorExcerpt(ref, contextFiles)
    : resolveLinesExcerpt(ref, contextFiles);
}

function resolveLinesExcerpt(
  ref: Extract<TeachingExcerptRef, { kind: "lines" }>,
  contextFiles: readonly TeachingContextFile[],
): TeachingExcerptResolution {
  const label = teachingExcerptLabel(ref);
  const file = findContextFile(ref.filePath, contextFiles);

  if (file === null) {
    return unresolved(label, "The file is not part of the approved teaching context.");
  }

  if (file.isBinary) {
    return unresolved(label, "Binary files have no textual excerpt.");
  }

  const segments: TeachingExcerptSegment[] = [];

  for (const hunk of file.hunks) {
    const lines = hunk.lines.filter((line) => {
      const lineNumber = lineNumberForSide(line, ref.side);
      return lineNumber !== null && lineNumber >= ref.startLine && lineNumber <= ref.endLine;
    });

    if (lines.length > 0) {
      segments.push({ hunkHeader: hunk.header, lines });
    }
  }

  if (segments.length === 0) {
    return unresolved(label, "The line range is outside the diff hunks in the teaching context.");
  }

  return { kind: "resolved", label, filePath: file.path, side: ref.side, segments };
}

function resolveAnchorExcerpt(
  ref: Extract<TeachingExcerptRef, { kind: "anchor" }>,
  contextFiles: readonly TeachingContextFile[],
): TeachingExcerptResolution {
  const label = teachingExcerptLabel(ref);
  const { anchor } = ref;
  const file = findContextFile(anchor.filePath, contextFiles);

  if (file === null) {
    return unresolved(label, "The file is not part of the approved teaching context.");
  }

  for (const hunk of file.hunks) {
    const index = hunk.lines.findIndex(
      (line) => lineNumberForSide(line, anchor.side) === anchor.lineNumber,
    );

    if (index === -1) {
      continue;
    }

    const lines = hunk.lines.slice(
      Math.max(0, index - anchorContextRadius),
      index + anchorContextRadius + 1,
    );

    return {
      kind: "resolved",
      label,
      filePath: file.path,
      side: anchor.side,
      segments: [{ hunkHeader: hunk.header, lines }],
    };
  }

  return unresolved(label, "The anchored line was not found in the teaching context.");
}

function findContextFile(
  filePath: string,
  contextFiles: readonly TeachingContextFile[],
): TeachingContextFile | null {
  return (
    contextFiles.find((file) => file.path === filePath) ??
    contextFiles.find((file) => file.oldPath === filePath) ??
    null
  );
}

function lineNumberForSide(line: DiffLine, side: DiffSide): number | null {
  return side === "base" ? line.oldLineNumber : line.newLineNumber;
}

function unresolved(label: string, reason: string): UnresolvedTeachingExcerpt {
  return { kind: "unresolved", label, reason };
}
