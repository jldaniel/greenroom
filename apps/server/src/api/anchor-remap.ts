import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  ReviewDisplayId,
  RevisionId,
  ThreadAnchor,
} from "@greenroom/schemas";

const defaultAnchorRemapThreshold = 0.72;

export interface AnchorSetRemapInput {
  primaryAnchor: ThreadAnchor;
  anchors: readonly ThreadAnchor[];
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
  files: readonly DiffFile[];
  confidenceThreshold?: number;
}

export interface AnchorSetRemapResult {
  primaryAnchor: ThreadAnchor;
  anchors: ThreadAnchor[];
  confidence: number | null;
  stale: boolean;
}

export function remapAnchorSet(input: AnchorSetRemapInput): AnchorSetRemapResult {
  const remappedAnchors: ThreadAnchor[] = [];
  const anchors = input.anchors.length === 0 ? [input.primaryAnchor] : Array.from(input.anchors);
  const threshold = input.confidenceThreshold ?? defaultAnchorRemapThreshold;
  let lowestConfidence = 1;

  for (const anchor of anchors) {
    const best = findBestAnchorCandidate(
      anchor,
      input.reviewDisplayId,
      input.revisionId,
      input.files,
    );

    if (best === null || best.confidence < threshold) {
      return {
        primaryAnchor: input.primaryAnchor,
        anchors,
        confidence: best?.confidence ?? 0,
        stale: true,
      };
    }

    remappedAnchors.push(best.anchor);
    lowestConfidence = Math.min(lowestConfidence, best.confidence);
  }

  const primaryIndex = anchors.findIndex(
    (anchor) => anchorLocationKey(anchor) === anchorLocationKey(input.primaryAnchor),
  );

  return {
    primaryAnchor:
      remappedAnchors[primaryIndex < 0 ? 0 : primaryIndex] ??
      remappedAnchors[0] ??
      input.primaryAnchor,
    anchors: remappedAnchors,
    confidence: Number(lowestConfidence.toFixed(3)),
    stale: false,
  };
}

function findBestAnchorCandidate(
  anchor: ThreadAnchor,
  reviewDisplayId: ReviewDisplayId,
  revisionId: RevisionId,
  files: readonly DiffFile[],
): { anchor: ThreadAnchor; confidence: number } | null {
  let best: { anchor: ThreadAnchor; confidence: number } | null = null;

  for (const file of files) {
    const fileScore = scoreFilePath(file, anchor);

    if (fileScore === null) {
      continue;
    }

    for (const hunk of file.hunks) {
      for (const [lineIndex, line] of hunk.lines.entries()) {
        if (line.type !== anchor.lineType) {
          continue;
        }

        const lineNumber = lineNumberForAnchorSide(line, anchor.side);

        if (lineNumber === null) {
          continue;
        }

        const confidence =
          fileScore +
          scoreLineText(anchor.originalLineText, line.content) +
          scoreNearbyContext(anchor, hunk.lines, lineIndex) +
          scoreLineDistance(anchor.lineNumber, lineNumber);

        if (best === null || confidence > best.confidence) {
          best = {
            anchor: buildRemappedAnchor({
              anchor,
              file,
              hunk,
              line,
              lineIndex,
              lineNumber,
              reviewDisplayId,
              revisionId,
            }),
            confidence: Math.min(1, Number(confidence.toFixed(3))),
          };
        }
      }
    }
  }

  return best;
}

function scoreFilePath(file: DiffFile, anchor: ThreadAnchor): number | null {
  if (file.path === anchor.filePath && (file.oldPath ?? null) === anchor.oldFilePath) {
    return 0.4;
  }

  if (file.path === anchor.filePath) {
    return 0.38;
  }

  if (file.oldPath === anchor.filePath || file.renameMetadata?.oldPath === anchor.filePath) {
    return 0.35;
  }

  if (
    anchor.oldFilePath !== null &&
    (file.path === anchor.oldFilePath ||
      file.oldPath === anchor.oldFilePath ||
      file.renameMetadata?.oldPath === anchor.oldFilePath)
  ) {
    return 0.32;
  }

  return null;
}

export function lineNumberForAnchorSide(line: DiffLine, side: ThreadAnchor["side"]): number | null {
  return side === "head" ? line.newLineNumber : line.oldLineNumber;
}

function anchorLocationKey(anchor: ThreadAnchor): string {
  return [
    anchor.reviewDisplayId,
    anchor.revisionId,
    anchor.filePath,
    anchor.oldFilePath ?? "",
    anchor.side,
    anchor.lineType,
    anchor.lineNumber,
    anchor.hunkId ?? "",
  ].join(":");
}

function scoreLineText(originalLineText: string | null, candidate: string): number {
  if (originalLineText === null) {
    return 0.14;
  }

  if (originalLineText === candidate) {
    return 0.35;
  }

  if (normalizeText(originalLineText) === normalizeText(candidate)) {
    return 0.32;
  }

  return 0.35 * textSimilarity(originalLineText, candidate);
}

function scoreNearbyContext(
  anchor: ThreadAnchor,
  lines: readonly DiffLine[],
  lineIndex: number,
): number {
  const before = nearbyContext(lines, lineIndex, "before");
  const after = nearbyContext(lines, lineIndex, "after");
  const beforeScore = contextSimilarity(anchor.contextBefore, before);
  const afterScore = contextSimilarity(anchor.contextAfter, after);

  return 0.15 * ((beforeScore + afterScore) / 2);
}

function scoreLineDistance(originalLineNumber: number, candidateLineNumber: number): number {
  const distance = Math.abs(originalLineNumber - candidateLineNumber);

  if (distance === 0) {
    return 0.1;
  }

  if (distance <= 3) {
    return 0.08;
  }

  if (distance <= 10) {
    return 0.05;
  }

  return 0.02;
}

function buildRemappedAnchor(input: {
  anchor: ThreadAnchor;
  file: DiffFile;
  hunk: DiffHunk;
  line: DiffLine;
  lineIndex: number;
  lineNumber: number;
  reviewDisplayId: ReviewDisplayId;
  revisionId: RevisionId;
}): ThreadAnchor {
  return {
    reviewDisplayId: input.reviewDisplayId,
    revisionId: input.revisionId,
    filePath: input.file.path,
    oldFilePath: input.file.oldPath,
    side: input.anchor.side,
    lineNumber: input.lineNumber,
    lineType: input.line.type,
    hunkId: input.hunk.id,
    hunkHeader: input.hunk.header,
    contextBefore: nearbyContext(input.hunk.lines, input.lineIndex, "before"),
    contextAfter: nearbyContext(input.hunk.lines, input.lineIndex, "after"),
    originalLineText: input.line.content,
  };
}

function nearbyContext(
  lines: readonly DiffLine[],
  lineIndex: number,
  direction: "after" | "before",
): string[] {
  const windowSize = 3;

  if (direction === "before") {
    return lines
      .slice(Math.max(0, lineIndex - windowSize), lineIndex)
      .map((candidate) => candidate.content);
  }

  return lines
    .slice(lineIndex + 1, lineIndex + 1 + windowSize)
    .map((candidate) => candidate.content);
}

function contextSimilarity(original: readonly string[], candidate: readonly string[]): number {
  if (original.length === 0 && candidate.length === 0) {
    return 1;
  }

  if (original.length === 0 || candidate.length === 0) {
    return 0.25;
  }

  const scores = original.map((line) =>
    Math.max(...candidate.map((candidateLine) => textSimilarity(line, candidateLine))),
  );

  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (normalizedLeft.length === 0 && normalizedRight.length === 0) {
    return 1;
  }

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftBigrams = bigrams(normalizedLeft);
  const rightBigrams = bigrams(normalizedRight);
  const rightCounts = new Map<string, number>();

  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;

  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;

    if (count > 0) {
      overlap += 1;
      rightCounts.set(bigram, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(value: string): string[] {
  if (value.length < 2) {
    return [value];
  }

  const result: string[] = [];

  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }

  return result;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
