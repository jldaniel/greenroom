import { expect, test, type Page } from "../ui/fixtures/playwright";

import { liveFixture, startLiveStack, type LiveStack } from "./stack";

/**
 * Exercises the core review loop against a REAL running stack.
 * No page.route mocking anywhere in this suite — the browser talks to the
 * live API server (which also serves the built web app), the API talks to
 * the live harness bridge, and the bridge executes the mock coding-agent CLI
 * against a real temporary git repository:
 *
 *   create review -> inline comment thread -> AI review run (mock harness)
 *   -> approve draft findings -> finding thread visible in the workspace.
 */
let stack: LiveStack;

test.beforeAll(async () => {
  stack = await startLiveStack();
});

test.afterAll(async () => {
  await stack?.stop();
});

test("core review loop runs against the live API with a mock harness", async ({ page }) => {
  // Connect the browser with the admin token minted through the real
  // loopback setup-token endpoint; skip the first-run wizard.
  await connectBrowser(page);

  // --- Create a review against the real git fixture repository ---
  await createReview(page, "Live core loop review", /\/reviews\/GR-\d+$/);

  // The workspace renders the real diff of the fixture commit.
  await expect(page.getByRole("heading", { name: "Live core loop review" })).toBeVisible();
  const fileSection = page.locator(`section[aria-label="${liveFixture.changedFile}"]`);
  await expect(fileSection).toBeVisible();
  await expect(fileSection.getByText("const value = 42;")).toBeVisible();

  // --- Add an inline comment thread on a changed line ---
  const startHandle = page.getByRole("button", { name: "Start thread on head line 2" });
  await startHandle.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Thread type").selectOption("issue");
  await page.getByLabel("Severity").selectOption("minor");
  await page.getByLabel("Comment").fill("Live comment: double-check this constant.");
  await page.getByRole("button", { name: "Create thread" }).click();
  await expect(page.getByText("Live comment: double-check this constant.").first()).toBeVisible();

  // The thread is durable server state, not UI state: it survives a reload.
  await page.reload();
  await expect(page.getByText("Live comment: double-check this constant.").first()).toBeVisible();

  // --- Run the AI review happy path through the mock harness ---
  await page.getByRole("tab", { name: "AI Review" }).click();
  await page.getByLabel("Profile").selectOption({ label: stack.reviewerProfileName });
  await page.getByRole("button", { name: "Prepare consent" }).click();
  await expect(page.getByRole("button", { name: "Approve run" })).toBeVisible({
    timeout: 30_000,
  });
  await openRunDetails(page);
  await page.getByRole("button", { name: "Approve run" }).click();

  // The bridge executes the mock coding-agent CLI through the real
  // claude-code stream-json preset. Details should update before the final
  // schema-bound result lands.
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Harness events", { exact: true })).toBeVisible();
  await expect(page.getByText("Mock live harness is loading review context.").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Reviewing changed lines with the live mock harness.").first(),
  ).toBeVisible({ timeout: 30_000 });

  // The mock reads the review through the API with its run-scoped grant and
  // returns draft findings.
  await expect(page.getByText("Verify the computed answer", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("Draft findings are validated")).toBeVisible();

  // Draft approval creates the finding thread through the real API.
  await page.getByRole("button", { name: "Approve all" }).click();
  await expect(page.getByText("Created threads: GT-2")).toBeVisible({ timeout: 30_000 });

  // --- The finding lands as an ordinary review thread in the workspace ---
  await page.getByRole("tab", { name: "Threads" }).click();
  await expect(page.getByText("Verify the computed answer").first()).toBeVisible();
  await expect(page.getByText("Live comment: double-check this constant.").first()).toBeVisible();
});

test("silent live mock fails with idle timeout and keeps partial harness events", async ({
  page,
}) => {
  await connectBrowser(page);
  const reviewDisplayId = await createReview(
    page,
    "Silent idle timeout review",
    /\/reviews\/GR-\d+$/,
  );

  await page.getByRole("tab", { name: "AI Review" }).click();
  await page.getByLabel("Profile").selectOption({ label: stack.silentProfileName });
  await page.getByRole("button", { name: "Prepare consent" }).click();
  await expect(page.getByRole("button", { name: "Approve run" })).toBeVisible({
    timeout: 30_000,
  });
  await openRunDetails(page);
  await page.getByRole("button", { name: "Approve run" }).click();

  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Mock live harness entered silent mode after initial activity.").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Workflow idle timeout after/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("link", { name: "Open partial transcript" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

  const runs = await apiGet<{ runs: Array<{ id: string; status: string; metadata: unknown }> }>(
    `/api/reviews/${reviewDisplayId}/workflow-runs`,
  );
  const run = runs.runs.find((candidate) => candidate.status === "failed");

  expect(run).toBeTruthy();
  expect(run?.metadata).toMatchObject({ timeoutKind: "idle_timeout" });

  const eventPayload = await apiGet<{
    events: Array<{ kind: string; summary: string; text: string | null }>;
  }>(`/api/workflow-runs/${run!.id}/events?since=0`);

  expect(eventPayload.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "assistant_text",
        text: "Mock live harness entered silent mode after initial activity.",
      }),
    ]),
  );

  const transcripts = await apiGet<{ transcripts: Array<{ status: string }> }>(
    `/api/workflow-runs/${run!.id}/transcripts`,
  );
  expect(transcripts.transcripts.length).toBeGreaterThan(0);
});

async function connectBrowser(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("greenroom.apiToken", token);
      window.localStorage.setItem("greenroom.setupWizard", "completed");
    },
    { token: stack.adminToken },
  );
}

async function createReview(page: Page, title: string, expectedUrl: RegExp): Promise<string> {
  await page.goto(`${stack.baseUrl}/reviews/new`);
  await page.getByLabel("Repository").selectOption(stack.repositoryId);
  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabel("Base ref", { exact: true }).fill(liveFixture.baseBranch);
  await page.getByLabel("Head ref").fill(liveFixture.headBranch);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Preview" }).click();
  // The preview is computed by the API from the real repository.
  await expect(page.getByText(liveFixture.changedFile).first()).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(expectedUrl);
  const displayId = /\/reviews\/(GR-\d+)$/u.exec(page.url())?.[1];

  if (displayId === undefined) {
    throw new Error(`Could not read review display id from URL ${page.url()}`);
  }

  return displayId;
}

async function openRunDetails(page: Page): Promise<void> {
  await page.getByText("Details", { exact: true }).click();
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${stack.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${stack.adminToken}` },
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}
