import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { runGit, type GitCommandResult } from "../command";
import { lookupCommit, type GitCommit } from "../refs";

export interface TestGitRepository {
  directory: string;
  run: (args: readonly string[]) => Promise<GitCommandResult>;
  writeFile: (relativePath: string, content: string | Uint8Array) => void;
  appendFile: (relativePath: string, content: string) => void;
  removePath: (relativePath: string) => void;
  chmod: (relativePath: string, mode: number) => void;
  stage: (paths?: readonly string[]) => Promise<void>;
  commit: (message: string) => Promise<GitCommit>;
  branch: (name: string, startPoint?: string) => Promise<void>;
  checkout: (ref: string, options?: { create?: boolean }) => Promise<void>;
  tag: (name: string, ref?: string) => Promise<void>;
  move: (oldPath: string, newPath: string) => Promise<void>;
  cleanup: () => void;
}

export async function createTempGitRepository(): Promise<TestGitRepository> {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "greenroom-git-")));

  const run = (args: readonly string[]) => runGit({ repositoryPath: directory, args });

  await run(["init", "--initial-branch=main"]);
  await run(["config", "user.name", "Greenroom Test"]);
  await run(["config", "user.email", "greenroom@example.test"]);
  await run(["config", "core.autocrlf", "false"]);
  await run(["config", "commit.gpgsign", "false"]);

  const repository: TestGitRepository = {
    directory,
    run,
    writeFile(relativePath, content) {
      const path = join(directory, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    appendFile(relativePath, content) {
      const path = join(directory, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, content);
    },
    removePath(relativePath) {
      rmSync(join(directory, relativePath), { recursive: true, force: true });
    },
    chmod(relativePath, mode) {
      chmodSync(join(directory, relativePath), mode);
    },
    async stage(paths = ["."]) {
      await run(["add", "--all", ...paths]);
    },
    async commit(message) {
      await run(["commit", "--message", message]);
      return lookupCommit(directory, "HEAD");
    },
    async branch(name, startPoint) {
      await run(startPoint === undefined ? ["branch", name] : ["branch", name, startPoint]);
    },
    async checkout(ref, options = {}) {
      await run(options.create === true ? ["checkout", "-b", ref] : ["checkout", ref]);
    },
    async tag(name, ref) {
      await run(ref === undefined ? ["tag", name] : ["tag", name, ref]);
    },
    async move(oldPath, newPath) {
      await run(["mv", oldPath, newPath]);
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };

  return repository;
}
