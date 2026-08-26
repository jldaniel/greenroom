import { expect, test, type Page } from "./fixtures/playwright";

const now = "2026-07-01T12:00:00.000Z";
const plaintextToken = "greenroom_playwright_connect_token";
const staleToken = "greenroom_playwright_revoked_token";

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

/**
 * Routes for the central 401 connect prompt: the data endpoints
 * accept only `acceptedToken`, so tokenless or stale-token loads 401 and the
 * connect/reconnect prompt replaces the raw error banners. The setup-token
 * endpoint mints `plaintextToken` (the server allows post-bootstrap loopback
 * minting) unless `setupTokenStatus` overrides it with a failure.
 */
async function routeConnectApi(
  page: Page,
  options: { acceptedToken: string; setupTokenStatus?: number },
): Promise<{ setupTokenRequests: () => number }> {
  let setupTokenRequests = 0;
  const authorized = (authorization: string | undefined) =>
    authorization === `Bearer ${options.acceptedToken}`;

  await page.route("**/api/repositories", async (route) => {
    if (!authorized(route.request().headers()["authorization"])) {
      await route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Bearer token is invalid or revoked" } },
      });
      return;
    }

    await route.fulfill({ json: { repositories: [repositoryFixture] } });
  });

  await page.route("**/api/reviews**", async (route) => {
    if (!authorized(route.request().headers()["authorization"])) {
      await route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Bearer token is invalid or revoked" } },
      });
      return;
    }

    await route.fulfill({ json: { reviews: [] } });
  });

  await page.route("**/api/setup/tokens", async (route) => {
    setupTokenRequests += 1;

    if (options.setupTokenStatus !== undefined && options.setupTokenStatus !== 201) {
      await route.fulfill({
        status: options.setupTokenStatus,
        json: {
          error: {
            code: "forbidden",
            message: "Setup token creation after the first token is limited to loopback clients.",
          },
        },
      });
      return;
    }

    await route.fulfill({
      status: 201,
      json: {
        token: {
          id: "token_2",
          name: "Browser",
          scopes: ["admin"],
          createdAt: now,
          lastUsedAt: null,
          revokedAt: null,
        },
        plaintextToken,
      },
    });
  });

  return { setupTokenRequests: () => setupTokenRequests };
}

test("tokenless 401s show the connect prompt and one click yields a working page", async ({
  page,
}) => {
  const routes = await routeConnectApi(page, { acceptedToken: plaintextToken });

  // A tokenless full load auto-launches the wizard; skipping it
  // lands on the dashboard, whose queries 401 without a token.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");

  // Instead of raw 401 error banners the panels show the connect prompt.
  await expect(page.getByText("Connect to Greenroom").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // One click mints a token through the setup endpoint, stores it, and
  // refetches the failed queries: the dashboard just works.
  await page.getByRole("button", { name: "Create access token" }).first().click();
  await expect(page.getByRole("heading", { name: "Greenroom", exact: true })).toBeVisible();
  await expect(page.getByText("/work/greenroom")).toBeVisible();
  await expect(page.getByText("Connect to Greenroom")).toHaveCount(0);

  const storedToken = await page.evaluate(() => window.localStorage.getItem("greenroom.apiToken"));
  expect(storedToken).toBe(plaintextToken);
  expect(routes.setupTokenRequests()).toBe(1);
});

test("a rejected stored token shows an honest reconnect action instead of silent replacement", async ({
  page,
}) => {
  await routeConnectApi(page, { acceptedToken: plaintextToken });
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("greenroom.apiToken", token);
      window.localStorage.setItem("greenroom.setupWizard", "completed");
    },
    { token: staleToken },
  );

  await page.goto("/");

  // The stored token 401s: an honest alert with an explicit reconnect action
  // renders, and the stale token stays in place until the user acts.
  await expect(page.getByText("Stored API token was rejected").first()).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("greenroom.apiToken"))).toBe(
    staleToken,
  );

  await page.getByRole("button", { name: "Reconnect" }).first().click();
  await expect(page.getByText("/work/greenroom")).toBeVisible();
  await expect(page.getByText("Stored API token was rejected")).toHaveCount(0);

  const storedToken = await page.evaluate(() => window.localStorage.getItem("greenroom.apiToken"));
  expect(storedToken).toBe(plaintextToken);
});

test("failed minting falls back to paste-a-token guidance with the CLI hint", async ({ page }) => {
  await routeConnectApi(page, { acceptedToken: plaintextToken, setupTokenStatus: 403 });

  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Skip setup" }).click();

  await expect(page.getByText("Connect to Greenroom").first()).toBeVisible();
  await page.getByRole("button", { name: "Create access token" }).first().click();

  await expect(page.getByText(/greenroom token create/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open setup wizard" }).first()).toBeVisible();
});
