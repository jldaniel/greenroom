import { afterEach, describe, expect, it } from "vitest";

import { GitCommandError, runGit } from "./command";
import {
  emptyTreeSha,
  generateCommittedDiff,
  generateStructuredEmptyTreeDiff,
  generateStructuredCommittedDiff,
  generateStructuredStagedDiff,
  generateStructuredUnstagedDiff,
  generateStructuredWorktreeDiff,
  getWorktreeFingerprint,
  parseRawDiff,
  summarizeDiffFiles,
} from "./diff";
import {
  constructDefaultReviewRange,
  constructDefaultWorktreeReviewRange,
  constructReviewRange,
  constructWholeRepositoryReviewRange,
  detectDefaultBranchCandidates,
  detectMergeBase,
} from "./ranges";
import {
  listBranches,
  listRefs,
  listTags,
  lookupCommit,
  resolveGitRef,
  searchCommits,
} from "./refs";
import { detectRepository } from "./repository";
import { createTempGitRepository, type TestGitRepository } from "./testing/repository";

const repositories: TestGitRepository[] = [];

async function createRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }
});

describe("Git command and repository helpers", () => {
  it("runs shell-free Git commands with explicit repository paths", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Fixture\n");
    await repository.stage();
    await repository.commit("Initial commit");

    const result = await runGit({
      repositoryPath: repository.directory,
      args: ["status", "--short"],
    });
    await expect(
      runGit({ repositoryPath: "relative/path", args: ["status"], timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "invalid_command" });

    expect(result.command).toEqual(["git", "-C", repository.directory, "status", "--short"]);
    expect(result.stdout).toBe("");
  });

  it("detects a Git worktree and stable common-dir identity", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Fixture\n");
    await repository.stage();
    await repository.commit("Initial commit");

    const identity = await detectRepository(repository.directory);

    expect(identity.rootPath).toBe(repository.directory);
    expect(identity.gitCommonDir.endsWith("/.git")).toBe(true);
    expect(identity.identityKey).toBe(identity.gitCommonDir);
  });

  it("surfaces structured command failures", async () => {
    const repository = await createRepository();

    await expect(
      runGit({ repositoryPath: repository.directory, args: ["not-a-real-command"] }),
    ).rejects.toBeInstanceOf(GitCommandError);
  });
});

describe("Git ref and commit helpers", () => {
  it("lists refs, resolves refs, and searches commits", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Fixture\n");
    await repository.stage();
    const initial = await repository.commit("Initial commit");
    await repository.checkout("feature/review", { create: true });
    repository.writeFile("feature.txt", "feature search target\n");
    await repository.stage();
    const feature = await repository.commit("Add feature search target");
    await repository.tag("v1-feature");

    const branches = await listBranches(repository.directory);
    const tags = await listTags(repository.directory);
    const refs = await listRefs(repository.directory);
    const branch = await resolveGitRef(repository.directory, "feature/review");
    const tag = await resolveGitRef(repository.directory, "v1-feature");
    const commit = await resolveGitRef(repository.directory, feature.shortSha);
    const lookedUp = await lookupCommit(repository.directory, "HEAD");
    const searchResults = await searchCommits(repository.directory, "feature search", { limit: 5 });

    expect(branches.map((ref) => ref.name)).toEqual(["feature/review", "main"]);
    expect(tags.map((ref) => ref.name)).toEqual(["v1-feature"]);
    expect(refs.map((ref) => ref.fullName)).toContain("refs/heads/main");
    expect(branch).toMatchObject({ kind: "branch", sha: feature.sha });
    expect(tag).toMatchObject({ kind: "tag", sha: feature.sha });
    expect(commit).toMatchObject({ kind: "commit", sha: feature.sha });
    expect(lookedUp.subject).toBe("Add feature search target");
    expect(searchResults.map((result) => result.sha)).toContain(feature.sha);
    expect(searchResults.map((result) => result.sha)).not.toContain(initial.sha);
  });
});

describe("Git base detection and review ranges", () => {
  it("detects default branch merge-bases and constructs normalized ranges", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Fixture\n");
    await repository.stage();
    const base = await repository.commit("Initial commit");
    await repository.checkout("feature/review", { create: true });
    repository.writeFile("feature.txt", "feature\n");
    await repository.stage();
    const head = await repository.commit("Add feature");

    const candidates = await detectDefaultBranchCandidates(repository.directory);
    const mergeBase = await detectMergeBase(repository.directory, { headRef: "feature/review" });
    const defaultRange = await constructDefaultReviewRange(repository.directory, {
      headRef: "feature/review",
    });
    const branchRange = await constructReviewRange(repository.directory, {
      baseRef: "main",
      headRef: "feature/review",
    });

    expect(candidates[0]).toMatchObject({
      ref: "main",
      reason: "local_default_name",
      sha: base.sha,
    });
    expect(mergeBase.mergeBaseSha).toBe(base.sha);
    expect(defaultRange).toMatchObject({
      baseSha: base.sha,
      headSha: head.sha,
      range: { kind: "default_branch" },
    });
    expect(branchRange).toMatchObject({
      baseSha: base.sha,
      headSha: head.sha,
      range: { kind: "branch_to_branch" },
    });
  });

  it("supports commit slices and explicit tag/ref ranges", async () => {
    const repository = await createRepository();
    repository.writeFile("slice.txt", "one\n");
    await repository.stage();
    const first = await repository.commit("First commit");
    await repository.tag("v-first", first.sha);
    repository.writeFile("slice.txt", "one\ntwo\n");
    await repository.stage();
    const second = await repository.commit("Second commit");

    const slice = await constructReviewRange(repository.directory, {
      baseRef: first.sha,
      headRef: second.sha,
    });
    const tagged = await constructReviewRange(repository.directory, {
      baseRef: "v-first",
      headRef: second.sha,
    });
    const rawDiff = await generateCommittedDiff(repository.directory, {
      baseRef: first.sha,
      headRef: second.sha,
    });

    expect(slice.range.kind).toBe("same_branch_slice");
    expect(tagged.range.kind).toBe("tag_or_ref");
    expect(rawDiff).toContain("+two");
  });

  it("constructs whole-repository ranges from the empty tree", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Fixture\n");
    repository.writeFile("src/index.ts", "export const answer = 42;\n");
    repository.writeFile("asset.bin", new Uint8Array([0, 1, 2, 3]));
    await repository.stage();
    const head = await repository.commit("Initial project");

    const range = await constructWholeRepositoryReviewRange(repository.directory, {
      headRef: "main",
    });
    const files = await generateStructuredEmptyTreeDiff(repository.directory, {
      headRef: "main",
    });
    const byPath = new Map(files.map((file) => [file.path, file]));

    expect(range).toMatchObject({
      baseSha: emptyTreeSha,
      headSha: head.sha,
      baseRefDisplay: "empty repository",
      headRefDisplay: "main",
      range: {
        kind: "whole_repository",
        baseRef: {
          kind: "empty_tree",
          value: emptyTreeSha,
          displayName: "empty repository",
        },
        headRef: { kind: "branch", value: "main" },
      },
      mergeBase: null,
    });
    expect(byPath.get("README.md")).toMatchObject({ status: "added", additions: 1 });
    expect(byPath.get("src/index.ts")).toMatchObject({ status: "added", additions: 1 });
    expect(byPath.get("asset.bin")).toMatchObject({ status: "added", isBinary: true });
  });
});

describe("Git diff generation and parsing", () => {
  it("generates staged, unstaged, and combined worktree diffs for tracked files", async () => {
    const repository = await createRepository();
    repository.writeFile("tracked.txt", "one\n");
    await repository.stage();
    const head = await repository.commit("Initial tracked file");

    repository.writeFile("tracked.txt", "one\ntwo\n");
    await repository.stage(["tracked.txt"]);
    repository.writeFile("tracked.txt", "one\ntwo\nthree\n");
    repository.writeFile("untracked.txt", "not reviewed\n");

    const staged = await generateStructuredStagedDiff(repository.directory);
    const unstaged = await generateStructuredUnstagedDiff(repository.directory);
    const fingerprint = await getWorktreeFingerprint(repository.directory);
    const range = await constructDefaultWorktreeReviewRange(repository.directory);
    const worktree = await generateStructuredWorktreeDiff(repository.directory, {
      baseRef: range.baseSha,
    });

    expect(range).toMatchObject({
      baseSha: head.sha,
      headSha: head.sha,
      range: { kind: "worktree", headRef: { kind: "worktree" } },
    });
    expect(fingerprint).toMatchObject({
      headSha: head.sha,
      stagedDiffHash: expect.stringMatching(/^sha256:/u),
      unstagedDiffHash: expect.stringMatching(/^sha256:/u),
    });
    expect(staged).toMatchObject([{ path: "tracked.txt", additions: 1 }]);
    expect(unstaged).toMatchObject([{ path: "tracked.txt", additions: 1 }]);
    expect(worktree).toMatchObject([{ path: "tracked.txt", additions: 2 }]);
    expect(worktree.map((file) => file.path)).not.toContain("untracked.txt");
  });

  it("parses added, deleted, modified, mode-only, renamed, and binary files", async () => {
    const repository = await createRepository();
    repository.writeFile("modified.txt", "alpha\nshared\n");
    repository.writeFile("deleted.txt", "remove me\n");
    repository.writeFile("renamed.txt", "rename me\n");
    repository.writeFile("mode.sh", "#!/bin/sh\necho mode\n");
    repository.writeFile("binary.bin", new Uint8Array([0, 1, 2, 3]));
    await repository.stage();
    const base = await repository.commit("Initial files");

    await repository.checkout("feature/diff", { create: true });
    repository.writeFile("modified.txt", "alpha changed\nshared\n");
    repository.writeFile("added.txt", "new file\n");
    repository.removePath("deleted.txt");
    await repository.move("renamed.txt", "renamed-new.txt");
    repository.chmod("mode.sh", 0o755);
    repository.writeFile("binary.bin", new Uint8Array([0, 255, 254, 253]));
    await repository.stage();
    const head = await repository.commit("Exercise diff cases");

    const files = await generateStructuredCommittedDiff(repository.directory, {
      baseRef: base.sha,
      headRef: head.sha,
    });
    const byPath = new Map(files.map((file) => [file.path, file]));
    const stats = summarizeDiffFiles(files);

    expect(byPath.get("modified.txt")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(byPath.get("added.txt")).toMatchObject({ status: "added", additions: 1 });
    expect(byPath.get("deleted.txt")).toMatchObject({ status: "deleted", deletions: 1 });
    expect(byPath.get("renamed-new.txt")).toMatchObject({
      status: "renamed",
      oldPath: "renamed.txt",
      renameMetadata: { oldPath: "renamed.txt", newPath: "renamed-new.txt" },
    });
    expect(byPath.get("mode.sh")).toMatchObject({
      status: "mode_changed",
      oldMode: "100644",
      newMode: "100755",
      hunks: [],
    });
    expect(byPath.get("binary.bin")).toMatchObject({ status: "binary", isBinary: true });
    expect(stats).toMatchObject({
      fileCount: 6,
      binaryFileCount: 1,
      renameCount: 1,
    });
  });

  it("parses no-newline markers from raw patches", () => {
    const files = parseRawDiff(`diff --git a/file.txt b/file.txt
index 01e79c3..f1b9f89 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`);

    expect(files[0]?.hunks[0]?.lines.map((line) => line.type)).toEqual([
      "deletion",
      "no_newline",
      "addition",
      "no_newline",
    ]);
  });

  it("parses an empty raw patch as an empty diff", () => {
    expect(parseRawDiff("")).toEqual([]);
  });
});
