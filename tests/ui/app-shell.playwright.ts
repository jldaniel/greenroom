import { expect, test } from "./fixtures/playwright";

test("loads the app shell and basic navigation", async ({ page }) => {
  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [] } });
  });
  await page.route("**/api/reviews**", async (route) => {
    await route.fulfill({ json: { reviews: [] } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [] } });
  });

  await page.goto("/");

  await expect(page.getByRole("banner")).toContainText("Greenroom");
  await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();

  const navigation = page.getByLabel("Primary navigation");

  await navigation.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Create Review" })).toBeVisible();

  await navigation.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#101412");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keeps unbroken review and repository metadata inside cards", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });

  const now = "2026-08-25T12:00:00.000Z";
  const longToken = `long-${"metadata".repeat(64)}`;
  const repository = {
    id: "repo_1",
    rootPath: `/work/${longToken}`,
    gitCommonDir: `/work/${longToken}/.git`,
    identityKey: `/work/${longToken}/.git`,
    displayName: `Repository-${longToken}`,
    defaultBranchCandidate: `feature/${longToken}`,
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const review = {
    displayId: "GR-1",
    repositoryId: repository.id,
    title: `Review-${longToken}`,
    range: {
      kind: "branch_to_branch",
      baseRef: { kind: "branch", value: `base/${longToken}` },
      headRef: { kind: "branch", value: `head/${longToken}` },
    },
    baseRefDisplay: `base/${longToken}`,
    headRefDisplay: `head/${longToken}`,
    currentRevisionId: null,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  await page.route("**/api/repositories", async (route) => {
    await route.fulfill({ json: { repositories: [repository] } });
  });
  await page.route("**/api/reviews**", async (route) => {
    await route.fulfill({
      json: { reviews: [{ review, repository, currentRevision: null }] },
    });
  });

  await page.goto("/");
  await expect(page.getByText(review.title)).toBeVisible();

  const overflow = await page.locator("body").evaluate((body) => ({
    bodyClientWidth: body.clientWidth,
    bodyScrollWidth: body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    overflowWrap: getComputedStyle(body).overflowWrap,
    overflowingCards: Array.from(document.querySelectorAll("article")).filter(
      (card) => card.scrollWidth > card.clientWidth + 1,
    ).length,
  }));

  expect(overflow.overflowWrap).toBe("anywhere");
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth + 1);
  expect(overflow.overflowingCards).toBe(0);
});
