import type {
  HarnessRepositoryAccessMode,
  HarnessRepositoryWorkspaceStrategy,
  Profile,
  ProfileConsentMode,
  ProfileCreateInput,
  ProfileWorkflowType,
  ProviderKind,
} from "@greenroom/schemas";

import type { HarnessKindOption } from "./settingsUtils";

/**
 * Pure form-state helpers for the AI Profiles section. The form
 * edits the common profile properties as real fields; the raw
 * modelSettings/contextPreferences JSON stays available behind the Advanced
 * disclosure and round-trips unknown keys untouched.
 */

export interface ProfileFormState {
  name: string;
  workflowType: ProfileWorkflowType;
  provider: ProviderKind;
  model: string;
  harnessKind: string;
  reasoningLevel: string;
  harnessTimeoutMs: string;
  repositoryAccessMode: HarnessRepositoryAccessMode;
  workspaceStrategy: HarnessRepositoryWorkspaceStrategy;
  systemPrompt: string;
  modelSettingsJson: string;
  contextPreferencesJson: string;
  persistTranscript: boolean;
  consentMode: ProfileConsentMode;
  autoCreateThreads: boolean;
  maxRepairAttempts: string;
  tracingEnabled: boolean;
}

export const defaultContextPreferencesJson =
  '{\n  "includeDiffHunks": true,\n  "includeQuiz": true\n}';

export function newProfileFormState(defaults: {
  harnessKind: string;
  defaultModel: string;
}): ProfileFormState {
  return {
    name: "Teaching",
    workflowType: "teaching",
    provider: "harness",
    model: defaults.defaultModel,
    harnessKind: defaults.harnessKind,
    reasoningLevel: "",
    harnessTimeoutMs: "300000",
    repositoryAccessMode: "mcp_only",
    workspaceStrategy: "git_archive",
    systemPrompt: "",
    modelSettingsJson: "{}",
    contextPreferencesJson: defaultContextPreferencesJson,
    persistTranscript: true,
    consentMode: "one_click",
    autoCreateThreads: false,
    maxRepairAttempts: "2",
    tracingEnabled: false,
  };
}

export function profileFormStateFromProfile(
  profile: Profile,
  options: HarnessKindOption[],
): ProfileFormState {
  return {
    name: profile.name,
    workflowType: profile.workflowType,
    provider: profile.provider,
    model: profile.model,
    harnessKind: harnessKindFromProfileSettings(profile, options),
    reasoningLevel: harnessReasoningLevelFromProfileSettings(profile),
    harnessTimeoutMs: String(harnessIdleTimeoutFromProfileSettings(profile) ?? 300_000),
    repositoryAccessMode: repositoryAccessModeFromProfileSettings(profile),
    workspaceStrategy: workspaceStrategyFromProfileSettings(profile),
    systemPrompt: profile.systemPrompt ?? "",
    modelSettingsJson: JSON.stringify(profile.modelSettings, null, 2),
    contextPreferencesJson: JSON.stringify(profile.contextPreferences, null, 2),
    persistTranscript: profile.privacy.persistTranscript,
    consentMode: profile.privacy.consentMode,
    autoCreateThreads: autoCreateThreadsFromProfile(profile),
    maxRepairAttempts: String(maxRepairAttemptsFromProfile(profile) ?? 2),
    tracingEnabled: tracingEnabledFromProfile(profile),
  };
}

export type ProfileInputFromFormResult =
  | { ok: true; input: ProfileCreateInput }
  | { ok: false; error: string };

/**
 * Validates the form and folds the structured fields back into the
 * modelSettings/contextPreferences records the profile API expects.
 */
export function profileInputFromFormState(form: ProfileFormState): ProfileInputFromFormResult {
  let modelSettings: Record<string, unknown>;
  let contextPreferences: Record<string, unknown>;

  try {
    modelSettings = parseJsonObject(form.modelSettingsJson, "Model settings");
    contextPreferences = parseJsonObject(form.contextPreferencesJson, "Context preferences");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }

  const parsedHarnessTimeout = Number(form.harnessTimeoutMs);
  const parsedMaxRepairAttempts = Number(form.maxRepairAttempts);

  if (form.provider === "harness") {
    if (form.harnessKind.trim().length === 0) {
      return { ok: false, error: "Harness kind is required" };
    }

    if (
      !Number.isInteger(parsedHarnessTimeout) ||
      parsedHarnessTimeout < 1000 ||
      parsedHarnessTimeout > 24 * 60 * 60 * 1000
    ) {
      return { ok: false, error: "Idle timeout must be between 1000 and 86400000 ms" };
    }

    modelSettings = applyHarnessProfileSettings(modelSettings, {
      kind: form.harnessKind,
      idleTimeoutMs: parsedHarnessTimeout,
      repositoryAccessMode: form.repositoryAccessMode,
      reasoningLevel: form.reasoningLevel,
      workspaceStrategy: form.workspaceStrategy,
    });
  }

  if (
    !Number.isInteger(parsedMaxRepairAttempts) ||
    parsedMaxRepairAttempts < 0 ||
    parsedMaxRepairAttempts > 20
  ) {
    return { ok: false, error: "Max repairs must be between 0 and 20" };
  }

  modelSettings = applyWorkflowModelSettings(modelSettings, {
    maxRepairAttempts: parsedMaxRepairAttempts,
  });
  contextPreferences = applyProfileContextDefaults(contextPreferences, {
    autoCreateThreads: form.autoCreateThreads,
    tracingEnabled: form.tracingEnabled,
    workflowType: form.workflowType,
  });

  return {
    ok: true,
    input: {
      name: form.name.trim(),
      workflowType: form.workflowType,
      provider: form.provider,
      model: form.model.trim(),
      systemPrompt: form.systemPrompt.trim().length === 0 ? null : form.systemPrompt,
      modelSettings,
      allowedTools: [],
      contextPreferences,
      privacy: {
        persistTranscript: form.persistTranscript,
        consentMode: form.consentMode,
      },
    },
  };
}

export function harnessKindFromProfileSettings(
  profile: Profile,
  options: HarnessKindOption[],
): string {
  if (profile.provider === "harness") {
    const harnessSettings = objectRecord(profile.modelSettings.harness);
    const kind = typeof harnessSettings.kind === "string" ? harnessSettings.kind.trim() : "";

    if (kind.length > 0) {
      return kind;
    }

    if (profile.model.trim().length > 0) {
      return profile.model;
    }
  }

  return options[0]?.kind ?? "";
}

export function harnessIdleTimeoutFromProfileSettings(profile: Profile): number | null {
  const harnessSettings = objectRecord(profile.modelSettings.harness);
  return numberSetting(harnessSettings, "idleTimeoutMs");
}

export function harnessReasoningLevelFromProfileSettings(profile: Profile): string {
  const harnessSettings = objectRecord(profile.modelSettings.harness);
  return stringSetting(harnessSettings, "reasoningLevel") ?? "";
}

export function repositoryAccessModeFromProfileSettings(
  profile: Profile,
): HarnessRepositoryAccessMode {
  const harnessSettings = objectRecord(profile.modelSettings.harness);
  const mode = stringSetting(harnessSettings, "repositoryAccessMode");
  return mode === "snapshot_readonly" ? mode : "mcp_only";
}

export function workspaceStrategyFromProfileSettings(
  profile: Profile,
): HarnessRepositoryWorkspaceStrategy {
  const harnessSettings = objectRecord(profile.modelSettings.harness);
  const strategy = stringSetting(harnessSettings, "workspaceStrategy");
  return strategy === "git_worktree" ? strategy : "git_archive";
}

export function autoCreateThreadsFromProfile(profile: Profile): boolean {
  return (
    booleanSetting(profile.contextPreferences, "autoCreateThreads") === true ||
    booleanSetting(profile.contextPreferences, "autoCreateBuiltinReviewThreads") === true ||
    booleanSetting(profile.contextPreferences.builtinReview, "autoCreateThreads") === true ||
    booleanSetting(profile.modelSettings.builtinReview, "autoCreateThreads") === true ||
    booleanSetting(profile.modelSettings.workflow, "autoCreateThreads") === true
  );
}

export function maxRepairAttemptsFromProfile(profile: Profile): number | null {
  return (
    numberSetting(profile.modelSettings.workflow, "maxRepairAttempts") ??
    numberSetting(profile.modelSettings, "maxRepairAttempts")
  );
}

export function tracingEnabledFromProfile(profile: Profile): boolean {
  return (
    booleanSetting(profile.contextPreferences, "tracingEnabled") === true ||
    booleanSetting(profile.contextPreferences.tracing, "enabled") === true ||
    booleanSetting(profile.modelSettings.workflow, "tracingEnabled") === true ||
    booleanSetting(profile.modelSettings.tracing, "enabled") === true
  );
}

export function applyHarnessProfileSettings(
  modelSettings: Record<string, unknown>,
  harness: {
    kind: string;
    idleTimeoutMs: number;
    repositoryAccessMode: HarnessRepositoryAccessMode;
    reasoningLevel: string;
    workspaceStrategy: HarnessRepositoryWorkspaceStrategy;
  },
): Record<string, unknown> {
  const existing = { ...objectRecord(modelSettings.harness) };
  delete existing.reasoningLevel;

  return {
    ...modelSettings,
    harness: {
      ...existing,
      kind: harness.kind.trim(),
      idleTimeoutMs: harness.idleTimeoutMs,
      repositoryAccessMode: harness.repositoryAccessMode,
      ...(harness.reasoningLevel.trim().length > 0
        ? { reasoningLevel: harness.reasoningLevel.trim() }
        : {}),
      workspaceStrategy: harness.workspaceStrategy,
    },
  };
}

export function applyWorkflowModelSettings(
  modelSettings: Record<string, unknown>,
  workflow: { maxRepairAttempts: number },
): Record<string, unknown> {
  return {
    ...modelSettings,
    workflow: {
      ...objectRecord(modelSettings.workflow),
      maxRepairAttempts: workflow.maxRepairAttempts,
    },
  };
}

export function applyProfileContextDefaults(
  contextPreferences: Record<string, unknown>,
  defaults: {
    autoCreateThreads: boolean;
    tracingEnabled: boolean;
    workflowType: ProfileWorkflowType;
  },
): Record<string, unknown> {
  return {
    ...contextPreferences,
    ...(defaults.workflowType === "builtin_review"
      ? { autoCreateThreads: defaults.autoCreateThreads }
      : {}),
    tracingEnabled: defaults.tracingEnabled,
  };
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanSetting(value: unknown, key: string): boolean | null {
  const record = objectRecord(value);
  const candidate = record[key];
  return typeof candidate === "boolean" ? candidate : null;
}

function numberSetting(value: unknown, key: string): number | null {
  const record = objectRecord(value);
  const candidate = record[key];
  return typeof candidate === "number" ? candidate : null;
}

function stringSetting(value: unknown, key: string): string | null {
  const record = objectRecord(value);
  const candidate = record[key];
  return typeof candidate === "string" ? candidate : null;
}
