import type {
  DiffFile,
  Repository,
  ReviewPr,
  RevisionSnapshot,
  ThreadWithComments,
} from "@greenroom/schemas";

import type { Page } from "./playwright";

const now = "2026-06-25T12:00:00.000Z";

type ReviewFixture = Omit<ReviewPr, "spotlightConfig">;
type RepositoryFixture = Omit<Repository, "spotlightConfig">;

export interface LargeDiffWorkspaceScenario {
  files: DiffFile[];
  repository: RepositoryFixture;
  review: ReviewFixture;
  revision: RevisionSnapshot;
  threads: ThreadWithComments[];
}

export async function setupLargeDiffWorkspace(page: Page): Promise<LargeDiffWorkspaceScenario> {
  const review: ReviewFixture = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Large review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/large" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/large",
    currentRevisionId: "revision_1",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const repository: RepositoryFixture = {
    id: "repo_1",
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
    identityKey: "/work/greenroom/.git",
    displayName: "Greenroom",
    defaultBranchCandidate: "main",
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const fileCount = 38;
  const revision: RevisionSnapshot = {
    id: "revision_1",
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    diffSummary: {
      fileCount,
      additions: 1_305 + fileCount - 1,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
    },
    refreshReason: "initial",
    createdAt: now,
  };
  const files = [
    createLargeDiffFile(revision.id),
    createSmallDiffFile(revision.id),
    ...Array.from({ length: fileCount - 2 }, (_, index) =>
      createNavigationDiffFile(revision.id, index + 1),
    ),
  ];
  const threads: ThreadWithComments[] = [createLargeDiffThread()];

  await page.route("**/api/reviews/GR-1/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      json: { review, revision, reused: true, remap: { remapped: 0, outdated: 0 } },
    });
  });
  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: revision.id, memberships: [] },
    });
  });
  await page.route("**/api/reviews/GR-1/spotlight/views", async (route) => {
    await route.fulfill({ json: { views: [] } });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files } });
  });
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [] } });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  return { files, repository, review, revision, threads };
}

export function createSmallDiffFile(revisionId: string): DiffFile {
  return {
    id: "diff_file_2",
    revisionId,
    path: "src/other.ts",
    oldPath: null,
    status: "added",
    isBinary: false,
    additions: 1,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [
      {
        id: "diff_hunk_2",
        fileId: "diff_file_2",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        header: "@@ -0,0 +1 @@",
        sortOrder: 1,
        lines: [
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 1,
            content: "export const other = true;",
          },
        ],
      },
    ],
  };
}

function createLargeDiffFile(revisionId: string): DiffFile {
  return {
    id: "diff_file_1",
    revisionId,
    path: "src/large.ts",
    oldPath: null,
    status: "added",
    isBinary: false,
    additions: 1_305,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [
      {
        id: "diff_hunk_1",
        fileId: "diff_file_1",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1_305,
        header: "@@ -0,0 +1,1305 @@",
        sortOrder: 1,
        lines: Array.from({ length: 1_305 }, (_, index) => ({
          type: "addition",
          oldLineNumber: null,
          newLineNumber: index + 1,
          content: `export const value${index + 1} = ${index + 1};`,
        })),
      },
    ],
  };
}

function createNavigationDiffFile(revisionId: string, index: number): DiffFile {
  return {
    id: `diff_file_extra_${index}`,
    revisionId,
    path: `src/generated-${index}.ts`,
    oldPath: null,
    status: "added",
    isBinary: false,
    additions: 1,
    deletions: 0,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [
      {
        id: `diff_hunk_extra_${index}`,
        fileId: `diff_file_extra_${index}`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        header: "@@ -0,0 +1 @@",
        sortOrder: 1,
        lines: [
          {
            type: "addition",
            oldLineNumber: null,
            newLineNumber: 1,
            content: `export const generated${index} = ${index};`,
          },
        ],
      },
    ],
  };
}

function createLargeDiffThread(): ThreadWithComments {
  const anchor: ThreadWithComments["anchor"] = {
    reviewDisplayId: "GR-1",
    revisionId: "revision_1",
    filePath: "src/large.ts",
    oldFilePath: null,
    side: "head",
    lineNumber: 3,
    lineType: "addition",
    hunkId: "diff_hunk_1",
    hunkHeader: "@@ -0,0 +1,1305 @@",
    contextBefore: [],
    contextAfter: [],
    originalLineText: "export const value3 = 3;",
  };

  return {
    reviewDisplayId: "GR-1",
    shortRef: "GT-1",
    status: "open",
    type: "issue",
    severity: "major",
    source: { kind: "human", displayName: "Reviewer" },
    anchor,
    anchors: [anchor],
    remapConfidence: null,
    outdated: false,
    createdAt: now,
    updatedAt: now,
    comments: [
      {
        id: "comment_1",
        threadRef: "GT-1",
        parentCommentId: null,
        authorKind: "human",
        authorDisplayName: "Reviewer",
        body: "Check the generated values.",
        sortOrder: 1,
        createdAt: now,
        editedAt: null,
      },
    ],
  };
}
