import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { GitCommandError, runGit } from "./command";

export type GitRepositoryErrorCode = "path_not_found" | "not_absolute_path" | "not_git_worktree";

export interface GitRepositoryIdentity {
  inputPath: string;
  rootPath: string;
  gitCommonDir: string;
  identityKey: string;
}

export class GitRepositoryError extends Error {
  readonly code: GitRepositoryErrorCode;
  readonly path: string;

  constructor(code: GitRepositoryErrorCode, path: string, message: string) {
    super(message);
    this.name = "GitRepositoryError";
    this.code = code;
    this.path = path;
  }
}

export async function detectRepository(
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<GitRepositoryIdentity> {
  if (!isAbsolute(path)) {
    throw new GitRepositoryError(
      "not_absolute_path",
      path,
      "Repository detection requires an absolute path",
    );
  }

  if (!existsSync(path)) {
    throw new GitRepositoryError("path_not_found", path, "Repository path does not exist");
  }

  const inputPath = realpathSync.native(path);

  try {
    const insideWorkTree = (
      await runGit({
        repositoryPath: inputPath,
        args: ["rev-parse", "--is-inside-work-tree"],
        timeoutMs: options.timeoutMs,
      })
    ).stdout.trim();

    if (insideWorkTree !== "true") {
      throw new GitRepositoryError("not_git_worktree", inputPath, "Path is not a Git worktree");
    }

    const rootPath = realpathSync.native(
      (
        await runGit({
          repositoryPath: inputPath,
          args: ["rev-parse", "--show-toplevel"],
          timeoutMs: options.timeoutMs,
        })
      ).stdout.trim(),
    );
    const gitCommonDir = realpathIfExists(
      await readGitCommonDir(rootPath, options.timeoutMs),
      rootPath,
    );

    return {
      inputPath,
      rootPath,
      gitCommonDir,
      identityKey: gitCommonDir,
    };
  } catch (error) {
    if (error instanceof GitRepositoryError) {
      throw error;
    }

    if (error instanceof GitCommandError) {
      throw new GitRepositoryError("not_git_worktree", inputPath, error.message);
    }

    throw error;
  }
}

async function readGitCommonDir(rootPath: string, timeoutMs: number | undefined): Promise<string> {
  try {
    return (
      await runGit({
        repositoryPath: rootPath,
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        timeoutMs,
      })
    ).stdout.trim();
  } catch (error) {
    if (!(error instanceof GitCommandError)) {
      throw error;
    }

    const value = (
      await runGit({
        repositoryPath: rootPath,
        args: ["rev-parse", "--git-common-dir"],
        timeoutMs,
      })
    ).stdout.trim();

    return isAbsolute(value) ? value : resolve(rootPath, value);
  }
}

function realpathIfExists(path: string, rootPath: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(rootPath, path);
  return existsSync(absolutePath) ? realpathSync.native(absolutePath) : absolutePath;
}
