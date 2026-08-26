import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, FileCog, LoaderCircle, RefreshCw, Save } from "lucide-react";

import {
  GreenroomApiError,
  type ConfigFileKeyStatus,
  type ConfigFileValidationIssue,
} from "../api/client";
import { useConfigFile, useUpdateConfigFile } from "../api/hooks";
import { ApiErrorBanner, LoadingBlock } from "./Feedback";
import {
  configFromFormState,
  envOverridesFromKeys,
  fieldErrorsFromIssues,
  formStateFromConfig,
  type BridgeTokenRefKind,
  type ServerConfigFormState,
} from "./serverConfigUtils";

export type ServerConfigSection = "server" | "bridge" | "workflows";

const allServerConfigSections: readonly ServerConfigSection[] = ["server", "bridge", "workflows"];

/**
 * Edits the editable subset of greenroom.toml through the config-file API.
 * Values are read at server boot, so saved changes require a restart. Keys
 * currently overridden by env vars show an inline warning because the file
 * edit will not take effect until the env var is unset.
 *
 * `sections` limits which fieldsets render so the Settings split
 * can show server/workflow basics on General and bridge configuration on
 * Connections. The form always keeps the full loaded config in state, so a
 * partial panel saves hidden keys unchanged.
 */
export function ServerConfigPanel({
  enabled,
  sections = allServerConfigSections,
  title = "Server configuration",
}: {
  enabled: boolean;
  sections?: readonly ServerConfigSection[];
  title?: string;
}) {
  const configFile = useConfigFile(enabled);
  const updateConfig = useUpdateConfigFile();
  const [form, setForm] = useState<ServerConfigFormState>(() => formStateFromConfig({}));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (configFile.data !== undefined) {
      setForm(formStateFromConfig(configFile.data.config));
      setClientErrors({});
    }
  }, [configFile.data]);

  const envOverrides = useMemo(
    () => envOverridesFromKeys(configFile.data?.keys),
    [configFile.data?.keys],
  );
  const fieldErrors = useMemo(
    () => ({ ...fieldErrorsFromIssues(apiIssuesFromError(updateConfig.error)), ...clientErrors }),
    [clientErrors, updateConfig.error],
  );

  function setField<Key extends keyof ServerConfigFormState>(
    key: Key,
    value: ServerConfigFormState[Key],
  ) {
    setSavedAt(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { config, errors } = configFromFormState(configFile.data?.config ?? {}, form);
    setClientErrors(errors);
    setSavedAt(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      await updateConfig.mutateAsync(config);
      setSavedAt(new Date().toISOString());
    } catch {
      // Per-field validation errors render from updateConfig.error.
    }
  }

  const tokenRefError =
    fieldErrors["bridge.tokenEnv"] ?? fieldErrors["bridge.tokenFile"] ?? fieldErrors["bridge"];

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <FileCog aria-hidden="true" className="mt-0.5 size-4 text-accent-ink" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-normal">{title}</h2>
            <p className="mt-1 text-sm text-muted">
              Saved to <span className="font-mono text-xs">greenroom.toml</span>. Changes take
              effect after the Greenroom server restarts.
            </p>
            {configFile.data === undefined ? null : (
              <p className="mt-1 break-all font-mono text-xs text-muted">{configFile.data.path}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void configFile.refetch()}
          disabled={!enabled || configFile.isFetching}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface disabled:opacity-50"
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-4 ${configFile.isFetching ? "animate-spin" : ""}`}
          />
          Reload
        </button>
      </div>

      {configFile.isLoading ? (
        <div className="mt-4">
          <LoadingBlock label="Loading configuration" />
        </div>
      ) : null}
      {configFile.error === null ? null : (
        <div className="mt-4">
          <ApiErrorBanner error={configFile.error} />
        </div>
      )}

      {configFile.data?.fileError == null ? null : (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">The config file on disk is invalid; saving overwrites it.</p>
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {configFile.data.fileError.issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`} className="break-words">
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {configFile.data === undefined ? null : (
        <form className="mt-4 space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className={sections.includes("server") ? "space-y-3" : "hidden"}>
            <legend className="text-xs font-medium uppercase text-muted">Server</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <ConfigField
                label="Host"
                placeholder="127.0.0.1"
                value={form.serverHost}
                onChange={(value) => setField("serverHost", value)}
                error={fieldErrors["server.host"]}
                override={envOverrides["server.host"]}
              />
              <ConfigField
                label="API port"
                placeholder="49331"
                inputMode="numeric"
                value={form.serverPort}
                onChange={(value) => setField("serverPort", value)}
                error={fieldErrors["server.port"]}
                override={envOverrides["server.port"]}
              />
              <ConfigField
                label="MCP port"
                placeholder="49332"
                inputMode="numeric"
                value={form.mcpPort}
                onChange={(value) => setField("mcpPort", value)}
                error={fieldErrors["mcp.port"]}
                override={envOverrides["mcp.port"]}
              />
            </div>
          </fieldset>

          <fieldset className={sections.includes("bridge") ? "space-y-3" : "hidden"}>
            <legend className="text-xs font-medium uppercase text-muted">Harness bridge</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <ConfigField
                label="Base URL"
                placeholder="http://127.0.0.1:49343"
                value={form.bridgeBaseUrl}
                onChange={(value) => setField("bridgeBaseUrl", value)}
                error={fieldErrors["bridge.baseUrl"]}
                override={envOverrides["bridge.baseUrl"]}
              />
              <ConfigField
                label="Timeout (ms)"
                placeholder="3600000"
                inputMode="numeric"
                value={form.bridgeTimeoutMs}
                onChange={(value) => setField("bridgeTimeoutMs", value)}
                error={fieldErrors["bridge.timeoutMs"]}
                override={envOverrides["bridge.timeoutMs"]}
              />
              <label className="block">
                <span className="text-xs font-medium uppercase text-muted">Token reference</span>
                <select
                  value={form.bridgeTokenRefKind}
                  onChange={(event) =>
                    setField("bridgeTokenRefKind", event.target.value as BridgeTokenRefKind)
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
                >
                  <option value="none">None (bridge token unset)</option>
                  <option value="tokenEnv">Environment variable name</option>
                  <option value="tokenFile">Token file path</option>
                </select>
                <span className="mt-1 block text-xs text-muted">
                  Only a reference is stored; the token value never enters the config file.
                </span>
              </label>
              {form.bridgeTokenRefKind === "none" ? null : (
                <ConfigField
                  label={
                    form.bridgeTokenRefKind === "tokenEnv" ? "Token env var" : "Token file path"
                  }
                  placeholder={
                    form.bridgeTokenRefKind === "tokenEnv"
                      ? "GREENROOM_HARNESS_TOKEN"
                      : "/path/to/bridge-token"
                  }
                  value={form.bridgeTokenRefValue}
                  onChange={(value) => setField("bridgeTokenRefValue", value)}
                  error={tokenRefError}
                  override={envOverrides["bridge.token"]}
                />
              )}
            </div>
          </fieldset>

          <fieldset className={sections.includes("workflows") ? "space-y-3" : "hidden"}>
            <legend className="text-xs font-medium uppercase text-muted">Workflow limits</legend>
            <div className="grid gap-4 md:grid-cols-3">
              <ConfigField
                label="Max concurrent runs"
                placeholder="1"
                inputMode="numeric"
                value={form.workflowMaxConcurrentRuns}
                onChange={(value) => setField("workflowMaxConcurrentRuns", value)}
                error={fieldErrors["workflows.maxConcurrentRuns"]}
                override={envOverrides["workflows.maxConcurrentRuns"]}
              />
              <ConfigField
                label="Idle timeout (ms)"
                placeholder="300000"
                inputMode="numeric"
                value={form.workflowIdleTimeoutMs}
                onChange={(value) => setField("workflowIdleTimeoutMs", value)}
                error={fieldErrors["workflows.idleTimeoutMs"]}
                override={envOverrides["workflows.idleTimeoutMs"]}
              />
              <ConfigField
                label="Absolute timeout (ms)"
                placeholder="3600000"
                inputMode="numeric"
                value={form.workflowAbsoluteTimeoutMs}
                onChange={(value) => setField("workflowAbsoluteTimeoutMs", value)}
                error={fieldErrors["workflows.absoluteTimeoutMs"]}
                override={envOverrides["workflows.absoluteTimeoutMs"]}
              />
              <ConfigField
                label="Max MCP resource reads"
                placeholder="1000"
                inputMode="numeric"
                value={form.workflowMaxMcpResourceReads}
                onChange={(value) => setField("workflowMaxMcpResourceReads", value)}
                error={fieldErrors["workflows.maxMcpResourceReads"]}
                override={envOverrides["workflows.maxMcpResourceReads"]}
              />
            </div>
          </fieldset>

          {updateConfig.error === null ||
          apiIssuesFromError(updateConfig.error) !== undefined ? null : (
            <ApiErrorBanner error={updateConfig.error} />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!enabled || updateConfig.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              {updateConfig.isPending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="size-4" />
              )}
              Save configuration
            </button>
            <p className="text-xs text-muted">
              Restart Greenroom to apply saved changes; the file is read at startup.
            </p>
            {savedAt === null ? null : (
              <p className="text-xs font-medium text-success-ink">Saved. Restart to apply.</p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function ConfigField({
  error,
  inputMode,
  label,
  onChange,
  override,
  placeholder,
  value,
}: {
  error?: string | undefined;
  inputMode?: "numeric" | undefined;
  label: string;
  onChange: (value: string) => void;
  override?: ConfigFileKeyStatus | undefined;
  placeholder?: string | undefined;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`mt-1 h-10 w-full rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent ${
          error === undefined ? "border-line" : "border-danger/50"
        }`}
      />
      {error === undefined ? null : (
        <span className="mt-1 block text-xs text-danger-ink" role="alert">
          {error}
        </span>
      )}
      {override === undefined ? null : <EnvOverrideWarning override={override} />}
    </label>
  );
}

function EnvOverrideWarning({ override }: { override: ConfigFileKeyStatus }): ReactNode {
  return (
    <span className="mt-1 flex items-start gap-1 text-xs text-warning-ink">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 break-words">
        Env override active: <span className="font-mono">{override.envVar}</span> is set, so this
        file edit will not take effect until it is unset.
      </span>
    </span>
  );
}

function apiIssuesFromError(error: unknown): ConfigFileValidationIssue[] | undefined {
  if (!(error instanceof GreenroomApiError)) {
    return undefined;
  }

  const issues = (error.apiError?.details as { issues?: unknown } | undefined)?.issues;

  if (!Array.isArray(issues)) {
    return undefined;
  }

  const parsed = issues.filter(
    (issue): issue is ConfigFileValidationIssue =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as { path?: unknown }).path === "string" &&
      typeof (issue as { message?: unknown }).message === "string",
  );

  return parsed.length > 0 ? parsed : undefined;
}
