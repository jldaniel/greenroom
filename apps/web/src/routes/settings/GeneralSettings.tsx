import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Database,
  HardDrive,
  KeyRound,
  MonitorCog,
  Moon,
  PlugZap,
  Server,
  Sparkles,
  Sun,
  Trash2,
  Wrench,
} from "lucide-react";

import type { HarnessStatusResponse } from "@greenroom/schemas";

import {
  greenroomApiBaseUrl,
  type GreenroomApiTokenStatus,
  type GreenroomRuntimeStatus,
} from "../../api/client";
import {
  useHarnessStatus,
  useHealth,
  usePurgeWorkflowTranscripts,
  useRuntimeStatus,
} from "../../api/hooks";
import { ApiErrorBanner } from "../../components/Feedback";
import { ServerConfigPanel } from "../../components/ServerConfigPanel";
import { useGreenroomTheme, type GreenroomTheme } from "../../theme";
import {
  readSetupWizardCompletionState,
  type SetupWizardCompletionState,
} from "../setupWizardUtils";
import { RedactedActionError, StatusDetail } from "./settingsShared";
import { statusLabel, supervisionLabel, tokenSourceLabel } from "./settingsUtils";

/**
 * General section: appearance, setup wizard entry, app/runtime
 * status, the config-file basics (server ports and workflow limits), and
 * transcript maintenance. Bridge configuration lives in Connections.
 */
export function GeneralSettings({ tokenStatus }: { tokenStatus: GreenroomApiTokenStatus }) {
  const { theme, setTheme } = useGreenroomTheme();
  const enabled = tokenStatus.source !== "missing";
  const health = useHealth(enabled);
  const harnessStatus = useHarnessStatus(enabled);
  // Supervised service health: the same data the retired desktop
  // shell used to push through its preload feed, now read from the API.
  const runtimeStatus = useRuntimeStatus(enabled);

  return (
    <div className="space-y-5">
      <AppearanceSettings theme={theme} onThemeChange={setTheme} />

      <SetupWizardEntry />

      <AppStatusPanel
        harnessStatus={harnessStatus.data}
        harnessStatusError={harnessStatus.error}
        health={health.data}
        healthError={health.error}
        isHealthLoading={health.isLoading}
        runtimeStatus={runtimeStatus.data}
        tokenStatus={tokenStatus}
      />

      <ServerConfigPanel enabled={enabled} sections={["server", "workflows"]} />

      <TranscriptMaintenance enabled={enabled} />
    </div>
  );
}

function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: GreenroomTheme;
  onThemeChange: (theme: GreenroomTheme) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MonitorCog aria-hidden="true" className="mt-0.5 size-4 text-accent-ink" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-normal">Appearance</h2>
            <p className="mt-1 text-sm text-muted">Choose the local interface theme</p>
          </div>
        </div>
        <div
          aria-label="Theme"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted-surface p-1"
          role="radiogroup"
        >
          <ThemeChoiceButton
            icon={<Sun aria-hidden="true" className="size-4" />}
            label="Light"
            onClick={() => onThemeChange("light")}
            selected={theme === "light"}
          />
          <ThemeChoiceButton
            icon={<Moon aria-hidden="true" className="size-4" />}
            label="Dark"
            onClick={() => onThemeChange("dark")}
            selected={theme === "dark"}
          />
        </div>
      </div>
    </section>
  );
}

function ThemeChoiceButton({
  icon,
  label,
  onClick,
  selected,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-checked={selected}
      className={`inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
        selected ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
      onClick={onClick}
      role="radio"
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SetupWizardEntry() {
  const [completionState] = useState<SetupWizardCompletionState>(() =>
    readSetupWizardCompletionState(),
  );

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 text-accent-ink" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-normal">Setup wizard</h2>
            <p className="mt-1 text-sm text-muted">
              {setupWizardStateLabel(completionState)} Walks token, repository, harness, seeded
              profiles, and first-review setup; steps reflect what already exists.
            </p>
          </div>
        </div>
        <Link
          to="/setup"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          Run setup wizard
        </Link>
      </div>
    </section>
  );
}

function setupWizardStateLabel(state: SetupWizardCompletionState): string {
  if (state === "completed") {
    return "Completed on this browser.";
  }

  if (state === "skipped") {
    return "Skipped on this browser.";
  }

  return "Not run on this browser yet.";
}

function AppStatusPanel({
  harnessStatus,
  harnessStatusError,
  health,
  healthError,
  isHealthLoading,
  runtimeStatus,
  tokenStatus,
}: {
  harnessStatus: HarnessStatusResponse | undefined;
  harnessStatusError: unknown;
  health: { status: "ok"; databasePath: string } | undefined;
  healthError: unknown;
  isHealthLoading: boolean;
  runtimeStatus: GreenroomRuntimeStatus | undefined;
  tokenStatus: GreenroomApiTokenStatus;
}) {
  const services = runtimeStatus?.supervised === true ? runtimeStatus.services : [];
  const apiService = services.find((status) => status.name === "api") ?? null;
  const mcpService = services.find((status) => status.name === "mcp") ?? null;
  const dataLocation = runtimeStatus?.dataDir ?? health?.databasePath;
  const apiStatusTone =
    health?.status === "ok"
      ? "success"
      : isHealthLoading
        ? "neutral"
        : healthError === null
          ? "neutral"
          : "danger";
  const apiStatusLabel =
    health?.status === "ok" ? "Healthy" : isHealthLoading ? "Checking" : "Unavailable";
  const bridgeTone =
    harnessStatus === undefined
      ? harnessStatusError === null
        ? "neutral"
        : "danger"
      : harnessStatus.healthy
        ? "success"
        : harnessStatus.configured
          ? "warning"
          : "neutral";
  const bridgeLabel =
    harnessStatus === undefined
      ? harnessStatusError === null
        ? "Unknown"
        : "Unavailable"
      : harnessStatus.healthy
        ? "Healthy"
        : harnessStatus.configured
          ? "Configured"
          : "Not configured";
  const mcpTone =
    mcpService?.state === "running"
      ? "success"
      : mcpService === null
        ? "neutral"
        : mcpService.state === "failed"
          ? "danger"
          : "warning";
  const mcpLabel =
    mcpService?.state === "running" ? "Running" : statusLabel(mcpService?.state ?? null);

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-4 flex items-center gap-2">
        <Activity aria-hidden="true" className="size-4 text-accent-ink" />
        <h2 className="text-sm font-semibold tracking-normal">App status</h2>
      </div>
      <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusDetail
          icon={<Server aria-hidden="true" className="size-4" />}
          label="API"
          statusLabel={apiStatusLabel}
          tone={apiStatusTone}
          value={apiService?.url ?? greenroomApiBaseUrl}
        />
        <StatusDetail
          icon={<KeyRound aria-hidden="true" className="size-4" />}
          label="API token"
          statusLabel={tokenSourceLabel(tokenStatus.source)}
          tone={tokenStatus.source === "missing" ? "danger" : "success"}
          value={tokenStatus.source === "missing" ? "Unavailable" : "Configured"}
        />
        <StatusDetail
          icon={<Wrench aria-hidden="true" className="size-4" />}
          label="Harness bridge"
          statusLabel={bridgeLabel}
          tone={bridgeTone}
          value={harnessStatus?.baseUrl ?? "Unavailable"}
        />
        <StatusDetail
          icon={<PlugZap aria-hidden="true" className="size-4" />}
          label="MCP"
          statusLabel={mcpLabel}
          tone={mcpTone}
          value={mcpService?.url ?? "Unknown"}
        />
        <StatusDetail
          icon={<HardDrive aria-hidden="true" className="size-4" />}
          label="Runtime"
          statusLabel={statusLabel(harnessStatus?.runtimeMode)}
          tone={harnessStatus?.runtimeMode === "disabled" ? "neutral" : "success"}
          value={supervisionLabel(runtimeStatus)}
        />
        <StatusDetail
          icon={<Database aria-hidden="true" className="size-4" />}
          label="Data location"
          statusLabel={dataLocation === undefined ? "Unknown" : "Available"}
          tone={dataLocation === undefined ? "neutral" : "success"}
          value={dataLocation ?? "Unknown"}
        />
      </dl>
      {healthError === null && harnessStatusError === null ? null : (
        <div className="mt-4 space-y-2">
          {healthError === null ? null : <RedactedActionError label="API" error={healthError} />}
          {harnessStatusError === null ? null : (
            <RedactedActionError label="Harness" error={harnessStatusError} />
          )}
        </div>
      )}
    </section>
  );
}

function TranscriptMaintenance({ enabled }: { enabled: boolean }) {
  const purgeTranscripts = usePurgeWorkflowTranscripts();
  const [lastPurgedCount, setLastPurgedCount] = useState<number | null>(null);

  async function handlePurge() {
    setLastPurgedCount(null);
    const result = await purgeTranscripts.mutateAsync();
    setLastPurgedCount(result.deletedCount);
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Database aria-hidden="true" className="size-4 text-accent-ink" />
        <h2 className="text-sm font-semibold tracking-normal">Run transcripts</h2>
      </div>
      <p className="text-sm text-muted">
        Redacted harness transcripts (prompt, output, stderr) are stored per workflow run with size
        and age retention caps. Profiles can opt out with the "Persist transcript" setting. Purging
        removes every stored transcript immediately.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => void handlePurge()}
          disabled={!enabled || purgeTranscripts.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-danger/30 bg-surface px-3 text-sm font-medium text-danger-ink hover:bg-danger-soft disabled:opacity-50"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Purge all transcripts
        </button>
        {lastPurgedCount === null ? null : (
          <span className="text-sm text-muted">
            Deleted {lastPurgedCount} transcript{lastPurgedCount === 1 ? "" : "s"}.
          </span>
        )}
      </div>
      {purgeTranscripts.error === null ? null : (
        <div className="mt-3">
          <ApiErrorBanner error={purgeTranscripts.error} />
        </div>
      )}
    </section>
  );
}
