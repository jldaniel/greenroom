import { expect, test } from "./fixtures/playwright";

import {
  codexHarnessKindDescriptor,
  type HarnessModelCatalog,
  type HarnessStatusResponse,
  type Profile,
} from "@greenroom/schemas";

const now = "2026-07-09T12:00:00.000Z";

const harnessStatus: HarnessStatusResponse = {
  configured: false,
  baseUrl: "http://127.0.0.1:49343",
  healthy: false,
  runtimeMode: "disabled",
  availableKinds: [],
  harnesses: [],
  detectedHarnesses: [],
  errorMessage: null,
};

test("AI profile save reports success and failure", async ({ page }) => {
  let profile: Profile = {
    id: "profile_1",
    name: "Mock reviewer",
    workflowType: "builtin_review",
    provider: "mock",
    model: "mock",
    description: null,
    systemPrompt: null,
    modelSettings: {},
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode: "one_click" },
    createdAt: now,
    updatedAt: now,
  };
  let failSave = false;

  await page.addInitScript(() => {
    window.localStorage.setItem("greenroom.apiToken", "greenroom_settings_test_token");
    window.localStorage.setItem("greenroom.setupWizard", "completed");
  });

  await page.route("**/api/harness/status", async (route) => {
    await route.fulfill({ json: harnessStatus });
  });
  await page.route("**/api/profiles/profile_1", async (route) => {
    if (failSave) {
      await route.fulfill({
        status: 500,
        json: { error: { code: "profile_save_failed", message: "Profile save failed" } },
      });
      return;
    }

    const input = route.request().postDataJSON() as Partial<Profile>;
    profile = { ...profile, ...input, id: profile.id, updatedAt: now };
    await route.fulfill({ json: { profile } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });

  await page.goto("/settings?section=profiles");
  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible();

  const nameField = page.getByLabel("Name");
  const saveStatus = page.locator("form").getByRole("status");
  await nameField.fill("Updated reviewer");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(saveStatus).toContainText("Profile saved.");

  await nameField.fill("Unsaved reviewer");
  await expect(saveStatus).toBeEmpty();

  failSave = true;
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("Profile save failed");
  await expect(saveStatus).not.toContainText("Profile saved.");
});

test("harness profiles select a model and its supported reasoning level", async ({ page }) => {
  const status = {
    ...harnessStatus,
    configured: true,
    healthy: true,
    runtimeMode: "bridge",
    availableKinds: [
      {
        kind: codexHarnessKindDescriptor.kind,
        label: codexHarnessKindDescriptor.label,
        defaultModel: codexHarnessKindDescriptor.defaultModel,
        defaultModelDisplay: codexHarnessKindDescriptor.defaultModelDisplay,
        supportedWorkflows: codexHarnessKindDescriptor.supportedWorkflows,
        skillSupport: codexHarnessKindDescriptor.skillSupport,
        mcp: codexHarnessKindDescriptor.mcp,
        smokeTest: codexHarnessKindDescriptor.smokeTest,
      },
    ],
  } satisfies HarnessStatusResponse;
  const catalog = {
    kind: "codex",
    source: "live",
    refreshedAt: now,
    diagnostics: [],
    models: [
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        isDefault: true,
        reasoningLevels: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        isDefault: false,
        reasoningLevels: [{ id: "low", label: "Low" }],
      },
    ],
  } satisfies HarnessModelCatalog;
  let profile: Profile = {
    id: "profile_codex",
    name: "Codex reviewer",
    workflowType: "builtin_review",
    provider: "harness",
    model: "gpt-5.4",
    description: null,
    systemPrompt: null,
    modelSettings: { harness: { kind: "codex", reasoningLevel: "high" } },
    allowedTools: [],
    contextPreferences: {},
    privacy: { persistTranscript: false, consentMode: "one_click" },
    createdAt: now,
    updatedAt: now,
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("greenroom.apiToken", "greenroom_settings_test_token");
    window.localStorage.setItem("greenroom.setupWizard", "completed");
  });
  await page.route("**/api/harness/status", async (route) => {
    await route.fulfill({ json: status });
  });
  await page.route("**/api/harness/models/codex", async (route) => {
    await route.fulfill({ json: catalog });
  });
  await page.route("**/api/profiles/profile_codex", async (route) => {
    const input = route.request().postDataJSON() as Partial<Profile>;
    profile = { ...profile, ...input, id: profile.id, updatedAt: now };
    await route.fulfill({ json: { profile } });
  });
  await page.route("**/api/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [profile] } });
  });

  await page.goto("/settings?section=profiles");

  const model = page.getByLabel("Model");
  const reasoning = page.getByLabel("Reasoning level");
  await expect(model).toHaveValue("gpt-5.4");
  await expect(reasoning).toHaveValue("high");

  await model.selectOption("gpt-5.4-mini");
  await expect(reasoning).toHaveValue("");
  await expect(reasoning.locator('option[value="high"]')).toHaveCount(0);

  await model.selectOption("gpt-5.4");
  await reasoning.selectOption("high");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => profile.model).toBe("gpt-5.4");
  await expect.poll(() => profile.modelSettings.harness?.reasoningLevel).toBe("high");
});
