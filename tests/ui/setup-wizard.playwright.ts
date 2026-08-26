import { expect, test, type Page } from "./fixtures/playwright";

import type { HarnessSetupSmokeResponse, HarnessStatusResponse, Profile } from "@greenroom/schemas";

const now = "2026-07-01T12:00:00.000Z";
const plaintextToken = "greenroom_playwright_setup_token";

interface RepositoryFixture {
  id: string;
  rootPath: string;
  gitCommonDir: string;
  identityKey: string;
  displayName: string;
  defaultBranchCandidate: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function repositoryFixture(overrides: Partial<RepositoryFixture> = {}): RepositoryFixture {
  return {
    id: "repo_1",
    rootPath: "/work/greenroom",
    gitCommonDir: "/work/greenroom/.git",
    identityKey: "/work/greenroom/.git",
    displayName: "Greenroom",
    defaultBranchCandidate: "main",
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function harnessStatusFixture(): HarnessStatusResponse {
  return {
    configured: true,
    baseUrl: "http://127.0.0.1:49343",
    healthy: true,
    runtimeMode: "bridge",
    availableKinds: [],
    harnesses: [],
    detectedHarnesses: [
      {
        kind: "claude-code",
        label: "Claude Code",
        command: "claude",
        found: true,
        path: "/usr/local/bin/claude",
        version: "claude 2.1.0",
        lastVerifiedVersion: null,
        recommendSmoke: true,
        probedAt: now,
        message: null,
      },
      {
        kind: "codex",
        label: "Codex",
        command: "codex",
        found: false,
        path: null,
        version: null,
        lastVerifiedVersion: null,
        recommendSmoke: false,
        probedAt: now,
        message: "codex was not found on PATH",
      },
    ],
    errorMessage: null,
  };
}

function profilesFixture(): Profile[] {
  return [
    {
      id: "profile_1",
      name: "Claude Code reviewer",
      workflowType: "builtin_review",
      provider: "harness",
      model: "claude-code",
      description: "Seeded from the detected Claude Code CLI on this machine.",
      systemPrompt: null,
      modelSettings: { harness: { kind: "claude-code" } },
      allowedTools: [],
      contextPreferences: {},
      privacy: { persistTranscript: false, consentMode: "one_click" },
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Routes shared by the wizard tests. `/api/repositories` enforces bearer
 * auth so the tokenless first load probes a real 401 (which is what
 * auto-launches the wizard) while post-token requests succeed.
 */
async function routeWizardApi(
  page: Page,
  options: { repositories: RepositoryFixture[] },
): Promise<{ setupTokenRequests: () => number }> {
  const repositories = options.repositories;
  let setupTokenRequests = 0;

  await page.route("**/api/repositories", async (route) => {
    const request = route.request();
    const authorization = request.headers()["authorization"];

    if (authorization === undefined) {
      await route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Missing bearer token" } },
      });
      return;
    }

    if (request.method() === "POST") {
      const body = request.postDataJSON() as { rootPath: string; displayName?: string };
      repositories.push(
        repositoryFixture({
          id: `repo_${repositories.length + 1}`,
          rootPath: body.rootPath,
          displayName: body.displayName ?? body.rootPath,
        }),
      );
      await route.fulfill({ status: 201, json: { repository: repositories.at(-1) } });
      return;
    }

    await route.fulfill({ json: { repositories } });
  });

  await page.route("**/api/setup/tokens", async (route) => {
    setupTokenRequests += 1;
    await route.fulfill({
      status: 201,
      json: {
        token: {
          id: "token_1",
          name: "Local browser admin",
          scopes: ["admin"],
          createdAt: now,
          lastUsedAt: null,
          revokedAt: null,
        },
        plaintextToken,
      },
    });
  });

  await page.route("**/api/harness/status", async (route) => {
    await route.fulfill({ json: harnessStatusFixture() });
  });

  await page.route("**/api/harness/setup-smoke", async (route) => {
    const response: HarnessSetupSmokeResponse = {
      workflowKind: "setup_smoke",
      harnessKind: "claude-code",
      status: "passed",
      message: "Setup smoke passed: the harness executed a bridge run.",
      checks: [
        { name: "cli", status: "passed", summary: "claude 2.1.0 responded" },
        { name: "harness", status: "passed", summary: "Bridge run returned a valid report." },
      ],
      diagnostics: [],
    };
    await route.fulfill({ json: response });
  });

  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: profilesFixture() } });
  });

  await page.route("**/api/reviews**", async (route) => {
    await route.fulfill({ json: { reviews: [] } });
  });

  await page.route("**/api/tokens", async (route) => {
    await route.fulfill({ json: { tokens: [] } });
  });

  return { setupTokenRequests: () => setupTokenRequests };
}

test("fresh tokenless load auto-launches the wizard and walks every step", async ({ page }) => {
  await routeWizardApi(page, { repositories: [] });

  // No stored token: the unauthenticated probe 401s and the app routes to
  // the wizard instead of raw error banners.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up Greenroom" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create a local API token" })).toBeVisible();

  // Step 1: create the token; the wizard stores it and advances.
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByRole("heading", { name: "Register a repository" })).toBeVisible();

  const storedToken = await page.evaluate(() => window.localStorage.getItem("greenroom.apiToken"));
  expect(storedToken).toBe(plaintextToken);

  // Step 2: register a repository through the reused registry panel; the
  // wizard advances when the registration succeeds.
  await page.getByPlaceholder("/Users/you/code/project").fill("/work/greenroom");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "Detect coding harnesses" })).toBeVisible();

  // Step 3: detection results render per kind; the smoke check is offered
  // for found harnesses and presented as non-blocking.
  await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
  await expect(page.getByText("claude 2.1.0", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex", { exact: true })).toBeVisible();
  await expect(page.getByText("Not found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run smoke check" }).click();
  await expect(page.getByText(/Setup smoke passed/)).toBeVisible();
  await expect(page.getByText(/non-blocking/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: seeded profiles summary with descriptions.
  await expect(page.getByRole("heading", { name: "Seeded profiles" })).toBeVisible();
  await expect(page.getByText("Claude Code reviewer")).toBeVisible();
  await expect(page.getByText("Seeded from the detected Claude Code CLI")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5: finishing lands on the dashboard and persists completion.
  await expect(page.getByRole("heading", { name: "Create your first review" })).toBeVisible();
  await page.getByRole("button", { name: "Finish and open dashboard" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();

  const completionState = await page.evaluate(() =>
    window.localStorage.getItem("greenroom.setupWizard"),
  );
  expect(completionState).toBe("completed");

  // With a stored token the wizard no longer intercepts reloads.
  await page.reload();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
});

test("no-harness detection shows the Pi fallback command", async ({ page }) => {
  await routeWizardApi(page, { repositories: [repositoryFixture()] });
  await page.route("**/api/harness/status", async (route) => {
    const status = harnessStatusFixture();
    status.detectedHarnesses = status.detectedHarnesses.map((harness) => ({
      ...harness,
      found: false,
      path: null,
      version: null,
    }));
    await route.fulfill({ json: status });
  });

  await page.addInitScript((token) => {
    window.localStorage.setItem("greenroom.apiToken", token);
  }, plaintextToken);

  await page.goto("/setup");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Detect coding harnesses" })).toBeVisible();
  await expect(page.getByText("No harness CLI detected")).toBeVisible();
  await expect(page.getByText("greenroom harness install-pi")).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-check" })).toBeVisible();
});

test("skip setup lands on the dashboard and persists the skip", async ({ page }) => {
  await routeWizardApi(page, { repositories: [] });

  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");

  const completionState = await page.evaluate(() =>
    window.localStorage.getItem("greenroom.setupWizard"),
  );
  expect(completionState).toBe("skipped");
});

test("settings re-runs the wizard with existing state reflected", async ({ page }) => {
  await routeWizardApi(page, { repositories: [repositoryFixture()] });

  await page.addInitScript((token) => {
    window.localStorage.setItem("greenroom.apiToken", token);
    window.localStorage.setItem("greenroom.setupWizard", "completed");
  }, plaintextToken);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Setup wizard" })).toBeVisible();
  await expect(page.getByText("Completed on this browser.")).toBeVisible();

  await page.getByRole("link", { name: "Run setup wizard" }).click();
  await expect(page).toHaveURL(/\/setup$/);

  // Token step reports the existing token instead of forcing re-creation.
  await expect(page.getByText(/Token configured \(source: browser\)/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Repository step lists what already exists.
  await expect(page.getByRole("heading", { name: "Register a repository" })).toBeVisible();
  await expect(page.getByText("/work/greenroom").first()).toBeVisible();
});
