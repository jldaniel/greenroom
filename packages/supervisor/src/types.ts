export type ServiceName = "api" | "bridge" | "mcp" | "web";

export type ServiceState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "exited"
  | "failed";

export type LogStream = "stdout" | "stderr" | "system";

export interface ServiceStatus {
  name: ServiceName;
  state: ServiceState;
  url: string | null;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  message: string | null;
}

export interface ServiceLogEntry {
  id: number;
  service: ServiceName;
  stream: LogStream;
  message: string;
  timestamp: string;
}

export interface RuntimePublicConfig {
  apiBaseUrl: string;
  /**
   * Harness bridge origin the API is configured to call. Null when the bridge
   * is disabled (GREENROOM_HARNESS_BASE_URL explicitly set to an empty value).
   */
  bridgeBaseUrl: string | null;
  dataDir: string;
  databasePath: string;
  hasApiToken: boolean;
  host: string;
  mcpBaseUrl: string;
  mcpPath: string;
  mcpUrl: string;
  mode: "development" | "packaged";
  ports: {
    api: number;
    /** Null when the bridge is user-managed (external) or disabled. */
    bridge: number | null;
    mcp: number;
    web: number | null;
  };
  rendererUrl: string;
}

export interface RuntimeConfig extends RuntimePublicConfig {
  apiToken: string;
}

export interface ProcessCommand {
  name: ServiceName;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  readyUrl: string;
  url: string;
}
