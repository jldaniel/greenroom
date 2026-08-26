import { expect, test } from "./fixtures/playwright";
import { setupTeachingPersistence } from "./fixtures/teaching-persistence";

test("hydrates a persisted teaching run after reload without narrow-viewport overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await setupTeachingPersistence(page);

  await page.goto("/reviews/GR-1/teach");
  await expect(page.getByRole("heading", { name: "Teach" })).toBeVisible();

  await expect(page.getByText("Persisted teaching summary for the full PR.")).toBeVisible();
  await expect(page.getByText("Review the exported value")).toBeVisible();
  await expect(page.getByText("No teaching run")).toHaveCount(0);
  await expect(page.getByText("0 of 1 answered")).toBeVisible();

  const conversation = page.getByTestId("follow-up-conversation");
  await expect(conversation.getByText("Why start there?")).toBeVisible();
  await expect(
    conversation.getByText("Start with the changed line, then inspect nearby context."),
  ).toBeVisible();

  const teachingOverflow = await page.locator("body").evaluate((body) => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(body.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const overflowX = getComputedStyle(element).overflowX;

        return {
          className: element.className,
          clientWidth: element.clientWidth,
          overflowX,
          right: Math.round(rect.right),
          scrollWidth: element.scrollWidth,
          tagName: element.tagName,
          text: element.textContent?.trim().slice(0, 80) ?? "",
        };
      })
      .filter(
        (element) =>
          (element.scrollWidth > element.clientWidth + 1 &&
            !["auto", "clip", "hidden", "scroll"].includes(element.overflowX)) ||
          element.right > viewportWidth + 1,
      )
      .sort((left, right) => right.scrollWidth - left.scrollWidth)
      .slice(0, 12);

    return {
      clientWidth: body.clientWidth,
      offenders,
      scrollWidth: body.scrollWidth,
    };
  });
  expect(teachingOverflow.offenders).toEqual([]);
  expect(teachingOverflow.scrollWidth).toBeLessThanOrEqual(teachingOverflow.clientWidth + 1);

  const overflowingConversationText = await conversation
    .locator("p")
    .evaluateAll(
      (paragraphs) =>
        paragraphs.filter((paragraph) => paragraph.scrollWidth > paragraph.clientWidth + 1).length,
    );
  expect(overflowingConversationText).toBe(0);
});

test("continues a persisted follow-up conversation after reload", async ({ page }) => {
  await setupTeachingPersistence(page);

  await page.goto("/reviews/GR-1/teach");

  const conversation = page.getByTestId("follow-up-conversation");
  await expect(conversation.getByText("Why start there?")).toBeVisible();
  await expect(
    conversation.getByText("Start with the changed line, then inspect nearby context."),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Follow-up" }).fill("Does this survive restarts?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(
    conversation.getByText("Does this survive restarts?", { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByText("Post-restart answer to: Does this survive restarts?"),
  ).toBeVisible();
});

test("promotes a persisted teaching point after reload and shows it in the workspace", async ({
  page,
}) => {
  const { anchor, state } = await setupTeachingPersistence(page);

  await page.goto("/reviews/GR-1/teach");
  await expect(page.getByText("Review the exported value")).toBeVisible();

  await page.getByTitle("Promote to thread").click();
  await expect(page.getByText("Promoted to thread GT-1")).toBeVisible();
  expect(state.promoteRequest).toEqual({
    runId: "workflow_run_1",
    profileId: "profile_teaching",
    title: "Review the exported value",
    body: "Check that the new export matches the surrounding module intent.",
    anchor,
  });

  await page.getByRole("link", { name: "Back to workspace" }).click();
  await expect(page).toHaveURL(/\/reviews\/GR-1$/);
  await expect(page.getByRole("tab", { name: "Threads" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Review the exported value").first()).toBeVisible();
});
