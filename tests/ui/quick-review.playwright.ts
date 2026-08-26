import { expect, test, type Page } from "./fixtures/playwright";

const now = "2026-07-01T12:00:00.000Z";

const repositoryFixture = {
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

const diffSummaryFixture = {
  filesChanged: 1,
  additions: 3,
  deletions: 1,
};

const previewFileFixture = {
  path: "src/index.ts",
  oldPath: null,
  changeKind: "modified",
  additions: 3,
  deletions: 1,
  isBinary: false,
  hunks: [],
};

function previewFixture(files: unknown[]) {
  return {
    title: "merge-base(origin/main, HEAD)..HEAD + worktree",
    range: null,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    worktreeFingerprint: null,
    baseRefDisplay: "merge-base(origin/main, HEAD)",
    headRefDisplay: "HEAD + worktree",
    diffSummary: { ...diffSummaryFixture, filesChanged: files.length },
    files,
  };
}

/**
 * Dashboard-only routes for the one-click default review. The
 * catch-all is registered first so later, more specific routes win.
 */
async function routeQuickReviewApi(
  page: Page,
  options: {
    preview: { status: number; json: unknown };
    create?: { status: number; json: unknown };
  },
): Promise<{ createRequests: () => number }> {
  let createRequests = 0;

  // Anchored at the path root so Vite-served app modules under `/src/api/`
  // are not intercepted.
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [repositoryFixture] } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [] } });
  });
  await page.route("**/api/reviews**", async (route) => {
    const request = route.request();

    if (request.method() === "POST" && request.url().endsWith("/api/reviews/preview")) {
      await route.fulfill(options.preview);
      return;
    }

    if (request.method() === "POST" && request.url().endsWith("/api/reviews")) {
      createRequests += 1;
      await route.fulfill(
        options.create ?? {
          status: 500,
          json: { error: { code: "internal_error", message: "Unexpected create" } },
        },
      );
      return;
    }

    if (request.method() === "GET" && /\/api\/reviews(\?|$)/.test(request.url())) {
      await route.fulfill({ json: { reviews: [] } });
      return;
    }

    // Anything else (e.g. the workspace detail fetch after navigation) is
    // out of scope for these Dashboard tests.
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });

  return { createRequests: () => createRequests };
}

test("one-click review creates a default worktree review and opens it", async ({ page }) => {
  const api = await routeQuickReviewApi(page, {
    preview: { status: 200, json: previewFixture([previewFileFixture]) },
    create: {
      status: 201,
      json: {
        review: {
          id: "pr_9",
          displayId: "GR-9",
          repositoryId: "repo_1",
          title: "merge-base(origin/main, HEAD)..HEAD + worktree",
          status: "open",
          baseRefDisplay: "merge-base(origin/main, HEAD)",
          headRefDisplay: "HEAD + worktree",
          createdAt: now,
          updatedAt: now,
        },
        revision: {
          id: "rev_1",
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          diffSummary: diffSummaryFixture,
        },
      },
    },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Review current changes in Greenroom" }).click();

  await expect(page).toHaveURL(/\/reviews\/GR-9$/);
  expect(api.createRequests()).toBe(1);
});

test("one-click review reports an empty worktree inline without creating", async ({ page }) => {
  const api = await routeQuickReviewApi(page, {
    preview: { status: 200, json: previewFixture([]) },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Review current changes in Greenroom" }).click();

  // The app shell always renders the (empty) toast viewport as a second
  // role="status" region, so target the dashboard notice directly.
  await expect(page.getByRole("status").filter({ hasText: "No changes to review" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(api.createRequests()).toBe(0);
});

test("one-click review explains an unreachable repository inline", async ({ page }) => {
  await routeQuickReviewApi(page, {
    preview: {
      status: 404,
      json: {
        error: {
          code: "not_found",
          message: "Repository path does not exist: /work/greenroom",
          details: { gitErrorCode: "path_not_found", path: "/work/greenroom" },
        },
      },
    },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Review current changes in Greenroom" }).click();

  await expect(page.getByRole("alert")).toContainText("repository path is unreachable");
  await expect(page).toHaveURL(/\/$/);
});

test("base candidates on the creation page fill the custom base ref", async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [repositoryFixture] } });
  });
  await page.route("**/api/repositories/repo_1/refs**", async (route) => {
    await route.fulfill({ json: { refs: [] } });
  });
  await page.route("**/api/repositories/repo_1/commits**", async (route) => {
    await route.fulfill({ json: { commits: [] } });
  });
  await page.route("**/api/repositories/repo_1/base-candidates", async (route) => {
    await route.fulfill({
      json: {
        candidates: [
          {
            ref: "origin/main",
            sha: "c".repeat(40),
            reason: "remote_head",
            displayName: "origin/main",
          },
        ],
      },
    });
  });

  await page.goto("/reviews/new");

  // The default (worktree) flow states the untracked-files exclusion with a
  // docs link.
  const untrackedNote = page.getByText("Untracked files are excluded from worktree reviews.");
  await expect(untrackedNote).toBeVisible();
  await expect(page.getByRole("link", { name: "Why?" })).toHaveAttribute(
    "href",
    /docs\/Git\.md#untracked-files$/,
  );

  await page.getByRole("button", { name: "Use origin/main as base ref" }).click();

  await expect(page.getByLabel("Base ref", { exact: true })).toHaveValue("origin/main");
  // Custom committed ranges do not involve the worktree, so the note retires
  // with the default flow.
  await expect(untrackedNote).toHaveCount(0);
});

test("whole repository mode previews the selected committed head", async ({ page }) => {
  const previewRequests: unknown[] = [];

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [repositoryFixture] } });
  });
  await page.route("**/api/repositories/repo_1/refs**", async (route) => {
    await route.fulfill({
      json: {
        refs: [
          {
            kind: "branch",
            name: "main",
            fullName: "refs/heads/main",
            sha: "d".repeat(40),
            objectType: "commit",
            lastCommitAt: now,
          },
        ],
      },
    });
  });
  await page.route("**/api/repositories/repo_1/commits**", async (route) => {
    await route.fulfill({ json: { commits: [] } });
  });
  await page.route("**/api/repositories/repo_1/base-candidates", async (route) => {
    await route.fulfill({ json: { candidates: [] } });
  });
  await page.route("**/api/reviews/preview", async (route) => {
    previewRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      json: {
        title: "empty repository..main",
        range: {
          kind: "whole_repository",
          baseRef: {
            kind: "empty_tree",
            value: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            displayName: "empty repository",
          },
          headRef: { kind: "branch", value: "main" },
        },
        baseSha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        headSha: "d".repeat(40),
        worktreeFingerprint: null,
        baseRefDisplay: "empty repository",
        headRefDisplay: "main",
        diffSummary: {
          fileCount: 1,
          additions: 1,
          deletions: 0,
          binaryFileCount: 0,
          renameCount: 0,
        },
        files: [
          {
            path: "README.md",
            oldPath: null,
            status: "added",
            isBinary: false,
            additions: 1,
            deletions: 0,
            oldMode: null,
            newMode: "100644",
            renameMetadata: null,
            hunks: [],
          },
        ],
      },
    });
  });

  await page.goto("/reviews/new");
  await page.getByRole("button", { name: "Whole repo" }).click();
  await page.getByLabel("Head ref", { exact: true }).fill("main");
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByText("empty repository..main").first()).toBeVisible();
  expect(previewRequests).toEqual([
    {
      repositoryId: "repo_1",
      comparisonMode: "whole_repository",
      headRef: "main",
    },
  ]);
  await expect(page.getByText("Untracked files are excluded from worktree reviews.")).toHaveCount(
    0,
  );
});
