import { join } from "node:path";

import type { ProcessCommand } from "./types";

export interface WorkspacePaths {
  dataDir: string;
  databasePath: string;
  harnessDir: string;
  mcpDir: string;
  repoRoot: string;
  serverDir: string;
  webDir: string;
}

export interface CommandOptions {
  apiToken: string;
  /**
   * Supervised harness bridge settings. When set, a `bridge` service command
   * is built and the API env is wired with the matching
   * GREENROOM_HARNESS_BASE_URL/GREENROOM_HARNESS_TOKEN pair. When null the
   * bridge is user-managed (or disabled): no bridge process is spawned and the
   * API inherits whatever bridge env vars the parent process has.
   */
  bridge?: { port: number; token: string } | null;
  bunPath: string;
  host: string;
  logLevel?: string | undefined;
  paths: WorkspacePaths;
  ports: {
    api: number;
    mcp: number;
    web: number;
  };
  /**
   * Built web app directory (Vite dist). When set, the API process serves the
   * SPA itself (GREENROOM_WEB_DIST) and no separate Vite dev origin needs to
   * be allowed by CORS.
   */
  webDistDir?: string | null;
}

export function createWorkspacePaths(repoRoot: string, dataDir: string): WorkspacePaths {
  return {
    dataDir,
    databasePath: join(dataDir, "greenroom.sqlite"),
    harnessDir: join(repoRoot, "packages", "harness"),
    mcpDir: join(repoRoot, "packages", "mcp"),
    repoRoot,
    serverDir: join(repoRoot, "apps", "server"),
    webDir: join(repoRoot, "apps", "web"),
  };
}

export function buildProcessCommands(options: CommandOptions): {
  api: ProcessCommand;
  bridge: ProcessCommand | null;
  mcp: ProcessCommand;
  web: ProcessCommand;
} {
  const apiBaseUrl = `http://${options.host}:${options.ports.api}`;
  const mcpBaseUrl = `http://${options.host}:${options.ports.mcp}`;
  const webBaseUrl = `http://${options.host}:${options.ports.web}`;
  const bridge = options.bridge ?? null;
  const bridgeBaseUrl = bridge === null ? null : `http://${options.host}:${bridge.port}`;
  const webDistDir = options.webDistDir ?? null;
  // In static mode the web app is same-origin with the API, so no extra CORS
  // origin is needed; in dev mode the Vite origin is cross-origin and must be
  // allowed explicitly.
  const allowedOrigins = webDistDir === null ? webBaseUrl : "";

  return {
    api: {
      name: "api",
      command: options.bunPath,
      args: ["--cwd", options.paths.serverDir, "src/cli.ts"],
      cwd: options.paths.repoRoot,
      env: {
        GREENROOM_ALLOWED_ORIGINS: allowedOrigins,
        GREENROOM_DATA_DIR: options.paths.dataDir,
        ...(webDistDir === null ? {} : { GREENROOM_WEB_DIST: webDistDir }),
        GREENROOM_DB_PATH: options.paths.databasePath,
        // Point the API at the supervised bridge with the shared token so the
        // two sides match with zero manual env wiring.
        ...(bridge === null || bridgeBaseUrl === null
          ? {}
          : {
              GREENROOM_HARNESS_BASE_URL: bridgeBaseUrl,
              GREENROOM_HARNESS_TOKEN: bridge.token,
            }),
        // Point workflow runs at the supervised MCP server. Without this the
        // API falls back to the default MCP port when it bakes the endpoint
        // into per-run harness MCP configs, which breaks (or worse, hits a
        // stale process on) any session where the MCP port differs.
        GREENROOM_MCP_BASE_URL: mcpBaseUrl,
        GREENROOM_HOST: options.host,
        GREENROOM_LOG_LEVEL: options.logLevel ?? "info",
        GREENROOM_PORT: String(options.ports.api),
      },
      readyUrl: `${apiBaseUrl}/health`,
      url: apiBaseUrl,
    },
    bridge:
      bridge === null || bridgeBaseUrl === null
        ? null
        : {
            name: "bridge",
            command: options.bunPath,
            args: ["--cwd", options.paths.harnessDir, "src/http.ts"],
            cwd: options.paths.repoRoot,
            // GREENROOM_HARNESS_KIND is intentionally not set here: the bridge
            // starts in its default (kind-less, mock-safe) mode and inherits
            // any harness kind/command vars from the parent environment.
            env: {
              GREENROOM_HARNESS_HOST: options.host,
              GREENROOM_HARNESS_PORT: String(bridge.port),
              // Harness CLI detection persists last-verified CLI
              // versions here so version changes across restarts surface a
              // re-smoke recommendation.
              GREENROOM_HARNESS_STATE_DIR: join(options.paths.dataDir, "harness"),
              // Managed tool installs: detection probes
              // `<dataDir>/tools/pi/node_modules/.bin/pi` (the managed Pi
              // fallback) ahead of the user PATH.
              GREENROOM_HARNESS_TOOLS_DIR: join(options.paths.dataDir, "tools"),
              // Snapshot repository access prepares per-run archive
              // workspaces here; stale directories are reaped by the bridge.
              GREENROOM_HARNESS_WORKSPACE_DIR: join(options.paths.dataDir, "harness-workspaces"),
              GREENROOM_HARNESS_TOKEN: bridge.token,
            },
            readyUrl: `${bridgeBaseUrl}/health`,
            url: bridgeBaseUrl,
          },
    mcp: {
      name: "mcp",
      command: options.bunPath,
      args: ["--cwd", options.paths.mcpDir, "src/http.ts"],
      cwd: options.paths.repoRoot,
      env: {
        GREENROOM_API_BASE_URL: apiBaseUrl,
        // The admin API token is intentionally NOT passed to the MCP HTTP
        // process: the endpoint no longer supports a server-side fallback
        // token, so every caller must present its own bearer token.
        GREENROOM_MCP_HOST: options.host,
        GREENROOM_MCP_PORT: String(options.ports.mcp),
      },
      readyUrl: `${mcpBaseUrl}/health`,
      url: `${mcpBaseUrl}/mcp`,
    },
    web: {
      name: "web",
      command: options.bunPath,
      args: [
        "run",
        "--cwd",
        options.paths.webDir,
        "dev",
        "--host",
        options.host,
        "--port",
        String(options.ports.web),
        "--strictPort",
      ],
      cwd: options.paths.repoRoot,
      env: {
        GREENROOM_API_PROXY_TARGET: apiBaseUrl,
        VITE_GREENROOM_API_BASE_URL: apiBaseUrl,
      },
      readyUrl: webBaseUrl,
      url: webBaseUrl,
    },
  };
}
