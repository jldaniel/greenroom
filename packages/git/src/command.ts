import { isAbsolute } from "node:path";

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;

export type GitCommandErrorCode = "invalid_command" | "timeout" | "command_failed";

export interface GitCommandResult {
  command: string[];
  repositoryPath: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunGitOptions {
  repositoryPath: string;
  args: readonly string[];
  timeoutMs?: number | undefined;
  expectedExitCodes?: readonly number[] | undefined;
}

export interface GitCommandErrorDetails {
  code: GitCommandErrorCode;
  message: string;
  command: string[];
  repositoryPath: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class GitCommandError extends Error {
  readonly code: GitCommandErrorCode;
  readonly command: string[];
  readonly repositoryPath: string;
  readonly args: string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;

  constructor(details: GitCommandErrorDetails) {
    super(details.message);
    this.name = "GitCommandError";
    this.code = details.code;
    this.command = details.command;
    this.repositoryPath = details.repositoryPath;
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.durationMs = details.durationMs;
  }
}

export async function runGit(options: RunGitOptions): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const expectedExitCodes = options.expectedExitCodes ?? [0];
  const command = buildGitCommand(options.repositoryPath, options.args);
  const startedAt = performance.now();

  try {
    validateGitInvocation(options.repositoryPath, options.args, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Git command";
    throw new GitCommandError({
      code: "invalid_command",
      message,
      command,
      repositoryPath: options.repositoryPath,
      args: [...options.args],
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: performance.now() - startedAt,
    });
  }

  const process = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(process.stdout).text();
  const stderrPromise = new Response(process.stderr).text();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill("SIGTERM");
  }, timeoutMs);

  const exitCode = await process.exited;
  clearTimeout(timeout);

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  const durationMs = performance.now() - startedAt;
  const result: GitCommandResult = {
    command,
    repositoryPath: options.repositoryPath,
    args: [...options.args],
    exitCode,
    stdout,
    stderr,
    durationMs,
  };

  if (timedOut) {
    throw new GitCommandError({
      code: "timeout",
      message: `Git command timed out after ${timeoutMs}ms`,
      ...result,
    });
  }

  if (!expectedExitCodes.includes(exitCode)) {
    throw new GitCommandError({
      code: "command_failed",
      message: stderr.trim() || `Git command exited with code ${exitCode}`,
      ...result,
    });
  }

  return result;
}

export async function tryRunGit(options: RunGitOptions): Promise<GitCommandResult | null> {
  try {
    return await runGit(options);
  } catch (error) {
    if (error instanceof GitCommandError && error.code === "command_failed") {
      return null;
    }

    throw error;
  }
}

function buildGitCommand(repositoryPath: string, args: readonly string[]): string[] {
  return ["git", "-C", repositoryPath, ...args];
}

function validateGitInvocation(
  repositoryPath: string,
  args: readonly string[],
  timeoutMs: number,
): void {
  if (!isAbsolute(repositoryPath)) {
    throw new Error("Git repository paths must be absolute");
  }

  if (repositoryPath.includes("\0")) {
    throw new Error("Git repository paths cannot contain NUL bytes");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Git command timeouts must be positive integer milliseconds");
  }

  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new Error("Git command arguments cannot contain NUL bytes");
    }
  }
}
