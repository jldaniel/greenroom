import { expect, test } from "./fixtures/playwright";
import { setupTeachingTest } from "./fixtures/teaching";

test("uses the dedicated route, two-step consent, and durable teaching output", async ({
  page,
}) => {
  const { state } = await setupTeachingTest(page);

  await page.goto("/reviews/GR-1");

  await expect(page.getByRole("tab", { name: "Threads" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Teach" })).toHaveCount(0);
  await expect(page.getByText("No teaching run")).toHaveCount(0);

  await page.getByRole("link", { name: "Teach" }).click();
  await expect(page).toHaveURL(/\/reviews\/GR-1\/teach$/);
  await expect(page.getByRole("heading", { name: "Teach" })).toBeVisible();
  await expect(page.getByText("Full PR (1 file)")).toBeVisible();

  await page.getByRole("button", { name: "Prepare" }).click();
  await expect(page.getByText("pending consent")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Start teaching run" })).toHaveCount(0);
  expect(state.requests.consent).toMatchObject({
    profileId: "profile_teaching",
    revisionId: "revision_1",
    scope: { kind: "full_pr" },
    maxApproximateTokens: 16_000,
  });
  expect(state.requests.consent?.start).toBeUndefined();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Mock teaching summary for the full PR.")).toBeVisible();
  await expect(page.getByText("The change adds a small exported value.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Mock teaching summary for the full PR.")).toBeVisible();
  await expect(page.getByText("The change adds a small exported value.")).toBeVisible();
});

test("resolves teaching excerpts and renders Mermaid success and fallback states", async ({
  page,
}) => {
  await setupTeachingTest(page, { initialRun: "completed" });
  await page.goto("/reviews/GR-1/teach");
  await expect(page.getByText("Mock teaching summary for the full PR.")).toBeVisible();

  const excerpts = page.getByTestId("teaching-excerpt");
  await expect(excerpts).toHaveCount(2);
  await expect(excerpts.first()).toContainText("src/other.ts:1 (head)");
  await expect(excerpts.first()).toContainText("export const other = true;");
  await expect(page.getByTestId("teaching-excerpt-unavailable")).toContainText(
    "src/other.ts:900-901 (head)",
  );

  const renderedDiagram = page.locator(
    '[data-testid="teaching-diagram"][data-diagram-state="rendered"]',
  );
  await expect(renderedDiagram).toContainText("Export flow");
  const mermaidSvg = renderedDiagram.locator('svg[id^="teaching-diagram-svg"]');
  await expect(mermaidSvg).toBeVisible();
  await expect(mermaidSvg).toContainText("consumers");
  await expect(renderedDiagram.locator("pre")).toHaveCount(0);

  const fallbackDiagram = page.locator(
    '[data-testid="teaching-diagram"][data-diagram-state="fallback"]',
  );
  await expect(fallbackDiagram).toContainText("Broken diagram");
  await expect(fallbackDiagram.locator("pre")).toContainText("this is not mermaid syntax");
  await expect(fallbackDiagram).toContainText("could not be rendered");
  await expect(fallbackDiagram.locator('svg[id^="teaching-diagram-svg"]')).toHaveCount(0);
});

test("scores the teaching quiz and aggregates missed concepts", async ({ page }) => {
  await setupTeachingTest(page, { initialRun: "completed" });
  await page.goto("/reviews/GR-1/teach");
  await expect(page.getByText("Mock teaching summary for the full PR.")).toBeVisible();

  await page.getByRole("button", { name: "The changed lines and nearby context" }).click();
  await expect(page.getByText("Correct")).toBeVisible();
  await expect(page.getByTestId("quiz-score-summary")).toHaveCount(0);

  await page.getByRole("button", { name: "Every module in the repository" }).click();
  await expect(page.getByText("Review this concept")).toBeVisible();
  await expect(page.getByTestId("quiz-score-summary")).toContainText("Score: 1/2");
  await expect(page.getByTestId("quiz-missed-concepts")).toContainText(
    "Trace new exports to their consumers.",
  );
  await expect(page.getByTestId("quiz-missed-concepts")).toContainText(
    "Exports are part of the module contract.",
  );
});

test("orders follow-up conversation and promotes teaching provenance to the workspace", async ({
  page,
}) => {
  const { anchor, state } = await setupTeachingTest(page, { initialRun: "completed" });
  await page.goto("/reviews/GR-1/teach");
  await expect(page.getByText("Mock teaching summary for the full PR.")).toBeVisible();

  await page.getByRole("textbox", { name: "Follow-up" }).fill("Why start there?");
  await page.getByRole("button", { name: "Ask" }).click();
  const conversation = page.getByTestId("follow-up-conversation");
  await expect(conversation.getByText("Why start there?")).toBeVisible();
  await expect(conversation.getByText("Start with the changed line")).toBeVisible();
  await expect(conversation.getByRole("listitem")).toContainText(
    /Why start there\?[\s\S]*Start with the changed line/u,
  );
  expect(state.requests.followUp).toEqual({ question: "Why start there?" });

  await page.getByTitle("Promote to thread").click();
  await expect(page.getByText("Promoted to thread GT-1")).toBeVisible();
  expect(state.requests.promotion).toMatchObject({
    runId: "workflow_run_1",
    profileId: "profile_teaching",
    title: "Review the exported value",
    body: "Check that the new export matches the surrounding module intent.",
    anchor,
  });
  expect(state.threads[0]?.source).toEqual({
    kind: "teaching",
    displayName: "Teaching",
    profileId: "profile_teaching",
    metadata: { title: "Review the exported value" },
  });

  await page.getByRole("link", { name: "Back to workspace" }).click();
  await expect(page).toHaveURL(/\/reviews\/GR-1$/);
  await expect(page.getByRole("tab", { name: "Threads" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Review the exported value").first()).toBeVisible();
  await page.getByRole("button", { name: "Go to GT-1" }).click();
  await expect(page.locator("#thread-GT-1")).toBeVisible();
});
