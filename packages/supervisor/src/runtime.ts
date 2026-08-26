import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { buildProcessCommands, createWorkspacePaths } from "./commands";
import { chooseServicePorts, defaultPreferredPorts, loopbackHost } from "./ports";
import { ServiceSupervisor } from "./supervisor";
import {
  apiTokenFilePath,
  bridgeTokenFileName,
  ensureBridgeToken,
  readStoredApiTokenFromDataDir,
  writeStoredApiToken,
} from "./token-store";
import type { RuntimeConfig, RuntimePublicConfig, ServiceLogEntry, ServiceStatus } from "./types";

export interface GreenroomRuntimeOptions {
  appDataDir: string;
  bunPath: string;
  devMode: boolean;
  env?: Record<string, string | undefined>;
  host?: string;
  repoRoot: string;
  /**
   * Built web app directory (Vite dist) for static serving. Ignored in dev
   * mode. When set (and not in dev mode), the API process serves the SPA
   * from this directory, no separate web process is spawned, and
   * `rendererUrl` is the API origin.
   */
  webDistDir?: string | null;
}

interface CreatedSetupTokenResponse {
  plaintextToken: string;
  token: {
    id: string;
  };
}

const startupTimeoutMs = 30_000;

export class GreenroomRuntime {
  readonly supervisor = new ServiceSupervisor();

  private config: RuntimeConfig | null = null;
  private started = false;

  constructor(private readonly options: GreenroomRuntimeOptions) {}

  onStatus(listener: (status: ServiceStatus) => void): void {
    this.supervisor.on("status", listener);
  }

  onLog(listener: (entry: ServiceLogEntry) => void): void {
    this.supervisor.on("log", listener);
  }

  getConfig(): RuntimeConfig {
    if (this.config === null) {
      throw new Error("Greenroom runtime has not started");
    }

    return this.config;
  }

  getPublicConfig(): RuntimePublicConfig {
    return toPublicRuntimeConfig(this.getConfig());
  }

  getStatuses(): ServiceStatus[] {
    return this.supervisor.getStatuses();
  }

  getLogs(): ServiceLogEntry[] {
    return this.supervisor.getLogs();
  }

  async start(): Promise<RuntimeConfig> {
    if (this.started) {
      return this.getConfig();
    }

    this.started = true;
    const env = this.options.env ?? process.env;
    const host = this.options.host ?? loopbackHost;
    const mode = this.options.devMode ? "development" : "packaged";
    const paths = createWorkspacePaths(this.options.repoRoot, this.options.appDataDir);
    await mkdir(paths.dataDir, { recursive: true });

    const bridgeSettings = await resolveBridgeSettings(env, paths.dataDir);
    const ports = await chooseServicePorts(host, {
      ...defaultPreferredPorts,
      ...(bridgeSettings.mode === "supervised" ? { bridge: bridgeSettings.preferredPort } : {}),
    });
    const apiBaseUrl = `http://${host}:${ports.api}`;
    const mcpBaseUrl = `http://${host}:${ports.mcp}`;
    const webDistDir = this.options.devMode ? null : (this.options.webDistDir ?? null);
    const bridge =
      bridgeSettings.mode === "supervised"
        ? { port: ports.bridge, token: bridgeSettings.token }
        : null;
    const initialCommands = buildProcessCommands({
      apiToken: "pending",
      bridge,
      bunPath: this.options.bunPath,
      host,
      logLevel: this.options.env?.GREENROOM_LOG_LEVEL,
      paths,
      ports,
      webDistDir,
    });

    try {
      // The bridge starts first: it has no dependencies, and the API reads its
      // base URL/token from env at startup.
      if (initialCommands.bridge !== null) {
        this.supervisor.start(initialCommands.bridge);
        await waitForHttpReady(initialCommands.bridge.readyUrl, startupTimeoutMs);
        this.supervisor.markRunning("bridge", initialCommands.bridge.url);
      }

      const apiCommand = initialCommands.api;
      this.supervisor.start(apiCommand);
      await waitForHttpReady(apiCommand.readyUrl, startupTimeoutMs);
      this.supervisor.markRunning("api", apiCommand.url);

      const apiToken = await ensureApiToken({
        apiBaseUrl,
        dataDir: paths.dataDir,
        env,
      });
      const commands = buildProcessCommands({
        apiToken,
        bridge,
        bunPath: this.options.bunPath,
        host,
        logLevel: this.options.env?.GREENROOM_LOG_LEVEL,
        paths,
        ports,
        webDistDir,
      });

      this.supervisor.start(commands.mcp);
      await waitForHttpReady(commands.mcp.readyUrl, startupTimeoutMs);
      this.supervisor.markRunning("mcp", commands.mcp.url);

      // Dev mode spawns the Vite dev server; otherwise the API process
      // serves the built web app from webDistDir (same origin, no extra
      // service), so the renderer URL is the API origin.
      const rendererUrl = this.options.devMode
        ? await this.startWebDevServer(commands.web)
        : apiBaseUrl;

      this.config = {
        apiBaseUrl,
        apiToken,
        bridgeBaseUrl:
          bridge !== null
            ? `http://${host}:${bridge.port}`
            : bridgeSettings.mode === "external"
              ? bridgeSettings.baseUrl
              : null,
        dataDir: paths.dataDir,
        databasePath: paths.databasePath,
        hasApiToken: true,
        host,
        mcpBaseUrl,
        mcpPath: "/mcp",
        mcpUrl: `${mcpBaseUrl}/mcp`,
        mode,
        ports: {
          api: ports.api,
          bridge: bridge !== null ? bridge.port : null,
          mcp: ports.mcp,
          web: this.options.devMode ? ports.web : null,
        },
        rendererUrl,
      };

      return this.config;
    } catch (error) {
      await this.supervisor.stopAll();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.supervisor.stopAll();
  }

  private async startWebDevServer(command: ReturnType<typeof buildProcessCommands>["web"]) {
    this.supervisor.start(command);
    await waitForHttpReady(command.readyUrl, startupTimeoutMs);
    this.supervisor.markRunning("web", command.url);
    return command.url;
  }
}

export function toPublicRuntimeConfig(config: RuntimeConfig): RuntimePublicConfig {
  return {
    apiBaseUrl: config.apiBaseUrl,
    bridgeBaseUrl: config.bridgeBaseUrl,
    dataDir: config.dataDir,
    databasePath: config.databasePath,
    hasApiToken: config.hasApiToken,
    host: config.host,
    mcpBaseUrl: config.mcpBaseUrl,
    mcpPath: config.mcpPath,
    mcpUrl: config.mcpUrl,
    mode: config.mode,
    ports: config.ports,
    rendererUrl: config.rendererUrl,
  };
}

type BridgeSettings =
  | { mode: "supervised"; preferredPort: number; token: string }
  | { mode: "external"; baseUrl: string | null };

/**
 * Decides whether the runtime supervises its own harness bridge.
 *
 * Explicit env wins: when GREENROOM_HARNESS_BASE_URL is set in the parent
 * environment — even to an empty value, which disables the bridge — the user
 * manages the bridge themselves and no bridge process is spawned (the API
 * inherits the parent env unchanged). Otherwise a bridge is supervised on
 * GREENROOM_HARNESS_PORT (default 49343) with a token resolved by
 * ensureBridgeToken (env var > persisted token > freshly generated).
 */
async function resolveBridgeSettings(
  env: Record<string, string | undefined>,
  dataDir: string,
): Promise<BridgeSettings> {
  if (env.GREENROOM_HARNESS_BASE_URL !== undefined) {
    const baseUrl = env.GREENROOM_HARNESS_BASE_URL.trim();
    return { mode: "external", baseUrl: baseUrl.length === 0 ? null : baseUrl };
  }

  const { token } = await ensureBridgeToken({
    env,
    tokenPath: join(dataDir, bridgeTokenFileName),
  });

  return {
    mode: "supervised",
    preferredPort: parsePreferredBridgePort(env.GREENROOM_HARNESS_PORT),
    token,
  };
}

function parsePreferredBridgePort(value: string | undefined): number {
  const trimmed = value?.trim();
  const parsed = trimmed === undefined || trimmed.length === 0 ? Number.NaN : Number(trimmed);

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : defaultPreferredPorts.bridge;
}

async function ensureApiToken(options: {
  apiBaseUrl: string;
  dataDir: string;
  env: Record<string, string | undefined>;
}): Promise<string> {
  const configuredToken = options.env.GREENROOM_API_TOKEN?.trim();

  if (configuredToken !== undefined && configuredToken.length > 0) {
    await assertApiTokenAccepted(options.apiBaseUrl, configuredToken);
    return configuredToken;
  }

  const storedToken = await readStoredApiTokenFromDataDir(options.dataDir);

  if (storedToken !== null && (await isApiTokenAccepted(options.apiBaseUrl, storedToken))) {
    return storedToken;
  }

  const created = await createSetupApiToken(options.apiBaseUrl);
  await writeStoredApiToken(apiTokenFilePath(options.dataDir), {
    plaintextToken: created.plaintextToken,
    tokenId: created.token.id,
  });

  return created.plaintextToken;
}

async function assertApiTokenAccepted(apiBaseUrl: string, token: string): Promise<void> {
  if (await isApiTokenAccepted(apiBaseUrl, token)) {
    return;
  }

  throw new Error("Configured Greenroom API token was rejected by the local API");
}

async function isApiTokenAccepted(apiBaseUrl: string, token: string): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl}/api/profiles`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  if (response.ok) {
    return true;
  }

  if (response.status === 401 || response.status === 403) {
    return false;
  }

  throw new Error(`Unable to validate Greenroom API token: ${response.status}`);
}

async function createSetupApiToken(apiBaseUrl: string): Promise<CreatedSetupTokenResponse> {
  const response = await fetch(`${apiBaseUrl}/api/setup/tokens`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Greenroom local admin",
      scopes: ["admin"],
    }),
  });

  if (response.status === 409) {
    throw new Error(
      "Greenroom API already has active tokens, but no valid stored token is available. Set GREENROOM_API_TOKEN to an active admin token or clear the stored token file in the app data dir.",
    );
  }

  if (!response.ok) {
    throw new Error(`Unable to create Greenroom setup token: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;

  if (!isCreatedSetupTokenResponse(payload)) {
    throw new Error("Greenroom API returned an invalid setup token response");
  }

  return payload;
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });

      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${url}${suffix}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isCreatedSetupTokenResponse(value: unknown): value is CreatedSetupTokenResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "plaintextToken" in value &&
    typeof value.plaintextToken === "string" &&
    value.plaintextToken.length > 0 &&
    "token" in value &&
    typeof value.token === "object" &&
    value.token !== null &&
    "id" in value.token &&
    typeof value.token.id === "string"
  );
}
