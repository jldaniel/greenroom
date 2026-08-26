import { describe, expect, it } from "vitest";

import type { Profile } from "@greenroom/schemas";

import {
  newProfileFormState,
  profileFormStateFromProfile,
  profileInputFromFormState,
  type ProfileFormState,
} from "./profileFormUtils";
import type { HarnessKindOption } from "./settingsUtils";

const harnessOptions: HarnessKindOption[] = [
  {
    kind: "claude-code",
    label: "Claude Code",
    defaultModel: "claude-code",
    supportedWorkflows: ["teaching"],
    source: "available",
  },
];

function profileFixture(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile_1",
    name: "Teaching",
    workflowType: "teaching",
    provider: "harness",
    model: "claude-code",
    description: null,
    systemPrompt: null,
    modelSettings: {
      harness: {
        kind: "claude-code",
        idleTimeoutMs: 240_000,
        reasoningLevel: "high",
        repositoryAccessMode: "snapshot_readonly",
        workspaceStrategy: "git_archive",
      },
      workflow: { maxRepairAttempts: 3 },
      custom: { keep: "me" },
    },
    allowedTools: [],
    contextPreferences: { includeDiffHunks: true, tracingEnabled: true },
    privacy: { persistTranscript: false, consentMode: "trusted" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("profileFormStateFromProfile", () => {
  it("maps the common profile properties into real fields", () => {
    const form = profileFormStateFromProfile(profileFixture(), harnessOptions);

    expect(form).toMatchObject({
      name: "Teaching",
      workflowType: "teaching",
      provider: "harness",
      model: "claude-code",
      harnessKind: "claude-code",
      harnessTimeoutMs: "240000",
      reasoningLevel: "high",
      repositoryAccessMode: "snapshot_readonly",
      workspaceStrategy: "git_archive",
      persistTranscript: false,
      consentMode: "trusted",
      maxRepairAttempts: "3",
      tracingEnabled: true,
    });
    expect(JSON.parse(form.modelSettingsJson)).toMatchObject({ custom: { keep: "me" } });
  });

  it("falls back to the first harness option when settings lack a kind", () => {
    const profile = profileFixture({ model: "", modelSettings: {} });
    const form = profileFormStateFromProfile(profile, harnessOptions);

    expect(form.harnessKind).toBe("claude-code");
    expect(form.harnessTimeoutMs).toBe("300000");
    expect(form.repositoryAccessMode).toBe("mcp_only");
    expect(form.workspaceStrategy).toBe("git_archive");
    expect(form.maxRepairAttempts).toBe("2");
  });
});

describe("profileInputFromFormState", () => {
  function validForm(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
    return {
      ...newProfileFormState({ harnessKind: "claude-code", defaultModel: "claude-code" }),
      ...overrides,
    };
  }

  it("round-trips a profile through the form without losing unknown JSON keys", () => {
    const form = profileFormStateFromProfile(profileFixture(), harnessOptions);
    const result = profileInputFromFormState(form);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.modelSettings).toMatchObject({
      harness: {
        kind: "claude-code",
        idleTimeoutMs: 240_000,
        reasoningLevel: "high",
        repositoryAccessMode: "snapshot_readonly",
        workspaceStrategy: "git_archive",
      },
      workflow: { maxRepairAttempts: 3 },
      custom: { keep: "me" },
    });
    expect(result.input.contextPreferences).toMatchObject({
      includeDiffHunks: true,
      tracingEnabled: true,
    });
    expect(result.input.privacy).toEqual({ persistTranscript: false, consentMode: "trusted" });
  });

  it("folds the structured fields into modelSettings and contextPreferences", () => {
    const result = profileInputFromFormState(
      validForm({
        workflowType: "builtin_review",
        autoCreateThreads: true,
        maxRepairAttempts: "5",
        tracingEnabled: true,
        harnessTimeoutMs: "60000",
        repositoryAccessMode: "snapshot_readonly",
        workspaceStrategy: "git_worktree",
        reasoningLevel: "medium",
      }),
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.modelSettings).toMatchObject({
      harness: {
        kind: "claude-code",
        idleTimeoutMs: 60_000,
        repositoryAccessMode: "snapshot_readonly",
        reasoningLevel: "medium",
        workspaceStrategy: "git_worktree",
      },
      workflow: { maxRepairAttempts: 5 },
    });
    expect(result.input.contextPreferences).toMatchObject({
      autoCreateThreads: true,
      tracingEnabled: true,
    });
  });

  it("removes an existing reasoning override when harness default is selected", () => {
    const form = profileFormStateFromProfile(profileFixture(), harnessOptions);
    const result = profileInputFromFormState({ ...form, reasoningLevel: "" });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.modelSettings?.harness).not.toHaveProperty("reasoningLevel");
  });

  it("omits autoCreateThreads for workflows other than builtin_review", () => {
    const result = profileInputFromFormState(validForm({ autoCreateThreads: true }));

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.contextPreferences).not.toHaveProperty("autoCreateThreads");
  });

  it("rejects invalid advanced JSON with a labeled error", () => {
    const result = profileInputFromFormState(validForm({ modelSettingsJson: "[]" }));

    expect(result).toEqual({ ok: false, error: "Model settings must be a JSON object" });
  });

  it("rejects out-of-range harness timeouts for harness profiles", () => {
    const result = profileInputFromFormState(validForm({ harnessTimeoutMs: "50" }));

    expect(result).toEqual({
      ok: false,
      error: "Idle timeout must be between 1000 and 86400000 ms",
    });
  });

  it("requires a harness kind for harness profiles", () => {
    const result = profileInputFromFormState(validForm({ harnessKind: " " }));

    expect(result).toEqual({ ok: false, error: "Harness kind is required" });
  });

  it("skips harness validation for non-harness providers", () => {
    const result = profileInputFromFormState(
      validForm({ provider: "mock", harnessKind: "", harnessTimeoutMs: "nope", model: "mock" }),
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.modelSettings).not.toHaveProperty("harness");
  });

  it("bounds max repair attempts", () => {
    expect(profileInputFromFormState(validForm({ maxRepairAttempts: "21" }))).toEqual({
      ok: false,
      error: "Max repairs must be between 0 and 20",
    });
    expect(profileInputFromFormState(validForm({ maxRepairAttempts: "-1" }))).toEqual({
      ok: false,
      error: "Max repairs must be between 0 and 20",
    });
  });

  it("nulls an empty system prompt", () => {
    const result = profileInputFromFormState(validForm({ systemPrompt: "  " }));

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.input.systemPrompt).toBeNull();
  });
});
