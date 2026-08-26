import { Wrench } from "lucide-react";

import type {
  HarnessRepositoryAccessMode,
  HarnessRepositoryWorkspaceStrategy,
  HarnessModelCatalog,
  Profile,
  ProfileConsentMode,
  ProfileWorkflowType,
  ProviderKind,
} from "@greenroom/schemas";

import type { ProfileFormState } from "./profileFormUtils";
import {
  harnessModelOptionsWithCurrent,
  harnessReasoningOptionsWithCurrent,
  type HarnessKindOption,
} from "./settingsUtils";

const workflowOptions: Array<{ value: ProfileWorkflowType; label: string }> = [
  { value: "teaching", label: "Teaching" },
  { value: "spotlight", label: "Spotlight" },
  { value: "review", label: "Review" },
  { value: "handoff", label: "Handoff" },
  { value: "builtin_review", label: "Built-in review" },
];

const providerOptions: Array<{ value: ProviderKind; label: string }> = [
  { value: "harness", label: "Harness" },
  { value: "mock", label: "Mock" },
  { value: "custom", label: "Custom" },
];

const repositoryAccessModeOptions: Array<{ value: HarnessRepositoryAccessMode; label: string }> = [
  { value: "mcp_only", label: "MCP only" },
  { value: "snapshot_readonly", label: "Read-only snapshot" },
];

const workspaceStrategyOptions: Array<{
  value: HarnessRepositoryWorkspaceStrategy;
  label: string;
}> = [
  { value: "git_archive", label: "Git archive" },
  { value: "git_worktree", label: "Git worktree" },
];

/**
 * The AI profile editor fields: real inputs for the common profile
 * properties with the raw modelSettings/contextPreferences JSON behind the
 * Advanced disclosure. State handling stays in `AiProfilesSettings`.
 */
export function ProfileFormFields({
  form,
  formError,
  onFieldChange,
  onHarnessKindChange,
  onHarnessModelsRetry,
  onModelChange,
  onProviderChange,
  onToggleAdvancedJson,
  selectedProfile,
  showAdvancedJson,
  visibleHarnessKindOptions,
  harnessModelCatalog,
  harnessModelsError,
  harnessModelsLoading,
}: {
  form: ProfileFormState;
  formError: string | null;
  onFieldChange: <Key extends keyof ProfileFormState>(
    key: Key,
    value: ProfileFormState[Key],
  ) => void;
  onHarnessKindChange: (kind: string) => void;
  onHarnessModelsRetry: () => void;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: ProviderKind) => void;
  onToggleAdvancedJson: () => void;
  selectedProfile: Profile | null;
  showAdvancedJson: boolean;
  visibleHarnessKindOptions: HarnessKindOption[];
  harnessModelCatalog: HarnessModelCatalog | undefined;
  harnessModelsError: boolean;
  harnessModelsLoading: boolean;
}) {
  const harnessModelOptions = harnessModelOptionsWithCurrent(harnessModelCatalog, form.model);
  const reasoningOptions = harnessReasoningOptionsWithCurrent(
    harnessModelCatalog,
    form.model,
    form.reasoningLevel,
  );

  return (
    <>
      {selectedProfile !== null &&
      selectedProfile.description !== null &&
      selectedProfile.description.length > 0 ? (
        <p className="mb-4 break-words rounded-lg border border-line bg-muted-surface px-3 py-2 text-sm text-muted">
          {selectedProfile.description}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-muted">Name</span>
          <input
            value={form.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-muted">Workflow</span>
          <select
            value={form.workflowType}
            onChange={(event) =>
              onFieldChange("workflowType", event.target.value as ProfileWorkflowType)
            }
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          >
            {workflowOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-muted">Provider</span>
          <select
            value={form.provider}
            onChange={(event) => onProviderChange(event.target.value as ProviderKind)}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-muted">Model</span>
          {form.provider === "harness" ? (
            <>
              <select
                value={form.model}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={harnessModelsLoading && harnessModelCatalog === undefined}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
              >
                {harnessModelOptions.length === 0 ? (
                  <option value={form.model}>
                    {harnessModelsLoading ? "Loading models…" : "No models reported"}
                  </option>
                ) : (
                  harnessModelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.isDefault ? " (default)" : ""}
                    </option>
                  ))
                )}
              </select>
              {harnessModelsError ? (
                <span className="mt-1 flex items-center gap-2 text-xs text-danger-ink">
                  Model discovery failed.
                  <button
                    type="button"
                    onClick={onHarnessModelsRetry}
                    className="font-medium underline underline-offset-2"
                  >
                    Retry
                  </button>
                </span>
              ) : null}
            </>
          ) : (
            <input
              value={form.model}
              onChange={(event) => onFieldChange("model", event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
          )}
        </label>
      </div>

      {form.provider === "harness" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Harness kind</span>
            <select
              value={form.harnessKind}
              onChange={(event) => onHarnessKindChange(event.target.value)}
              disabled={visibleHarnessKindOptions.length === 0}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
            >
              {visibleHarnessKindOptions.length === 0 ? (
                <option value="">No harnesses reported</option>
              ) : (
                visibleHarnessKindOptions.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Reasoning level</span>
            <select
              value={form.reasoningLevel}
              onChange={(event) => onFieldChange("reasoningLevel", event.target.value)}
              disabled={harnessModelsLoading && harnessModelCatalog === undefined}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="">Harness default</option>
              {reasoningOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Idle timeout (ms)</span>
            <input
              type="number"
              min={1000}
              max={86400000}
              step={1000}
              value={form.harnessTimeoutMs}
              onChange={(event) => onFieldChange("harnessTimeoutMs", event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Repository access</span>
            <select
              value={form.repositoryAccessMode}
              onChange={(event) =>
                onFieldChange(
                  "repositoryAccessMode",
                  event.target.value as HarnessRepositoryAccessMode,
                )
              }
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            >
              {repositoryAccessModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {form.repositoryAccessMode === "snapshot_readonly" ? (
            <label className="block">
              <span className="text-xs font-medium uppercase text-muted">Workspace strategy</span>
              <select
                value={form.workspaceStrategy}
                onChange={(event) =>
                  onFieldChange(
                    "workspaceStrategy",
                    event.target.value as HarnessRepositoryWorkspaceStrategy,
                  )
                }
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
              >
                {workspaceStrategyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="text-xs font-medium uppercase text-muted">System prompt</span>
        <textarea
          value={form.systemPrompt}
          onChange={(event) => onFieldChange("systemPrompt", event.target.value)}
          rows={5}
          className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm">
          <span className="shrink-0">Consent</span>
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent"
            onChange={(event) =>
              onFieldChange("consentMode", event.target.value as ProfileConsentMode)
            }
            value={form.consentMode}
          >
            <option value="one_click">One-click</option>
            <option value="two_step">Two-step</option>
            <option value="trusted">Trusted (no confirmation)</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm">
          <input
            type="checkbox"
            checked={form.persistTranscript}
            onChange={(event) => onFieldChange("persistTranscript", event.target.checked)}
            className="size-4"
          />
          <span>Persist transcript</span>
        </label>
        {form.workflowType === "builtin_review" ? (
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm">
            <input
              type="checkbox"
              checked={form.autoCreateThreads}
              onChange={(event) => onFieldChange("autoCreateThreads", event.target.checked)}
              className="size-4"
            />
            <span>Auto-create review threads</span>
          </label>
        ) : null}
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm">
          <span className="shrink-0">Max repairs</span>
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={form.maxRepairAttempts}
            onChange={(event) => onFieldChange("maxRepairAttempts", event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm">
          <input
            type="checkbox"
            checked={form.tracingEnabled}
            onChange={(event) => onFieldChange("tracingEnabled", event.target.checked)}
            className="size-4"
          />
          <span>Redacted tracing</span>
        </label>
      </div>

      {form.consentMode === "trusted" ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Trusted mode: runs start without confirmation and validated AI review findings become
          threads automatically. The consented scope is still recorded for every run.
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={onToggleAdvancedJson}
          aria-expanded={showAdvancedJson}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface"
        >
          <Wrench aria-hidden="true" className="size-4" />
          Advanced JSON
        </button>
      </div>

      {showAdvancedJson ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Model settings</span>
            <textarea
              value={form.modelSettingsJson}
              onChange={(event) => onFieldChange("modelSettingsJson", event.target.value)}
              rows={8}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-muted">Context preferences</span>
            <textarea
              value={form.contextPreferencesJson}
              onChange={(event) => onFieldChange("contextPreferencesJson", event.target.value)}
              rows={8}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
        </div>
      ) : null}

      {formError === null ? null : (
        <p className="mt-3 break-words rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          {formError}
        </p>
      )}
    </>
  );
}
