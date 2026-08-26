import {
  Activity,
  Download,
  LoaderCircle,
  Play,
  PlugZap,
  RefreshCw,
  Terminal,
  Wrench,
} from "lucide-react";

import type { HarnessSetupSmokeResponse, HarnessStatusResponse } from "@greenroom/schemas";

import { useHarnessSkill, useInstallHarnessSkill, useRunHarnessSetupSmoke } from "../../api/hooks";
import { RedactedActionError, StatusBadge, StatusDetail } from "./settingsShared";
import {
  diagnosticsForHarness,
  redactDiagnostic,
  skillInstallResultToSmokeLike,
  skillVersionLabel,
  smokeStatusLabel,
  statusLabel,
  toneForSmoke,
  toneForStatus,
  type HarnessKindOption,
} from "./settingsUtils";

/**
 * Harness bridge status and per-kind setup actions (CLI detection, skill
 * install, smoke test). Lives on the Connections section; the data
 * comes from `/api/harness/status`.
 */
export function HarnessSetupPanel({
  enabled,
  harnessKindOptions,
  harnessStatus,
  isStatusLoading,
  onRecheck,
  onSelectedHarnessKindChange,
  selectedHarnessKind,
  statusError,
}: {
  enabled: boolean;
  harnessKindOptions: HarnessKindOption[];
  harnessStatus: HarnessStatusResponse | undefined;
  isStatusLoading: boolean;
  onRecheck: () => void;
  onSelectedHarnessKindChange: (kind: string) => void;
  selectedHarnessKind: string;
  statusError: unknown;
}) {
  const selectedHarness = harnessStatus?.harnesses.find(
    (harness) => harness.kind === selectedHarnessKind,
  );
  const selectedOption = harnessKindOptions.find((option) => option.kind === selectedHarnessKind);
  const selectedKind = selectedHarnessKind.trim().length === 0 ? null : selectedHarnessKind;
  const skillCheck = useHarnessSkill(selectedKind, enabled && selectedKind !== null);
  const installSkill = useInstallHarnessSkill();
  const smoke = useRunHarnessSetupSmoke();
  const skill =
    skillCheck.data?.skill ?? installSkill.data?.skill ?? selectedHarness?.skill ?? null;
  const canInstallSkill =
    enabled &&
    selectedKind !== null &&
    skill?.skillMode === "managed_package" &&
    skill.status !== "unsupported" &&
    !installSkill.isPending;
  const canRunSmoke =
    enabled &&
    selectedKind !== null &&
    selectedOption?.source !== undefined &&
    selectedHarness?.smokeTest.supported !== false &&
    !smoke.isPending;
  const diagnostics = diagnosticsForHarness(selectedHarness, skill);

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal aria-hidden="true" className="size-4 text-accent-ink" />
            <h2 className="text-sm font-semibold tracking-normal">Harness setup</h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            {harnessStatus?.configured === true
              ? `${harnessStatus.availableKinds.length} available`
              : "Bridge unavailable"}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,260px)_auto_auto_auto]">
          <select
            value={selectedHarnessKind}
            onChange={(event) => onSelectedHarnessKindChange(event.target.value)}
            disabled={harnessKindOptions.length === 0}
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
          >
            {harnessKindOptions.length === 0 ? (
              <option value="">No harnesses reported</option>
            ) : (
              harnessKindOptions.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => {
              onRecheck();
              void skillCheck.refetch();
            }}
            disabled={!enabled || isStatusLoading || skillCheck.isFetching}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${isStatusLoading || skillCheck.isFetching ? "animate-spin" : ""}`}
            />
            Recheck
          </button>
          <button
            type="button"
            onClick={() => selectedKind !== null && installSkill.mutate(selectedKind)}
            disabled={!canInstallSkill}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface disabled:opacity-50"
          >
            {installSkill.isPending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Download aria-hidden="true" className="size-4" />
            )}
            Install/update
          </button>
          <button
            type="button"
            onClick={() => selectedKind !== null && smoke.mutate(selectedKind)}
            disabled={!canRunSmoke}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
          >
            {smoke.isPending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Play aria-hidden="true" className="size-4" />
            )}
            Smoke test
          </button>
        </div>
      </div>

      {statusError === null ? null : (
        <div className="mt-4">
          <RedactedActionError label="Harness status" error={statusError} />
        </div>
      )}

      {selectedKind === null ? (
        <p className="mt-4 rounded-lg border border-line bg-muted-surface px-3 py-2 text-sm text-muted">
          No harness kind selected.
        </p>
      ) : (
        <dl className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
          <StatusDetail
            icon={<Terminal aria-hidden="true" className="size-4" />}
            label="CLI"
            statusLabel={statusLabel(selectedHarness?.cli.status)}
            tone={toneForStatus(selectedHarness?.cli.status)}
            value={selectedHarness?.cli.path ?? selectedHarness?.cli.message ?? "Unknown"}
            meta={selectedHarness?.cli.version ?? undefined}
          />
          <StatusDetail
            icon={<Wrench aria-hidden="true" className="size-4" />}
            label="Bridge"
            statusLabel={
              selectedHarness?.bridge.configured === true ? "Configured" : "Not configured"
            }
            tone={selectedHarness?.bridge.configured === true ? "success" : "neutral"}
            value={
              selectedHarness?.bridge.commandConfigured === true
                ? "Command configured"
                : "Command missing"
            }
          />
          <StatusDetail
            icon={<PlugZap aria-hidden="true" className="size-4" />}
            label="MCP setup"
            statusLabel={statusLabel(selectedHarness?.mcpSetup.status)}
            tone={toneForStatus(selectedHarness?.mcpSetup.status)}
            value={
              selectedHarness?.mcpSetup.smokeResource ?? selectedHarness?.mcp.notes ?? "Unknown"
            }
          />
          <StatusDetail
            icon={<Download aria-hidden="true" className="size-4" />}
            label="Skill"
            statusLabel={statusLabel(skill?.status)}
            tone={toneForStatus(skill?.status)}
            value={skill?.path ?? skill?.packageName ?? "Unknown"}
            meta={skillVersionLabel(skill)}
          />
          <StatusDetail
            icon={<Play aria-hidden="true" className="size-4" />}
            label="Smoke test"
            statusLabel={smokeStatusLabel(smoke.data, selectedKind, selectedHarness)}
            tone={toneForSmoke(smoke.data, selectedKind, selectedHarness)}
            value={selectedHarness?.smokeTest.mode ?? "Unknown"}
          />
          <StatusDetail
            icon={<Activity aria-hidden="true" className="size-4" />}
            label="Runtime"
            statusLabel={statusLabel(harnessStatus?.runtimeMode)}
            tone={harnessStatus?.healthy === true ? "success" : "neutral"}
            value={harnessStatus?.baseUrl ?? "Unavailable"}
          />
        </dl>
      )}

      <HarnessActionResult
        result={
          installSkill.data === undefined ? null : skillInstallResultToSmokeLike(installSkill.data)
        }
        error={installSkill.error}
        isPending={installSkill.isPending}
      />
      <HarnessActionResult result={smoke.data} error={smoke.error} isPending={smoke.isPending} />

      {diagnostics.length === 0 ? null : (
        <div className="mt-4 rounded-lg bg-muted-surface px-3 py-2">
          <p className="text-xs font-medium uppercase text-muted">Diagnostics</p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic}-${index}`} className="break-words font-mono text-xs">
                {redactDiagnostic(diagnostic)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HarnessActionResult({
  error,
  isPending,
  result,
}: {
  error: unknown;
  isPending: boolean;
  result: HarnessSetupSmokeResponse | null | undefined;
}) {
  if (isPending) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        <span>Pending</span>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="mt-4">
        <RedactedActionError label="Action" error={error} />
      </div>
    );
  }

  if (result === null || result === undefined) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg bg-muted-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={statusLabel(result.status)} tone={toneForStatus(result.status)} />
        <span className="min-w-0 break-words text-ink">{result.message}</span>
      </div>
      {result.checks.length === 0 ? null : (
        <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
          {result.checks.map((check) => (
            <li key={check.name} className="min-w-0">
              <span className="font-medium text-ink">{check.name}:</span>{" "}
              <span className="break-words">{check.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {result.diagnostics.length === 0 ? null : (
        <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
          {result.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic}-${index}`} className="break-words">
              {redactDiagnostic(diagnostic)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
