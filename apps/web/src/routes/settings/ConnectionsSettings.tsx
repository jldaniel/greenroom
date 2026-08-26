import { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Plus, PlugZap, ShieldCheck, X } from "lucide-react";

import {
  clearStoredGreenroomApiToken,
  greenroomApiConfiguredBaseUrl,
  storeGreenroomApiToken,
  type GreenroomApiTokenStatus,
} from "../../api/client";
import {
  useConfigFile,
  useHarnessStatus,
  useHealth,
  useMintBrowserToken,
  useRuntimeStatus,
} from "../../api/hooks";
import { ApiErrorBanner } from "../../components/Feedback";
import { ServerConfigPanel } from "../../components/ServerConfigPanel";
import { HarnessSetupPanel } from "./HarnessSetupPanel";
import { PlaintextTokenNotice, StatusBadge } from "./settingsShared";
import { ConnectAgentCard } from "./ConnectAgentCard";
import { resolveAgentApiBaseUrl } from "./connectAgentUtils";
import {
  harnessKindOptionsFromStatus,
  resolveMcpHttpEndpoint,
  statusLabel,
  tokenSourceLabel,
  type StatusTone,
} from "./settingsUtils";

/**
 * Connections section: the browser API token, harness bridge status and
 * configuration, and the MCP endpoint with copy-paste client setup.
 */
export function ConnectionsSettings({
  tokenStatus,
  onTokenStatusChange,
}: {
  tokenStatus: GreenroomApiTokenStatus;
  onTokenStatusChange: () => void;
}) {
  const enabled = tokenStatus.source !== "missing";
  const [selectedHarnessKind, setSelectedHarnessKind] = useState("");
  const health = useHealth(enabled);
  const harnessStatus = useHarnessStatus(enabled);
  const runtimeStatus = useRuntimeStatus(enabled);
  const configFile = useConfigFile(enabled);
  const harnessKindOptions = useMemo(
    () => harnessKindOptionsFromStatus(harnessStatus.data),
    [harnessStatus.data],
  );

  useEffect(() => {
    const firstOption = harnessKindOptions[0];

    if (firstOption === undefined) {
      return;
    }

    if (
      selectedHarnessKind.trim().length === 0 ||
      harnessKindOptions.every((option) => option.kind !== selectedHarnessKind)
    ) {
      setSelectedHarnessKind(firstOption.kind);
    }
  }, [harnessKindOptions, selectedHarnessKind]);

  const supervisedServices =
    runtimeStatus.data?.supervised === true ? runtimeStatus.data.services : [];
  const mcpService = supervisedServices.find((service) => service.name === "mcp") ?? null;
  const apiService = supervisedServices.find((service) => service.name === "api") ?? null;
  const mcpHttpEndpoint = resolveMcpHttpEndpoint({
    runtimeMcpUrl: mcpService?.url ?? null,
    configuredMcpPort: configFile.data?.config.mcp?.port,
  });
  const agentApiBaseUrl = resolveAgentApiBaseUrl({
    runtimeApiUrl: apiService?.url ?? null,
    configuredBaseUrl: greenroomApiConfiguredBaseUrl,
    windowOrigin: window.location.origin,
  });

  return (
    <div className="space-y-5">
      <ApiTokenPanel tokenStatus={tokenStatus} onTokenStatusChange={onTokenStatusChange} />

      <HarnessSetupPanel
        enabled={enabled}
        harnessKindOptions={harnessKindOptions}
        harnessStatus={harnessStatus.data}
        isStatusLoading={harnessStatus.isLoading}
        onRecheck={() => {
          void Promise.all([harnessStatus.refetch(), health.refetch()]);
        }}
        selectedHarnessKind={selectedHarnessKind}
        statusError={harnessStatus.error}
        onSelectedHarnessKindChange={setSelectedHarnessKind}
      />

      <ServerConfigPanel
        enabled={enabled}
        sections={["bridge"]}
        title="Harness bridge configuration"
      />

      <McpEndpointPanel
        mcpHttpEndpoint={mcpHttpEndpoint}
        mcpServiceState={mcpService?.state ?? null}
      />

      <ConnectAgentCard
        apiBaseUrl={agentApiBaseUrl}
        enabled={enabled}
        mcpHttpEndpoint={mcpHttpEndpoint}
      />
    </div>
  );
}

function ApiTokenPanel({
  tokenStatus,
  onTokenStatusChange,
}: {
  tokenStatus: GreenroomApiTokenStatus;
  onTokenStatusChange: () => void;
}) {
  const [manualToken, setManualToken] = useState("");
  const [createdPlaintextToken, setCreatedPlaintextToken] = useState<string | null>(null);
  // Shared minting path with the wizard and the central 401 connect prompt
  // Mints "Browser"/admin, stores the token, and refetches queries.
  const createSetupToken = useMintBrowserToken();
  const canUseBrowserToken = tokenStatus.source !== "environment";

  async function handleCreateSetupToken() {
    try {
      const created = await createSetupToken.mutateAsync();
      onTokenStatusChange();
      setCreatedPlaintextToken(created.plaintextToken);
    } catch {
      // The mutation error is rendered below the create button.
    }
  }

  function handleStoreManualToken() {
    storeGreenroomApiToken(manualToken);
    setManualToken("");
    onTokenStatusChange();
  }

  function handleClearBrowserToken() {
    clearStoredGreenroomApiToken();
    onTokenStatusChange();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <KeyRound aria-hidden="true" className="mt-0.5 size-4 text-accent-ink" />
            <div className="min-w-0">
              <p className="text-sm font-medium">API token</p>
              <p className="mt-1 text-sm text-muted">{tokenSourceLabel(tokenStatus.source)}</p>
            </div>
          </div>
          {canUseBrowserToken && tokenStatus.source === "browser" ? (
            <button
              type="button"
              onClick={handleClearBrowserToken}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-muted-surface"
            >
              <X aria-hidden="true" className="size-4" />
              Clear
            </button>
          ) : null}
        </div>

        {canUseBrowserToken ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste token"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleStoreManualToken}
              disabled={manualToken.trim().length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              <Check aria-hidden="true" className="size-4" />
              Store
            </button>
          </div>
        ) : null}
      </div>

      {createdPlaintextToken === null ? null : (
        <PlaintextTokenNotice
          token={createdPlaintextToken}
          onDismiss={() => setCreatedPlaintextToken(null)}
        />
      )}

      {tokenStatus.source === "missing" ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 text-accent-ink" />
              <div>
                <p className="text-sm font-medium">Local setup token</p>
                <p className="mt-1 text-sm text-muted">No browser token configured</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateSetupToken()}
              disabled={createSetupToken.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="size-4" />
              Create
            </button>
          </div>
          {createSetupToken.error === null ? null : (
            <div className="mt-4">
              <ApiErrorBanner error={createSetupToken.error} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function McpEndpointPanel({
  mcpHttpEndpoint,
  mcpServiceState,
}: {
  mcpHttpEndpoint: string;
  mcpServiceState: string | null;
}) {
  const tone: StatusTone =
    mcpServiceState === "running"
      ? "success"
      : mcpServiceState === "failed"
        ? "danger"
        : mcpServiceState === null
          ? "neutral"
          : "warning";

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <PlugZap aria-hidden="true" className="size-4 text-accent-ink" />
        <h2 className="text-sm font-semibold tracking-normal">MCP endpoint</h2>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge
          label={mcpServiceState === "running" ? "Running" : statusLabel(mcpServiceState)}
          tone={tone}
        />
        <span className="break-all font-mono text-xs text-ink">{mcpHttpEndpoint}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        The HTTP MCP server accepts JSON-RPC on POST {"/mcp"} with an{" "}
        <span className="font-mono text-xs">Authorization: Bearer</span> token. A stdio server is
        also available; see docs/MCP.md for both transports.
      </p>
    </section>
  );
}
