import { expect, test } from "./fixtures/playwright";
import { createSmallDiffFile, setupLargeDiffWorkspace } from "./fixtures/thread-triage";

import type {
  DiffFile,
  RevisionSnapshot,
  ThreadStatus,
  ThreadWithComments,
} from "@greenroom/schemas";

const now = "2026-06-25T12:00:00.000Z";

test("creates and triages inline review threads", async ({ page }) => {
  const longThreadBody = `Use a named constant here. ${"comment".repeat(64)}`;
  const review = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Feature review",
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: "main" },
      headRef: { kind: "branch", value: "feature/review" },
    },
    baseRefDisplay: "main",
    headRefDisplay: "feature/review",
    currentRevisionId: "revision_1",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const repository = {
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
  const revision = {
    id: "revision_1",
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    diffSummary: {
      fileCount: 1,
      additions: 2,
      deletions: 1,
      binaryFileCount: 0,
      renameCount: 0,
    },
    refreshReason: "initial",
    createdAt: now,
  };
  const file: DiffFile = {
    id: "diff_file_1",
    revisionId: "revision_1",
    path: "src/index.ts",
    oldPath: null,
    status: "modified",
    isBinary: false,
    additions: 2,
    deletions: 1,
    oldMode: null,
    newMode: null,
    renameMetadata: null,
    hunks: [
      {
        id: "diff_hunk_1",
        fileId: "diff_file_1",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        header: "@@ -1,2 +1,3 @@",
        sortOrder: 1,
        lines: [
          {
            type: "context",
            oldLineNumber: 1,
            newLineNumber: 1,
            content: "export function answer() {",
          },
          { type: "deletion", oldLineNumber: 2, newLineNumber: null, content: "  return 41;" },
          { type: "addition", oldLineNumber: null, newLineNumber: 2, content: "  return 42;" },
          { type: "addition", oldLineNumber: null, newLineNumber: 3, content: "}" },
        ],
      },
    ],
  };
  const threads: ThreadWithComments[] = [];
  let createdAnchorCount = 0;

  await page.route("**/api/threads/GT-1/comments", async (route) => {
    const input = route.request().postDataJSON() as {
      authorDisplayName: string;
      authorKind: "human";
      body: string;
    };
    const target = threads[0];

    if (target === undefined) {
      await route.fulfill({ status: 404, json: { error: { message: "Missing thread" } } });
      return;
    }

    const comment = {
      id: `comment_${target.comments.length + 1}`,
      threadRef: target.shortRef,
      parentCommentId: null,
      authorKind: input.authorKind,
      authorDisplayName: input.authorDisplayName,
      body: input.body,
      sortOrder: target.comments.length + 1,
      createdAt: now,
      editedAt: null,
    };
    target.comments.push(comment);
    await route.fulfill({ json: { comment } });
  });

  for (const action of ["resolve", "dismiss", "reopen"] as const) {
    await page.route(`**/api/threads/GT-1/${action}`, async (route) => {
      const target = threads[0];

      if (target === undefined) {
        await route.fulfill({ status: 404, json: { error: { message: "Missing thread" } } });
        return;
      }

      const nextStatus: ThreadStatus =
        action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : "open";
      target.status = nextStatus;
      target.updatedAt = now;
      await route.fulfill({ json: { thread: target } });
    });
  }

  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { threads } });
      return;
    }

    const input = route.request().postDataJSON() as {
      anchor: ThreadWithComments["anchor"];
      anchors?: ThreadWithComments["anchors"];
      firstComment: {
        authorDisplayName: string;
        authorKind: "human";
        body: string;
      };
      severity: ThreadWithComments["severity"];
      source: ThreadWithComments["source"];
      type: ThreadWithComments["type"];
    };
    createdAnchorCount = input.anchors?.length ?? 1;
    const thread: ThreadWithComments = {
      reviewDisplayId: "GR-1",
      shortRef: "GT-1",
      status: "open",
      type: input.type,
      severity: input.severity ?? null,
      source: input.source,
      anchor: input.anchor,
      anchors: input.anchors ?? [input.anchor],
      remapConfidence: null,
      outdated: false,
      createdAt: now,
      updatedAt: now,
      comments: [
        {
          id: "comment_1",
          threadRef: "GT-1",
          parentCommentId: null,
          authorKind: input.firstComment.authorKind,
          authorDisplayName: input.firstComment.authorDisplayName,
          body: input.firstComment.body,
          sortOrder: 1,
          createdAt: now,
          editedAt: null,
        },
      ],
    };
    threads.splice(0, threads.length, thread);
    await route.fulfill({ status: 201, json: { thread } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId: "revision_1", memberships: [] },
    });
  });
  await page.route("**/api/reviews/GR-1/diff", async (route) => {
    await route.fulfill({ json: { review, revision, files: [file] } });
  });
  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1", async (route) => {
    await route.fulfill({ json: { review, repository, currentRevision: revision } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [] } });
  });

  // The first-launch wizard probes /api/repositories without a token before
  // deciding whether to redirect to /setup; answer it deterministically so
  // the wizard never intercepts this test.
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  await page.goto("/reviews/GR-1");

  await expect(page.getByRole("heading", { name: "Feature review" })).toBeVisible();
  const modifiedRowCellCount = await page
    .locator('section[aria-label="src/index.ts"] tbody tr')
    .nth(1)
    .locator("td")
    .count();
  expect(modifiedRowCellCount).toBe(4);

  const startRow = page.locator('section[aria-label="src/index.ts"] tbody tr').nth(3);
  const endRow = page.locator('section[aria-label="src/index.ts"] tbody tr').nth(4);
  const startRowBox = await startRow.boundingBox();
  const endRowBox = await endRow.boundingBox();

  expect(startRowBox).not.toBeNull();
  expect(endRowBox).not.toBeNull();

  if (startRowBox === null || endRowBox === null) {
    throw new Error("Expected changed rows to be visible for drag selection");
  }

  await page.mouse.move(startRowBox.x + 160, startRowBox.y + startRowBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endRowBox.x + 160, endRowBox.y + endRowBox.height / 2);
  await page.mouse.up();
  await expect(page.getByLabel("Comment")).toHaveCount(0);

  const startHandle = page.getByRole("button", { name: "Start thread on head line 2" });
  const endHandle = page.getByRole("button", { name: "Start thread on head line 3" });
  const startBox = await startHandle.boundingBox();
  const endBox = await endHandle.boundingBox();

  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();

  if (startBox === null || endBox === null) {
    throw new Error("Expected thread controls to be visible for drag selection");
  }

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.up();
  await expect(startRow).toHaveClass(/diff-range-start/);
  await expect(startRow).not.toHaveClass(/diff-range-end/);
  await expect(endRow).toHaveClass(/diff-range-end/);
  await page.getByLabel("Thread type").selectOption("issue");
  await page.getByLabel("Severity").selectOption("major");
  await page.getByLabel("Comment").fill(longThreadBody);
  await page.getByRole("button", { name: "Create thread" }).click();

  expect(createdAnchorCount).toBe(2);
  await expect(page.getByText("GT-1").first()).toBeVisible();
  await expect(page.getByText("Use a named constant here.").first()).toBeVisible();

  const inlineThreadCard = page.locator("#thread-GT-1");
  const inlineThreadOverflow = await inlineThreadCard.evaluate((card) => ({
    clientWidth: card.clientWidth,
    scrollWidth: card.scrollWidth,
  }));
  expect(inlineThreadOverflow.scrollWidth).toBeLessThanOrEqual(
    inlineThreadOverflow.clientWidth + 1,
  );

  await page.getByPlaceholder("Reply to GT-1").fill("Agreed, I will update it.");
  await page.getByRole("button", { name: "Reply to GT-1" }).click();
  await expect(
    page.locator("#thread-GT-1 p").filter({ hasText: "Agreed, I will update it." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Resolve GT-1" }).click();
  await expect(page.getByText("Resolved").first()).toBeVisible();
  await page.getByRole("button", { name: "Reopen GT-1" }).click();
  await expect(page.getByText("Open").first()).toBeVisible();
  await page.getByRole("button", { name: "Dismiss GT-1" }).click();
  await expect(page.getByText("Dismissed").first()).toBeVisible();

  await page.getByRole("button", { name: "Dismissed" }).click();
  await page.getByRole("button", { name: "Severity" }).click();
  await expect(page.getByText("src/index.ts:2-3")).toBeVisible();
  await page.getByRole("button", { name: "Question" }).click();
  await expect(page.getByText("No threads match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();

  await page.getByRole("button", { name: "Go to GT-1" }).click();
  await expect(page.locator("#thread-GT-1")).toBeVisible();
  await page.getByRole("button", { name: "Copy GT-1" }).first().click();

  // Deep link: a pasted global ref opens the Threads drawer and lands on the
  // thread without any manual navigation.
  await page.goto("/reviews/GR-1?thread=GT-1");
  await expect(page.getByRole("tab", { name: "Threads" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#thread-GT-1")).toBeVisible();
});

test("keeps long snapshot revision ids inside the revision card", async ({ page }) => {
  await page.setViewportSize({ width: 367, height: 720 });

  const revisionId = "revision_4d5e2197-efee-4829-8834-997658a4a6f7";
  const review = {
    displayId: "GR-1",
    repositoryId: "repo_1",
    title: "Long revision review",
    // A worktree review, so the workspace also surfaces the untracked-files
    // exclusion note.
    range: {
      kind: "worktree",
      baseRef: { kind: "commit", value: "a".repeat(40), displayName: "merge-base(main, HEAD)" },
      headRef: { kind: "worktree", value: "HEAD+worktree", displayName: "HEAD + worktree" },
    },
    baseRefDisplay: "merge-base(main, HEAD)",
    headRefDisplay: "HEAD + worktree",
    currentRevisionId: revisionId,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const repository = {
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
  const revision: RevisionSnapshot = {
    id: revisionId,
    reviewDisplayId: "GR-1",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: {
      headSha: "3".repeat(40),
      stagedDiffHash: null,
      unstagedDiffHash: null,
    },
    diffSummary: {
      fileCount: 1,
      additions: 1,
      deletions: 0,
      binaryFileCount: 0,
      renameCount: 0,
    },
    refreshReason: "initial",
    createdAt: now,
  };
  const files = [createSmallDiffFile(revision.id)];

  await page.route("**/api/reviews/GR-1/revisions", async (route) => {
    await route.fulfill({ json: { revisions: [revision] } });
  });
  await page.route("**/api/reviews/GR-1/threads", async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route("**/api/reviews/GR-1/spotlight/line-membership", async (route) => {
    await route.fulfill({
      json: { reviewDisplayId: "GR-1", revisionId, memberships: [] },
    });
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

  // The first-launch wizard probes /api/repositories without a token before
  // deciding whether to redirect to /setup; answer it deterministically so
  // the wizard never intercepts this test.
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });

  await page.goto("/reviews/GR-1");
  await expect(page.getByRole("heading", { name: "Long revision review" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize side panel" })).toBeHidden();

  const snapshotSelect = page.getByLabel("Snapshot");
  const bounds = await snapshotSelect.evaluate((select) => {
    const card = select.closest("section");

    if (!(card instanceof HTMLElement)) {
      throw new Error("Revision card was not found");
    }

    const cardRect = card.getBoundingClientRect();
    const selectRect = select.getBoundingClientRect();

    return {
      cardRight: cardRect.right,
      selectRight: selectRect.right,
    };
  });

  expect(bounds.selectRight).toBeLessThanOrEqual(bounds.cardRight);

  // Human option labels: revision number, relative age, and origin
  // replace the raw revision id in the selector.
  await expect(snapshotSelect.locator("option")).toHaveText([
    /^Rev 1 · .+ · initial snapshot · current$/,
  ]);

  // Worktree reviews state the untracked-files exclusion under the file tree
  // with a docs link.
  const fileTree = page.getByRole("navigation", { name: "Changed files" });
  await expect(
    fileTree.getByText("Untracked files are excluded from worktree reviews."),
  ).toBeVisible();
  await expect(fileTree.getByRole("link", { name: "Why?" })).toHaveAttribute(
    "href",
    /docs\/Git\.md#untracked-files$/,
  );
});

test("keeps the large-diff workspace layout and resizers persistent", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1100 });
  await setupLargeDiffWorkspace(page);
  await page.goto("/reviews/GR-1");

  await expect(page.getByText("Large diff")).toBeVisible();
  const addedRowCellCount = await page
    .locator('section[aria-label="src/large.ts"] tbody tr')
    .nth(1)
    .locator("td")
    .count();
  expect(addedRowCellCount).toBe(3);
  await page.evaluate(() => window.scrollTo(0, 420));

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('section[aria-labelledby="review-workspace-title"]');
    const fileTree = document.querySelector('[aria-label="Changed files"]');
    const fileList = fileTree?.querySelector('[role="tree"]');
    const diff = document.querySelector('section[aria-label="src/large.ts"]');
    const threads = document.querySelector('section[aria-labelledby="thread-panel-heading"]');

    if (
      !(workspace instanceof HTMLElement) ||
      !(fileTree instanceof HTMLElement) ||
      !(fileList instanceof HTMLElement) ||
      !(diff instanceof HTMLElement) ||
      !(threads instanceof HTMLElement)
    ) {
      throw new Error("Review workspace layout elements were not found");
    }

    const fileListRect = fileList.getBoundingClientRect();
    const fileTreeRect = fileTree.getBoundingClientRect();

    return {
      diffWidth: diff.getBoundingClientRect().width,
      fileListBottom: fileListRect.bottom,
      fileListClientHeight: fileList.clientHeight,
      fileListScrollHeight: fileList.scrollHeight,
      fileTreeBottom: fileTreeRect.bottom,
      fileTreeTop: fileTreeRect.top,
      fileTreeWidth: fileTree.getBoundingClientRect().width,
      viewportHeight: window.innerHeight,
      threadPanelWidth: threads.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace.getBoundingClientRect().width,
    };
  });

  expect(layout.workspaceWidth).toBeGreaterThan(layout.viewportWidth - 80);
  expect(layout.diffWidth).toBeGreaterThan(900);
  expect(layout.fileTreeWidth).toBeLessThanOrEqual(300);
  expect(layout.threadPanelWidth).toBeLessThanOrEqual(340);
  expect(layout.fileTreeTop).toBeLessThanOrEqual(32);
  expect(layout.fileTreeBottom).toBeGreaterThan(layout.viewportHeight - 32);
  expect(layout.fileTreeBottom).toBeLessThanOrEqual(layout.viewportHeight - 16);
  expect(Math.abs(layout.fileListBottom - layout.fileTreeBottom)).toBeLessThanOrEqual(2);
  expect(layout.fileListClientHeight).toBeGreaterThan(layout.viewportHeight - 140);
  expect(layout.fileListScrollHeight).toBeGreaterThan(layout.fileListClientHeight);

  const sidePanelResizer = page.getByRole("separator", { name: "Resize side panel" });
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "320");
  const sidePanelResizerBounds = await sidePanelResizer.boundingBox();

  if (sidePanelResizerBounds === null) {
    throw new Error("Side panel resize handle was not visible");
  }

  const sidePanelResizerX = sidePanelResizerBounds.x + sidePanelResizerBounds.width / 2;
  const sidePanelResizerY = sidePanelResizerBounds.y + 50;
  await page.mouse.move(sidePanelResizerX, sidePanelResizerY);
  await page.mouse.down();
  await page.mouse.move(sidePanelResizerX - 160, sidePanelResizerY);
  await page.mouse.up();

  const resizedDrawerLayout = await page.evaluate(() => {
    const diff = document.querySelector('section[aria-label="src/large.ts"]');
    const drawer = document.querySelector("#workspace-drawer");
    const threadPanel = document.querySelector('section[aria-labelledby="thread-panel-heading"]');

    if (
      !(diff instanceof HTMLElement) ||
      !(drawer instanceof HTMLElement) ||
      !(threadPanel instanceof HTMLElement)
    ) {
      throw new Error("Resizable workspace drawer elements were not found");
    }

    return {
      diffWidth: diff.getBoundingClientRect().width,
      drawerWidth: drawer.getBoundingClientRect().width,
      threadPanelWidth: threadPanel.getBoundingClientRect().width,
    };
  });

  expect(resizedDrawerLayout.drawerWidth).toBeGreaterThan(layout.threadPanelWidth + 140);
  expect(resizedDrawerLayout.diffWidth).toBeLessThan(layout.diffWidth - 140);
  expect(
    Math.abs(resizedDrawerLayout.threadPanelWidth - resizedDrawerLayout.drawerWidth),
  ).toBeLessThan(1);
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "480");

  for (const tabName of ["AI Review", "Spotlight", "Threads"] as const) {
    await page.getByRole("tab", { name: tabName }).click();
    await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "480");

    const widths = await page.locator("#workspace-drawer").evaluate((drawer) => {
      const firstCard = drawer.querySelector("section");

      if (!(firstCard instanceof HTMLElement)) {
        throw new Error("Drawer card was not found");
      }

      return {
        card: firstCard.getBoundingClientRect().width,
        drawer: drawer.getBoundingClientRect().width,
      };
    });
    expect(Math.abs(widths.card - widths.drawer)).toBeLessThan(1);
  }

  await sidePanelResizer.press("ArrowLeft");
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "496");
  await sidePanelResizer.press("Shift+ArrowRight");
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "448");
  await sidePanelResizer.press("End");
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "576");
  await sidePanelResizer.press("Home");
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "288");
  await sidePanelResizer.press("ArrowLeft");
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "304");

  await page.getByRole("button", { name: "Hide side panel" }).click();
  await expect(sidePanelResizer).toHaveCount(0);
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "304");

  await sidePanelResizer.dblclick();
  await expect(sidePanelResizer).toHaveAttribute("aria-valuenow", "320");

  const fileBrowserResizer = page.getByRole("separator", { name: "Resize file browser" });
  const resizerBounds = await fileBrowserResizer.boundingBox();

  if (resizerBounds === null) {
    throw new Error("File browser resize handle was not visible");
  }

  const resizerX = resizerBounds.x + resizerBounds.width / 2;
  const resizerY = resizerBounds.y + 50;
  await page.mouse.move(resizerX, resizerY);
  await page.mouse.down();
  await page.mouse.move(resizerX + 120, resizerY);
  await page.mouse.up();
  const resizedFileTreeWidth = await page
    .getByRole("navigation", { name: "Changed files" })
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(resizedFileTreeWidth).toBeGreaterThan(layout.fileTreeWidth + 100);
  await fileBrowserResizer.dblclick();
  await expect(fileBrowserResizer).toHaveAttribute("aria-valuenow", "272");
});

test("paginates a large diff independently", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1100 });
  await setupLargeDiffWorkspace(page);
  await page.goto("/reviews/GR-1");

  await expect(page.getByText("value1200")).toBeVisible();
  await expect(page.getByText("value1305")).toHaveCount(0);

  await page.getByRole("button", { name: "Load 600 more" }).click();
  await expect(page.getByText("value1305")).toBeVisible();
});

test("filters and navigates large-review files independently", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1100 });
  await setupLargeDiffWorkspace(page);
  await page.goto("/reviews/GR-1");

  await page.getByRole("heading", { name: "src/large.ts" }).click();
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "src/other.ts" })).toBeVisible();

  await page.keyboard.press("k");
  await expect(page.getByRole("heading", { name: "src/large.ts" })).toBeVisible();

  const changedFiles = page.getByRole("navigation", { name: "Changed files" });
  const sourceDirectory = changedFiles.getByRole("treeitem", { name: "Directory src" });
  await expect(
    changedFiles.getByRole("treeitem", {
      name: /Open src\/large\.ts, added, 1305 additions, 0 deletions/,
    }),
  ).toContainText("large.ts+1305-0");
  await sourceDirectory.getByRole("button", { name: "src" }).click();
  await expect(sourceDirectory).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "src/large.ts" })).toBeVisible();

  const fileFilter = changedFiles.getByLabel("Filter changed files");
  await fileFilter.fill("src/");
  await expect(sourceDirectory).toHaveAttribute("aria-expanded", "true");
  await expect(changedFiles.getByRole("treeitem", { name: /Open src\/large\.ts/ })).toBeVisible();
  await expect(changedFiles.getByRole("treeitem", { name: /Open src\/other\.ts/ })).toBeVisible();

  await fileFilter.fill("OTHER.TS");
  await expect(sourceDirectory).toHaveAttribute("aria-expanded", "true");
  await expect(changedFiles.getByRole("treeitem", { name: /Open src\/other\.ts/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "src/large.ts" })).toBeVisible();

  await fileFilter.fill("does-not-match");
  await expect(changedFiles.getByText("No matching files")).toBeVisible();
  await changedFiles.getByRole("button", { name: "Clear file filter" }).click();
  await expect(sourceDirectory).toHaveAttribute("aria-expanded", "false");

  await fileFilter.fill("generated-2.ts");
  await page.getByRole("heading", { name: "src/large.ts" }).click();
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "src/generated-2.ts" })).toBeVisible();
  await changedFiles.getByRole("button", { name: "Clear file filter" }).click();
  await expect(sourceDirectory).toHaveAttribute("aria-expanded", "true");
});

test("navigates threads, changes diff modes, refreshes, and shows shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1100 });
  await setupLargeDiffWorkspace(page);
  await page.goto("/reviews/GR-1");

  await page.keyboard.press("]");
  await expect(page.locator("#thread-GT-1")).toBeVisible();

  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("u");
  await expect(page.getByRole("button", { name: "Unified" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const refreshRequest = page.waitForRequest("**/api/reviews/GR-1/refresh");
  await page.keyboard.press("r");
  await refreshRequest;

  // `?` opens the shortcut reference overlay; it documents the real
  // bindings and dismisses with Escape and with a backdrop click.
  await page.keyboard.press("?");
  const shortcutOverlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcutOverlay).toBeVisible();
  await expect(shortcutOverlay.getByText("Next changed file")).toBeVisible();
  await expect(shortcutOverlay.getByText("Next visible thread")).toBeVisible();
  await expect(shortcutOverlay.getByText("Unified diff view")).toBeVisible();
  await expect(shortcutOverlay.getByText("Refresh the review from the worktree")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(shortcutOverlay).toHaveCount(0);

  await page.keyboard.press("?");
  await expect(shortcutOverlay).toBeVisible();
  await shortcutOverlay.click({ position: { x: 8, y: 8 } });
  await expect(shortcutOverlay).toHaveCount(0);
});
