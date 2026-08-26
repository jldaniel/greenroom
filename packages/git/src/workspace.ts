import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { GitCommandError, runGit } from "./command";

export const gitWorkspaceMarkerFileName = ".greenroom-workspace.json";
export const gitArchiveWorkspaceRepoDirName = "repo";

export type GitWorkspaceStrategy = "git_archive" | "git_worktree";
export type GitWorkspaceErrorCode =
  | "invalid_input"
  | "commit_missing"
  | "workspace_exists"
  | "archive_failed"
  | "extract_failed"
  | "marker_invalid";

export interface GitWorkspaceMarker {
  schemaVersion: 1;
  strategy: GitWorkspaceStrategy;
  runId: string;
  jobId: string;
  sourceRepositoryPath: string;
  revisionId: string;
  baseSha: string;
  headSha: string;
  workspaceRoot: string;
  repoPath: string;
  createdAt: string;
}

export interface CreateGitArchiveWorkspaceInput {
  workspaceParentDir: string;
  sourceRepositoryPath: string;
  runId: string;
  jobId: string;
  revisionId: string;
  baseSha: string;
  headSha: string;
  now?: () => string;
  gitTimeoutMs?: number;
}

export interface GitArchiveWorkspace {
  workspaceRoot: string;
  repoPath: string;
  markerPath: string;
  marker: GitWorkspaceMarker;
}

export interface GitWorkspaceCleanupResult {
  workspaceRoot: string;
  removed: boolean;
  errorMessage: string | null;
}

export interface ReapStaleGitWorkspacesInput {
  workspaceParentDir: string;
  staleGraceMs: number;
  nowMs?: () => number;
}

export interface ReapStaleGitWorkspacesResult {
  scanned: number;
  removed: string[];
  skipped: string[];
  failures: Array<{ workspaceRoot: string; errorMessage: string }>;
}

export class GitWorkspaceError extends Error {
  readonly code: GitWorkspaceErrorCode;

  constructor(code: GitWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "GitWorkspaceError";
    this.code = code;
  }
}

export async function createGitArchiveWorkspace(
  input: CreateGitArchiveWorkspaceInput,
): Promise<GitArchiveWorkspace> {
  validateCreateGitArchiveWorkspaceInput(input);
  await verifyCommitExists(input);

  const workspaceRoot = join(
    input.workspaceParentDir,
    `greenroom-${safePathSegment(input.jobId)}-${safePathSegment(input.runId)}`,
  );
  const repoPath = join(workspaceRoot, gitArchiveWorkspaceRepoDirName);
  const markerPath = join(workspaceRoot, gitWorkspaceMarkerFileName);
  const archivePath = join(workspaceRoot, "archive.tar");
  const marker: GitWorkspaceMarker = {
    schemaVersion: 1,
    strategy: "git_archive",
    runId: input.runId,
    jobId: input.jobId,
    sourceRepositoryPath: input.sourceRepositoryPath,
    revisionId: input.revisionId,
    baseSha: input.baseSha,
    headSha: input.headSha,
    workspaceRoot,
    repoPath,
    createdAt: input.now?.() ?? new Date().toISOString(),
  };

  try {
    await mkdir(input.workspaceParentDir, { recursive: true });
    await mkdir(workspaceRoot);
    await mkdir(repoPath);
  } catch (error) {
    throw new GitWorkspaceError(
      "workspace_exists",
      `Workspace ${workspaceRoot} could not be created: ${errorMessage(error)}`,
    );
  }

  try {
    await runGit({
      repositoryPath: input.sourceRepositoryPath,
      args: ["archive", "--format=tar", "--output", archivePath, input.headSha],
      timeoutMs: input.gitTimeoutMs,
    });
  } catch (error) {
    await removePartialWorkspace(workspaceRoot);
    throw new GitWorkspaceError(
      "archive_failed",
      `Failed to archive commit ${input.headSha}: ${errorMessage(error)}`,
    );
  }

  try {
    await runProcess(["tar", "-xf", archivePath, "-C", repoPath], "extract archive");
    await rm(archivePath, { force: true });
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  } catch (error) {
    await removePartialWorkspace(workspaceRoot);
    throw new GitWorkspaceError(
      "extract_failed",
      `Failed to prepare archive workspace ${workspaceRoot}: ${errorMessage(error)}`,
    );
  }

  return { workspaceRoot, repoPath, markerPath, marker };
}

export async function cleanupGitWorkspace(
  workspace: string | Pick<GitArchiveWorkspace, "workspaceRoot">,
): Promise<GitWorkspaceCleanupResult> {
  const workspaceRoot = typeof workspace === "string" ? workspace : workspace.workspaceRoot;

  try {
    await rm(workspaceRoot, { force: true, recursive: true });
    return { workspaceRoot, removed: true, errorMessage: null };
  } catch (error) {
    return { workspaceRoot, removed: false, errorMessage: errorMessage(error) };
  }
}

export async function readGitWorkspaceMarker(
  workspaceRoot: string,
): Promise<GitWorkspaceMarker | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(workspaceRoot, gitWorkspaceMarkerFileName), "utf8"),
    ) as unknown;
    return parseGitWorkspaceMarker(parsed);
  } catch {
    return null;
  }
}

export async function reapStaleGitWorkspaces(
  input: ReapStaleGitWorkspacesInput,
): Promise<ReapStaleGitWorkspacesResult> {
  if (!isAbsolute(input.workspaceParentDir)) {
    throw new GitWorkspaceError("invalid_input", "Workspace parent directory must be absolute");
  }

  if (!Number.isInteger(input.staleGraceMs) || input.staleGraceMs < 0) {
    throw new GitWorkspaceError("invalid_input", "Workspace stale grace must be non-negative");
  }

  const nowMs = input.nowMs?.() ?? Date.now();
  const result: ReapStaleGitWorkspacesResult = {
    scanned: 0,
    removed: [],
    skipped: [],
    failures: [],
  };

  let entries: Dirent<string>[];

  try {
    entries = await readdir(input.workspaceParentDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspaceRoot = join(input.workspaceParentDir, entry.name);
    const marker = await readGitWorkspaceMarker(workspaceRoot);

    if (marker === null) {
      continue;
    }

    result.scanned += 1;
    const createdAtMs = Date.parse(marker.createdAt);

    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs < input.staleGraceMs) {
      result.skipped.push(workspaceRoot);
      continue;
    }

    if (marker.strategy !== "git_archive") {
      result.skipped.push(workspaceRoot);
      continue;
    }

    const cleanup = await cleanupGitWorkspace(workspaceRoot);

    if (cleanup.removed) {
      result.removed.push(workspaceRoot);
    } else {
      result.failures.push({
        workspaceRoot,
        errorMessage: cleanup.errorMessage ?? "Workspace cleanup failed",
      });
    }
  }

  return result;
}

async function verifyCommitExists(input: CreateGitArchiveWorkspaceInput): Promise<void> {
  try {
    await runGit({
      repositoryPath: input.sourceRepositoryPath,
      args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${input.headSha}^{commit}`],
      timeoutMs: input.gitTimeoutMs,
    });
  } catch (error) {
    if (error instanceof GitCommandError && error.code === "command_failed") {
      throw new GitWorkspaceError(
        "commit_missing",
        `Commit ${input.headSha} is not available in ${input.sourceRepositoryPath}`,
      );
    }

    throw error;
  }
}

function validateCreateGitArchiveWorkspaceInput(input: CreateGitArchiveWorkspaceInput): void {
  if (!isAbsolute(input.workspaceParentDir)) {
    throw new GitWorkspaceError("invalid_input", "Workspace parent directory must be absolute");
  }

  if (!isAbsolute(input.sourceRepositoryPath)) {
    throw new GitWorkspaceError("invalid_input", "Source repository path must be absolute");
  }
}

async function removePartialWorkspace(workspaceRoot: string): Promise<void> {
  await rm(workspaceRoot, { force: true, recursive: true }).catch(() => undefined);
}

async function runProcess(command: readonly string[], label: string): Promise<void> {
  const process = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`${label} failed with status ${exitCode}: ${stderr.trim()}`);
  }
}

function parseGitWorkspaceMarker(value: unknown): GitWorkspaceMarker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    record.schemaVersion !== 1 ||
    (record.strategy !== "git_archive" && record.strategy !== "git_worktree")
  ) {
    return null;
  }

  const marker = {
    schemaVersion: record.schemaVersion,
    strategy: record.strategy,
    runId: stringRecordValue(record, "runId"),
    jobId: stringRecordValue(record, "jobId"),
    sourceRepositoryPath: stringRecordValue(record, "sourceRepositoryPath"),
    revisionId: stringRecordValue(record, "revisionId"),
    baseSha: stringRecordValue(record, "baseSha"),
    headSha: stringRecordValue(record, "headSha"),
    workspaceRoot: stringRecordValue(record, "workspaceRoot"),
    repoPath: stringRecordValue(record, "repoPath"),
    createdAt: stringRecordValue(record, "createdAt"),
  };

  return Object.values(marker).some((entry) => entry === null)
    ? null
    : (marker as GitWorkspaceMarker);
}

function stringRecordValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safePathSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 120) || "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
