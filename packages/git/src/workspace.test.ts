import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyTreeSha } from "./diff";
import { createTempGitRepository, type TestGitRepository } from "./testing/repository";
import {
  cleanupGitWorkspace,
  createGitArchiveWorkspace,
  readGitWorkspaceMarker,
  reapStaleGitWorkspaces,
  type GitArchiveWorkspace,
} from "./workspace";

const repositories: TestGitRepository[] = [];
const tempDirs: string[] = [];

async function createRepository(): Promise<TestGitRepository> {
  const repository = await createTempGitRepository();
  repositories.push(repository);
  return repository;
}

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "greenroom-workspace-test-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    repository.cleanup();
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("Git archive workspaces", () => {
  it("creates a tracked-file archive workspace without mutating source Git metadata", async () => {
    const repository = await createRepository();
    repository.writeFile(".gitignore", "ignored.txt\n");
    repository.writeFile("README.md", "# Base\n");
    await repository.stage();
    const base = await repository.commit("Initial commit");
    repository.writeFile("src/index.ts", "export const answer = 42;\n");
    await repository.stage();
    const head = await repository.commit("Add source file");
    repository.writeFile("untracked.txt", "not committed\n");
    repository.writeFile("ignored.txt", "ignored local file\n");
    const workspaceParentDir = await tempDir();
    const worktreeListBefore = await repository.run(["worktree", "list", "--porcelain"]);

    const workspace = await createGitArchiveWorkspace({
      workspaceParentDir,
      sourceRepositoryPath: repository.directory,
      runId: "workflow_run_1",
      jobId: "harness_job_1",
      revisionId: "revision_1",
      baseSha: base.sha,
      headSha: head.sha,
      now: () => "2026-07-03T00:00:00.000Z",
    });
    const worktreeListAfter = await repository.run(["worktree", "list", "--porcelain"]);
    const marker = await readGitWorkspaceMarker(workspace.workspaceRoot);

    expect(await readFile(join(workspace.repoPath, "README.md"), "utf8")).toBe("# Base\n");
    expect(await readFile(join(workspace.repoPath, "src/index.ts"), "utf8")).toContain(
      "answer = 42",
    );
    await expectExists(join(workspace.repoPath, ".git"), false);
    await expectExists(join(workspace.repoPath, "untracked.txt"), false);
    await expectExists(join(workspace.repoPath, "ignored.txt"), false);
    expect(worktreeListAfter.stdout).toBe(worktreeListBefore.stdout);
    expect(marker).toMatchObject({
      strategy: "git_archive",
      runId: "workflow_run_1",
      jobId: "harness_job_1",
      revisionId: "revision_1",
      baseSha: base.sha,
      headSha: head.sha,
      sourceRepositoryPath: repository.directory,
      createdAt: "2026-07-03T00:00:00.000Z",
    });
  });

  it("creates archive workspaces when the review base is Git's empty tree object", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Whole repository\n");
    await repository.stage();
    const head = await repository.commit("Initial commit");
    const workspaceParentDir = await tempDir();

    const workspace = await createGitArchiveWorkspace({
      workspaceParentDir,
      sourceRepositoryPath: repository.directory,
      runId: "workflow_run_1",
      jobId: "harness_job_whole_repository",
      revisionId: "revision_1",
      baseSha: emptyTreeSha,
      headSha: head.sha,
      now: () => "2026-07-03T00:00:00.000Z",
    });
    const marker = await readGitWorkspaceMarker(workspace.workspaceRoot);

    expect(await readFile(join(workspace.repoPath, "README.md"), "utf8")).toBe(
      "# Whole repository\n",
    );
    expect(marker).toMatchObject({
      strategy: "git_archive",
      baseSha: emptyTreeSha,
      headSha: head.sha,
    });
  });

  it("fails clearly when the requested commit is missing", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Base\n");
    await repository.stage();
    const base = await repository.commit("Initial commit");

    await expect(
      createGitArchiveWorkspace({
        workspaceParentDir: await tempDir(),
        sourceRepositoryPath: repository.directory,
        runId: "workflow_run_1",
        jobId: "harness_job_missing",
        revisionId: "revision_1",
        baseSha: base.sha,
        headSha: "f".repeat(40),
      }),
    ).rejects.toMatchObject({
      code: "commit_missing",
      message: expect.stringContaining("is not available"),
    });
  });

  it("fails clearly when deterministic workspace names collide", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Base\n");
    await repository.stage();
    const head = await repository.commit("Initial commit");
    const workspaceParentDir = await tempDir();

    await createWorkspace(repository, workspaceParentDir, head.sha, {
      jobId: "harness_job_collision",
      now: () => "2026-07-03T00:00:00.000Z",
    });

    await expect(
      createWorkspace(repository, workspaceParentDir, head.sha, {
        jobId: "harness_job_collision",
        now: () => "2026-07-03T00:00:01.000Z",
      }),
    ).rejects.toMatchObject({ code: "workspace_exists" });
  });

  it("cleans up workspace directories and reaps stale archive markers", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Base\n");
    await repository.stage();
    const head = await repository.commit("Initial commit");
    const workspaceParentDir = await tempDir();
    const stale = await createWorkspace(repository, workspaceParentDir, head.sha, {
      jobId: "harness_job_stale",
      now: () => "2026-07-03T00:00:00.000Z",
    });
    const fresh = await createWorkspace(repository, workspaceParentDir, head.sha, {
      jobId: "harness_job_fresh",
      now: () => "2026-07-03T00:59:45.000Z",
    });

    const reaped = await reapStaleGitWorkspaces({
      workspaceParentDir,
      staleGraceMs: 60_000,
      nowMs: () => Date.parse("2026-07-03T01:00:00.000Z"),
    });

    expect(reaped).toMatchObject({
      scanned: 2,
      removed: [stale.workspaceRoot],
      skipped: [fresh.workspaceRoot],
      failures: [],
    });
    await expectExists(stale.workspaceRoot, false);
    await expectExists(fresh.workspaceRoot, true);

    const cleanup = await cleanupGitWorkspace(fresh);

    expect(cleanup).toEqual({
      workspaceRoot: fresh.workspaceRoot,
      removed: true,
      errorMessage: null,
    });
    await expectExists(fresh.workspaceRoot, false);

    await expect(cleanupGitWorkspace(fresh)).resolves.toMatchObject({
      workspaceRoot: fresh.workspaceRoot,
      removed: true,
      errorMessage: null,
    });
  });

  it("ignores missing parents and directories without valid archive markers", async () => {
    const workspaceParentDir = await tempDir();
    await mkdir(join(workspaceParentDir, "no-marker"));
    await mkdir(join(workspaceParentDir, "bad-marker"));
    await writeFile(
      join(workspaceParentDir, "bad-marker", ".greenroom-workspace.json"),
      "{not json",
      "utf8",
    );

    await expect(
      reapStaleGitWorkspaces({
        workspaceParentDir: join(workspaceParentDir, "missing-parent"),
        staleGraceMs: 0,
      }),
    ).resolves.toEqual({ scanned: 0, removed: [], skipped: [], failures: [] });

    await expect(
      reapStaleGitWorkspaces({
        workspaceParentDir,
        staleGraceMs: 0,
      }),
    ).resolves.toEqual({ scanned: 0, removed: [], skipped: [], failures: [] });
    await expectExists(join(workspaceParentDir, "no-marker"), true);
    await expectExists(join(workspaceParentDir, "bad-marker"), true);
  });

  it("reaps archive workspaces exactly at the stale grace boundary", async () => {
    const repository = await createRepository();
    repository.writeFile("README.md", "# Base\n");
    await repository.stage();
    const head = await repository.commit("Initial commit");
    const workspaceParentDir = await tempDir();
    const boundary = await createWorkspace(repository, workspaceParentDir, head.sha, {
      jobId: "harness_job_boundary",
      now: () => "2026-07-03T00:00:00.000Z",
    });

    const reaped = await reapStaleGitWorkspaces({
      workspaceParentDir,
      staleGraceMs: 60_000,
      nowMs: () => Date.parse("2026-07-03T00:01:00.000Z"),
    });

    expect(reaped.removed).toEqual([boundary.workspaceRoot]);
    await expectExists(boundary.workspaceRoot, false);
  });
});

async function createWorkspace(
  repository: TestGitRepository,
  workspaceParentDir: string,
  headSha: string,
  options: { jobId: string; now: () => string },
): Promise<GitArchiveWorkspace> {
  return createGitArchiveWorkspace({
    workspaceParentDir,
    sourceRepositoryPath: repository.directory,
    runId: "workflow_run_1",
    jobId: options.jobId,
    revisionId: "revision_1",
    baseSha: headSha,
    headSha,
    now: options.now,
  });
}

async function expectExists(path: string, expected: boolean): Promise<void> {
  await expect(
    stat(path).then(
      () => true,
      () => false,
    ),
  ).resolves.toBe(expected);
}
