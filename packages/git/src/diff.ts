import { createHash } from "node:crypto";

import {
  diffFileStatusSchema,
  diffSummarySchema,
  worktreeFingerprintSchema,
  type DiffFile,
  type DiffFileStatus,
  type DiffHunk,
  type DiffLine,
  type DiffSummary,
  type WorktreeFingerprint,
} from "@greenroom/schemas";

import { runGit } from "./command";
import { resolveGitRef } from "./refs";

export const emptyTreeSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type StructuredDiffHunk = Omit<DiffHunk, "id" | "fileId">;

export type StructuredDiffFile = Omit<DiffFile, "id" | "revisionId" | "hunks"> & {
  hunks: StructuredDiffHunk[];
};

interface MutableDiffFile {
  path: string;
  oldPath: string | null;
  status: DiffFileStatus;
  isBinary: boolean;
  additions: number;
  deletions: number;
  oldMode: string | null;
  newMode: string | null;
  renameSimilarity: number | null;
  hunks: StructuredDiffHunk[];
}

interface MutableHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
  sortOrder: number;
  nextOldLine: number;
  nextNewLine: number;
}

export async function generateCommittedDiff(
  repositoryPath: string,
  input: { baseRef: string; headRef: string; timeoutMs?: number },
): Promise<string> {
  const base = await resolveGitRef(repositoryPath, input.baseRef, input);
  const head = await resolveGitRef(repositoryPath, input.headRef, input);
  const result = await runGit({
    repositoryPath,
    args: [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      base.sha,
      head.sha,
      "--",
    ],
    timeoutMs: input.timeoutMs,
  });

  return result.stdout;
}

export async function generateEmptyTreeDiff(
  repositoryPath: string,
  input: { headRef: string; timeoutMs?: number },
): Promise<string> {
  const head = await resolveGitRef(repositoryPath, input.headRef, input);
  const result = await runGit({
    repositoryPath,
    args: [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      emptyTreeSha,
      head.sha,
      "--",
    ],
    timeoutMs: input.timeoutMs,
  });

  return result.stdout;
}

export async function generateStagedDiff(
  repositoryPath: string,
  input: { timeoutMs?: number } = {},
): Promise<string> {
  const result = await runGit({
    repositoryPath,
    args: [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--cached",
      "HEAD",
      "--",
    ],
    timeoutMs: input.timeoutMs,
  });

  return result.stdout;
}

export async function generateStructuredStagedDiff(
  repositoryPath: string,
  input: { timeoutMs?: number } = {},
): Promise<StructuredDiffFile[]> {
  return parseRawDiff(await generateStagedDiff(repositoryPath, input));
}

export async function generateUnstagedDiff(
  repositoryPath: string,
  input: { timeoutMs?: number } = {},
): Promise<string> {
  const result = await runGit({
    repositoryPath,
    args: [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--",
    ],
    timeoutMs: input.timeoutMs,
  });

  return result.stdout;
}

export async function generateStructuredUnstagedDiff(
  repositoryPath: string,
  input: { timeoutMs?: number } = {},
): Promise<StructuredDiffFile[]> {
  return parseRawDiff(await generateUnstagedDiff(repositoryPath, input));
}

export async function generateWorktreeDiff(
  repositoryPath: string,
  input: { baseRef: string; timeoutMs?: number },
): Promise<string> {
  const base = await resolveGitRef(repositoryPath, input.baseRef, input);
  const result = await runGit({
    repositoryPath,
    args: [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--find-copies",
      "--patch",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      base.sha,
      "--",
    ],
    timeoutMs: input.timeoutMs,
  });

  return result.stdout;
}

export async function generateStructuredWorktreeDiff(
  repositoryPath: string,
  input: { baseRef: string; timeoutMs?: number },
): Promise<StructuredDiffFile[]> {
  return parseRawDiff(await generateWorktreeDiff(repositoryPath, input));
}

export async function getWorktreeFingerprint(
  repositoryPath: string,
  input: { timeoutMs?: number } = {},
): Promise<WorktreeFingerprint> {
  const [head, stagedDiff, unstagedDiff] = await Promise.all([
    resolveGitRef(repositoryPath, "HEAD", input),
    generateStagedDiff(repositoryPath, input),
    generateUnstagedDiff(repositoryPath, input),
  ]);

  return worktreeFingerprintSchema.parse({
    headSha: head.sha,
    stagedDiffHash: hashDiff(stagedDiff),
    unstagedDiffHash: hashDiff(unstagedDiff),
  });
}

export async function generateStructuredCommittedDiff(
  repositoryPath: string,
  input: { baseRef: string; headRef: string; timeoutMs?: number },
): Promise<StructuredDiffFile[]> {
  return parseRawDiff(await generateCommittedDiff(repositoryPath, input));
}

export async function generateStructuredEmptyTreeDiff(
  repositoryPath: string,
  input: { headRef: string; timeoutMs?: number },
): Promise<StructuredDiffFile[]> {
  return parseRawDiff(await generateEmptyTreeDiff(repositoryPath, input));
}

export function parseRawDiff(rawPatch: string): StructuredDiffFile[] {
  const files: StructuredDiffFile[] = [];
  const lines = splitPatchLines(rawPatch);
  let currentFile: MutableDiffFile | null = null;
  let currentHunk: MutableHunk | null = null;
  let hunkSortOrder = 1;

  const finishHunk = () => {
    if (currentFile !== null && currentHunk !== null) {
      currentFile.hunks.push({
        oldStart: currentHunk.oldStart,
        oldLines: currentHunk.oldLines,
        newStart: currentHunk.newStart,
        newLines: currentHunk.newLines,
        header: currentHunk.header,
        lines: currentHunk.lines,
        sortOrder: currentHunk.sortOrder,
      });
      currentHunk = null;
    }
  };

  const finishFile = () => {
    finishHunk();

    if (currentFile !== null) {
      files.push(finalizeFile(currentFile));
      currentFile = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finishFile();
      currentFile = createMutableFile(line);
      hunkSortOrder = 1;
      continue;
    }

    if (currentFile === null) {
      continue;
    }

    if (line.startsWith("@@ ")) {
      finishHunk();
      currentHunk = parseHunkHeader(line, hunkSortOrder);
      hunkSortOrder += 1;
      continue;
    }

    if (currentHunk !== null) {
      parseHunkLine(currentFile, currentHunk, line);
      continue;
    }

    parseFileMetadata(currentFile, line);
  }

  finishFile();
  return files;
}

export function summarizeDiffFiles(files: readonly StructuredDiffFile[]): DiffSummary {
  return diffSummarySchema.parse({
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    binaryFileCount: files.filter((file) => file.isBinary).length,
    renameCount: files.filter((file) => file.status === "renamed").length,
  });
}

function createMutableFile(diffGitLine: string): MutableDiffFile {
  const paths = parseDiffGitPaths(diffGitLine);
  const path = paths.newPath ?? paths.oldPath ?? "unknown";

  return {
    path,
    oldPath: null,
    status: "modified",
    isBinary: false,
    additions: 0,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameSimilarity: null,
    hunks: [],
  };
}

function parseFileMetadata(file: MutableDiffFile, line: string): void {
  if (line.startsWith("new file mode ")) {
    file.status = "added";
    file.newMode = line.slice("new file mode ".length).trim();
    return;
  }

  if (line.startsWith("deleted file mode ")) {
    file.status = "deleted";
    file.oldMode = line.slice("deleted file mode ".length).trim();
    return;
  }

  if (line.startsWith("old mode ")) {
    file.oldMode = line.slice("old mode ".length).trim();
    return;
  }

  if (line.startsWith("new mode ")) {
    file.newMode = line.slice("new mode ".length).trim();
    return;
  }

  if (line.startsWith("similarity index ")) {
    file.renameSimilarity = parseSimilarity(line);
    return;
  }

  if (line.startsWith("rename from ")) {
    file.status = "renamed";
    file.oldPath = parseGitPathValue(line.slice("rename from ".length));
    return;
  }

  if (line.startsWith("rename to ")) {
    file.status = "renamed";
    file.path = parseGitPathValue(line.slice("rename to ".length));
    return;
  }

  if (line.startsWith("copy from ")) {
    file.status = "copied";
    file.oldPath = parseGitPathValue(line.slice("copy from ".length));
    return;
  }

  if (line.startsWith("copy to ")) {
    file.status = "copied";
    file.path = parseGitPathValue(line.slice("copy to ".length));
    return;
  }

  if (line.startsWith("index ")) {
    parseIndexMode(file, line);
    return;
  }

  if (line.startsWith("--- ")) {
    const oldPath = parseMarkerPath(line.slice("--- ".length));

    if (oldPath !== null && file.status !== "renamed" && file.status !== "copied") {
      file.path = oldPath;
    }

    return;
  }

  if (line.startsWith("+++ ")) {
    const newPath = parseMarkerPath(line.slice("+++ ".length));

    if (newPath === null) {
      file.status = "deleted";
    } else {
      file.path = newPath;
    }

    return;
  }

  if (
    line.startsWith("Binary files ") ||
    line.startsWith("Binary file ") ||
    line === "GIT binary patch"
  ) {
    file.isBinary = true;
  }
}

function parseHunkHeader(header: string, sortOrder: number): MutableHunk {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/u.exec(header);

  if (match === null) {
    throw new Error(`Unable to parse Git hunk header: ${header}`);
  }

  const oldStart = Number.parseInt(requiredMatch(match, 1), 10);
  const oldLines = Number.parseInt(match[2] ?? "1", 10);
  const newStart = Number.parseInt(requiredMatch(match, 3), 10);
  const newLines = Number.parseInt(match[4] ?? "1", 10);

  return {
    oldStart,
    oldLines,
    newStart,
    newLines,
    header,
    lines: [],
    sortOrder,
    nextOldLine: oldStart,
    nextNewLine: newStart,
  };
}

function parseHunkLine(file: MutableDiffFile, hunk: MutableHunk, line: string): void {
  if (line.startsWith(" ")) {
    hunk.lines.push({
      type: "context",
      oldLineNumber: hunk.nextOldLine,
      newLineNumber: hunk.nextNewLine,
      content: line.slice(1),
    });
    hunk.nextOldLine += 1;
    hunk.nextNewLine += 1;
    return;
  }

  if (line.startsWith("+")) {
    hunk.lines.push({
      type: "addition",
      oldLineNumber: null,
      newLineNumber: hunk.nextNewLine,
      content: line.slice(1),
    });
    hunk.nextNewLine += 1;
    file.additions += 1;
    return;
  }

  if (line.startsWith("-")) {
    hunk.lines.push({
      type: "deletion",
      oldLineNumber: hunk.nextOldLine,
      newLineNumber: null,
      content: line.slice(1),
    });
    hunk.nextOldLine += 1;
    file.deletions += 1;
    return;
  }

  if (line.startsWith("\\")) {
    hunk.lines.push({
      type: "no_newline",
      oldLineNumber: null,
      newLineNumber: null,
      content: line.slice(1).trim(),
    });
  }
}

function finalizeFile(file: MutableDiffFile): StructuredDiffFile {
  const status = finalizeStatus(file);
  const oldPath = status === "renamed" || status === "copied" ? file.oldPath : null;
  const renameMetadata =
    oldPath === null
      ? null
      : {
          oldPath,
          newPath: file.path,
          similarity: file.renameSimilarity,
        };

  return {
    path: file.path,
    oldPath,
    status,
    isBinary: file.isBinary,
    additions: file.additions,
    deletions: file.deletions,
    oldMode: file.oldMode,
    newMode: file.newMode,
    renameMetadata,
    hunks: file.hunks,
  };
}

function finalizeStatus(file: MutableDiffFile): DiffFileStatus {
  if (
    file.status === "modified" &&
    file.oldMode !== null &&
    file.newMode !== null &&
    file.oldMode !== file.newMode &&
    file.hunks.length === 0
  ) {
    return "mode_changed";
  }

  if (file.status === "modified" && file.isBinary) {
    return "binary";
  }

  return diffFileStatusSchema.parse(file.status);
}

function splitPatchLines(rawPatch: string): string[] {
  if (rawPatch.length === 0) {
    return [];
  }

  const lines = rawPatch.replace(/\r\n/gu, "\n").split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function parseDiffGitPaths(line: string): { oldPath: string | null; newPath: string | null } {
  const tokens = tokenizeGitLine(line.slice("diff --git ".length));
  const oldToken = tokens[0];
  const newToken = tokens[1];

  return {
    oldPath: oldToken === undefined ? null : stripGitPathPrefix(oldToken),
    newPath: newToken === undefined ? null : stripGitPathPrefix(newToken),
  };
}

function tokenizeGitLine(value: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < value.length) {
    while (value[index] === " ") {
      index += 1;
    }

    if (index >= value.length) {
      break;
    }

    if (value[index] === '"') {
      const start = index;
      index += 1;

      while (index < value.length) {
        if (value[index] === "\\" && index + 1 < value.length) {
          index += 2;
          continue;
        }

        if (value[index] === '"') {
          index += 1;
          break;
        }

        index += 1;
      }

      tokens.push(unquoteGitToken(value.slice(start, index)));
      continue;
    }

    const start = index;

    while (index < value.length && value[index] !== " ") {
      index += 1;
    }

    tokens.push(value.slice(start, index));
  }

  return tokens;
}

function parseMarkerPath(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === "/dev/null") {
    return null;
  }

  return stripGitPathPrefix(parseGitPathValue(trimmed));
}

function parseGitPathValue(value: string): string {
  return unquoteGitToken(value.trim());
}

function stripGitPathPrefix(value: string): string {
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }

  return value;
}

function unquoteGitToken(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

function parseSimilarity(line: string): number | null {
  const match = /^similarity index (\d+)%$/u.exec(line);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

function parseIndexMode(file: MutableDiffFile, line: string): void {
  const mode = line.trim().split(" ").at(-1);

  if (
    mode !== undefined &&
    /^\d{6}$/u.test(mode) &&
    file.oldMode === null &&
    file.newMode === null
  ) {
    file.oldMode = mode;
    file.newMode = mode;
  }
}

function requiredMatch(match: RegExpExecArray, index: number): string {
  const value = match[index];

  if (value === undefined) {
    throw new Error("Required regex capture is missing");
  }

  return value;
}

function hashDiff(rawPatch: string): string | null {
  if (rawPatch.length === 0) {
    return null;
  }

  return `sha256:${createHash("sha256").update(rawPatch).digest("hex")}`;
}
