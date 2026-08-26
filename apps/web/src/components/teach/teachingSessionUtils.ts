import type {
  TeachingContextFile,
  TeachingRunResult,
  ThreadAnchor,
  WorkflowRun,
} from "@greenroom/schemas";

/** Payload for promoting a walkthrough point or missed quiz concept to a thread. */
export interface TeachingPromotedPoint {
  title: string;
  body: string;
  anchor: ThreadAnchor | null;
}

export function latestWorkflowRunByKind(
  runs: readonly WorkflowRun[],
  workflowKind: WorkflowRun["workflowKind"],
): WorkflowRun | null {
  return runs
    .filter((run) => run.workflowKind === workflowKind)
    .reduce<WorkflowRun | null>((latest, candidate) => {
      if (latest === null) {
        return candidate;
      }

      return candidate.updatedAt >= latest.updatedAt ? candidate : latest;
    }, null);
}

/**
 * Clamps a promotion title to the API cap. The promotion endpoint
 * (`teachingPromotionInputSchema`) allows titles up to 240 characters, but
 * quiz `missedConcept` values — used as the title when promoting a wrong
 * answer — may be up to 400 characters. Truncate with an ellipsis instead of
 * letting the whole promotion fail schema validation.
 */
export function promotionTitle(title: string): string {
  return title.length <= 240 ? title : `${title.slice(0, 239).trimEnd()}…`;
}

export function consentScopeLabel(run: TeachingRunResult): string {
  if (run.context.scope.kind === "spotlight_view") {
    return `Spotlight View - ${run.context.scope.title}`;
  }

  return "Full PR";
}

/**
 * Fallback promotion anchor: the first changed line in the approved context.
 * Used when a teaching point carries no anchor of its own.
 */
export function firstAnchorFromContext(run: TeachingRunResult): ThreadAnchor | null {
  for (const file of run.context.files) {
    const anchor = firstAnchorForContextFile(run, file);

    if (anchor !== null) {
      return anchor;
    }
  }

  return null;
}

function firstAnchorForContextFile(
  run: TeachingRunResult,
  file: TeachingContextFile,
): ThreadAnchor | null {
  for (const hunk of file.hunks) {
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const line = hunk.lines[index];

      if (line === undefined) {
        continue;
      }

      if (line.type === "addition" && line.newLineNumber !== null) {
        return {
          reviewDisplayId: run.reviewDisplayId,
          revisionId: run.context.revision.id,
          filePath: file.path,
          oldFilePath: file.oldPath,
          side: "head",
          lineNumber: line.newLineNumber,
          lineType: line.type,
          hunkId: null,
          hunkHeader: hunk.header,
          contextBefore: hunk.lines
            .slice(Math.max(0, index - 3), index)
            .map((candidate) => candidate.content),
          contextAfter: hunk.lines
            .slice(index + 1, index + 4)
            .map((candidate) => candidate.content),
          originalLineText: line.content,
        };
      }

      if (line.type === "deletion" && line.oldLineNumber !== null) {
        return {
          reviewDisplayId: run.reviewDisplayId,
          revisionId: run.context.revision.id,
          filePath: file.path,
          oldFilePath: file.oldPath,
          side: "base",
          lineNumber: line.oldLineNumber,
          lineType: line.type,
          hunkId: null,
          hunkHeader: hunk.header,
          contextBefore: hunk.lines
            .slice(Math.max(0, index - 3), index)
            .map((candidate) => candidate.content),
          contextAfter: hunk.lines
            .slice(index + 1, index + 4)
            .map((candidate) => candidate.content),
          originalLineText: line.content,
        };
      }
    }
  }

  return null;
}
