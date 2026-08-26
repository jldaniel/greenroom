import { expect, test } from "./fixtures/playwright";
import { setupSpotlightTest } from "./fixtures/spotlight";

test("starts one-click generation only after confirming its consent payload", async ({ page }) => {
  const { state } = await setupSpotlightTest(page, { initialViews: false });

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await page.getByRole("button", { name: "Generate" }).click();

  const dialog = page.getByRole("dialog", { name: "Start Spotlight run" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Default spotlight")).toBeVisible();
  await expect(dialog.getByText("All changed files (1 file)")).toBeVisible();
  expect(state.requests.spotlightRun).toBeNull();

  await dialog.getByRole("button", { name: "Confirm & run" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Implementation changes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Runtime flow/ })).toBeVisible();
  await expect(page.locator('section[aria-label="src/index.ts"]')).toBeVisible();
  expect(state.requests.spotlightRun).toMatchObject({
    type: "generate",
    trigger: "manual",
    revisionId: "revision_1",
    profileId: "profile_1",
    start: true,
  });
});

test("shows view markers and filters the diff to uncovered lines", async ({ page }) => {
  await setupSpotlightTest(page);

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await expect(page.getByRole("heading", { name: "Implementation changes" })).toBeVisible();

  const rows = page.locator('section[aria-label="src/index.ts"] tbody tr');
  await expect(rows.nth(2)).toHaveClass(/spotlight-line-lit/);
  await expect(rows.nth(3)).toHaveClass(/spotlight-line-unlit/);

  await page.getByRole("button", { name: /^Coverage/ }).click();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.getByText("Changed lines that are not lit by any current View.")).toBeVisible();
  await expect(rows.nth(3)).toHaveClass(/spotlight-line-lit/);
  await expect(rows.nth(2)).toHaveClass(/spotlight-line-unlit/);

  await page.getByRole("button", { name: /Implementation changes/ }).click();
  await expect(page.getByRole("heading", { name: "Implementation changes" })).toBeVisible();
  await expect(rows.nth(2)).toHaveClass(/spotlight-line-lit/);

  await page
    .getByRole("button", { name: "Show 2 Spotlight views for src/index.ts line 2" })
    .click();
  await page
    .locator('section[aria-label="src/index.ts"]')
    .getByRole("button", { name: /Runtime flow/ })
    .click();
  await expect(page.getByRole("heading", { name: "Runtime flow" })).toBeVisible();
  await expect(rows.nth(2)).toHaveClass(/diff-line-focused/);
});

test("navigates across surfaces and restores the selected Spotlight view", async ({ page }) => {
  await setupSpotlightTest(page);

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await page.getByRole("tab", { name: "Threads" }).click();

  await page
    .getByRole("button", { name: "Show 2 Spotlight views for src/index.ts line 2" })
    .click();
  await page
    .locator('section[aria-label="src/index.ts"]')
    .getByRole("button", { name: /Implementation changes/ })
    .click();
  await expect(page.getByRole("tab", { name: "Spotlight" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Implementation changes" })).toBeVisible();
  await expect(page.locator('section[aria-label="src/index.ts"] tbody tr').nth(2)).toHaveClass(
    /diff-line-focused/,
  );

  await page.locator('a[href="/reviews/GR-1/teach?view=SV-1"]').click();
  await expect(page).toHaveURL(/\/reviews\/GR-1\/teach\?view=SV-1$/);
  await expect(page.getByRole("heading", { name: "Teach" })).toBeVisible();
  await expect(page.getByText("Spotlight View - Implementation changes")).toBeVisible();

  await page.getByRole("link", { name: "Back to workspace" }).click();
  await expect(page.getByRole("tab", { name: "Spotlight" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Implementation changes" })).toBeVisible();
});

test("starts teaching with consent scoped to the selected Spotlight view", async ({ page }) => {
  const { state } = await setupSpotlightTest(page);

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await page.locator('a[href="/reviews/GR-1/teach?view=SV-1"]').click();
  await expect(page).toHaveURL(/\/reviews\/GR-1\/teach\?view=SV-1$/);
  await expect(page.getByText("Spotlight View - Implementation changes")).toBeVisible();

  await page.getByRole("button", { name: "Teach", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start teaching run" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Spotlight View - Implementation changes (1 file)")).toBeVisible();
  expect(state.requests.teachingConsent).toBeNull();

  await dialog.getByRole("button", { name: "Confirm & teach" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Waiting for teaching output")).toBeVisible();
  expect(state.requests.teachingConsent).toMatchObject({
    profileId: "profile_teaching",
    revisionId: "revision_1",
    scope: { kind: "spotlight_view", viewRef: "SV-1" },
    maxApproximateTokens: 16_000,
    start: true,
  });
});

test("records thread provenance and opens Spotlight view deep links", async ({ page }) => {
  const { state } = await setupSpotlightTest(page);

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await page.getByRole("button", { name: "Start thread on head line 2" }).click();
  await page.getByLabel("Comment").fill("Check this scoped change.");
  await page.getByRole("button", { name: "Create thread" }).click();

  await expect(page.locator("#thread-GT-1").getByText("Check this scoped change.")).toBeVisible();
  expect(state.requests.createdThreadSource?.metadata).toMatchObject({
    spotlightViewRef: "SV-1",
    spotlightViewTitle: "Implementation changes",
  });

  await page.goto("/reviews/GR-1?view=SV-2");
  await expect(page.getByRole("tab", { name: "Spotlight" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: /Runtime flow/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByText("SV-2").first()).toBeVisible();
});

test("walks gated plan approval through the Scope → Plan → Views stepper", async ({ page }) => {
  const { state } = await setupSpotlightTest(page, {
    consentMode: "two_step",
    initialViews: false,
  });

  await page.goto("/reviews/GR-1");
  await page.getByRole("tab", { name: "Spotlight" }).click();
  await page.getByRole("button", { name: "Generate" }).click();

  const steps = page.getByRole("list", { name: "Spotlight run steps" });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveText(["1Scope", "2Plan", "3Views"]);
  await expect(steps.getByRole("listitem").nth(0)).toHaveAttribute("aria-current", "step");
  expect(state.requests.spotlightRun).toMatchObject({ type: "generate", gated: true });

  await page.getByRole("button", { name: "Approve Context" }).click();
  await expect(steps.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "step");
  await expect(steps.getByRole("listitem").nth(0)).toHaveText("Scope");
  await expect(page.getByText("Source changes that carry the reviewed behavior.")).toBeVisible();
  await expect(page.getByLabel("Refinement")).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(steps).toHaveCount(0);
  await expect(page.getByText("Views generated")).toBeVisible();
  await expect(page.getByRole("button", { name: /Implementation changes/ })).toBeVisible();
});
