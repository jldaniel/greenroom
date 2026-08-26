import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildProcessCommands, createWorkspacePaths } from "./commands";

describe("process commands", () => {
  it("builds Bun child-process commands for API, MCP, and web dev services", () => {
    const repoRoot = "/greenroom";
    const dataDir = "/tmp/greenroom-data";
    const paths = createWorkspacePaths(repoRoot, dataDir);
    const commands = buildProcessCommands({
      apiToken: "grt_test",
      bunPath: "/usr/local/bin/bun",
      host: "127.0.0.1",
      paths,
      ports: {
        api: 51001,
        mcp: 51002,
        web: 51003,
      },
    });

    expect(commands.api).toMatchObject({
      name: "api",
      command: "/usr/local/bin/bun",
      args: ["--cwd", join(repoRoot, "apps", "server"), "src/cli.ts"],
      cwd: repoRoot,
      readyUrl: "http://127.0.0.1:51001/health",
      url: "http://127.0.0.1:51001",
    });
    expect(commands.api.env).toMatchObject({
      GREENROOM_DB_PATH: join(dataDir, "greenroom.sqlite"),
      GREENROOM_HOST: "127.0.0.1",
      GREENROOM_MCP_BASE_URL: "http://127.0.0.1:51002",
      GREENROOM_PORT: "51001",
    });

    expect(commands.mcp).toMatchObject({
      name: "mcp",
      args: ["--cwd", join(repoRoot, "packages", "mcp"), "src/http.ts"],
      readyUrl: "http://127.0.0.1:51002/health",
      url: "http://127.0.0.1:51002/mcp",
    });
    expect(commands.mcp.env).toMatchObject({
      GREENROOM_API_BASE_URL: "http://127.0.0.1:51001",
      GREENROOM_MCP_HOST: "127.0.0.1",
      GREENROOM_MCP_PORT: "51002",
    });
    // The MCP HTTP endpoint has no unauthenticated fallback token;
    // the admin token must never reach that process environment.
    expect(commands.mcp.env).not.toHaveProperty("GREENROOM_API_TOKEN");

    expect(commands.web).toMatchObject({
      name: "web",
      args: [
        "run",
        "--cwd",
        join(repoRoot, "apps", "web"),
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        "51003",
        "--strictPort",
      ],
      readyUrl: "http://127.0.0.1:51003",
      url: "http://127.0.0.1:51003",
    });
    expect(commands.web.env).toMatchObject({
      GREENROOM_API_PROXY_TARGET: "http://127.0.0.1:51001",
      VITE_GREENROOM_API_BASE_URL: "http://127.0.0.1:51001",
    });
    expect(commands.web.env).not.toHaveProperty("VITE_GREENROOM_API_TOKEN");
  });

  it("builds a bridge command and wires matching bridge env into the API", () => {
    const repoRoot = "/greenroom";
    const paths = createWorkspacePaths(repoRoot, "/tmp/greenroom-data");
    const commands = buildProcessCommands({
      apiToken: "grt_test",
      bridge: { port: 49343, token: "bridge-secret" },
      bunPath: "/usr/local/bin/bun",
      host: "127.0.0.1",
      paths,
      ports: { api: 51001, mcp: 51002, web: 51003 },
    });

    expect(commands.bridge).toMatchObject({
      name: "bridge",
      command: "/usr/local/bin/bun",
      args: ["--cwd", join(repoRoot, "packages", "harness"), "src/http.ts"],
      cwd: repoRoot,
      readyUrl: "http://127.0.0.1:49343/health",
      url: "http://127.0.0.1:49343",
    });
    expect(commands.bridge?.env).toEqual({
      GREENROOM_HARNESS_HOST: "127.0.0.1",
      GREENROOM_HARNESS_PORT: "49343",
      GREENROOM_HARNESS_STATE_DIR: join(paths.dataDir, "harness"),
      // Managed tool installs: detection probes the managed Pi
      // binary under this directory ahead of the user PATH.
      GREENROOM_HARNESS_TOOLS_DIR: join(paths.dataDir, "tools"),
      GREENROOM_HARNESS_WORKSPACE_DIR: join(paths.dataDir, "harness-workspaces"),
      GREENROOM_HARNESS_TOKEN: "bridge-secret",
    });
    // The bridge stays in its default (kind-less) mode; the bridge owns
    // harness detection.
    expect(commands.bridge?.env).not.toHaveProperty("GREENROOM_HARNESS_KIND");

    // The API gets the exact same token and the bridge origin, so the pair
    // matches with zero manual env wiring.
    expect(commands.api.env.GREENROOM_HARNESS_BASE_URL).toBe("http://127.0.0.1:49343");
    expect(commands.api.env.GREENROOM_HARNESS_TOKEN).toBe(
      commands.bridge?.env.GREENROOM_HARNESS_TOKEN,
    );
  });

  it("omits the bridge command and API bridge env when the bridge is user-managed", () => {
    const paths = createWorkspacePaths("/greenroom", "/tmp/greenroom-data");
    const commands = buildProcessCommands({
      apiToken: "grt_test",
      bridge: null,
      bunPath: "/usr/local/bin/bun",
      host: "127.0.0.1",
      paths,
      ports: { api: 51001, mcp: 51002, web: 51003 },
    });

    expect(commands.bridge).toBeNull();
    expect(commands.api.env).not.toHaveProperty("GREENROOM_HARNESS_BASE_URL");
    expect(commands.api.env).not.toHaveProperty("GREENROOM_HARNESS_TOKEN");
  });

  it("omits GREENROOM_WEB_DIST and allows the Vite origin in dev mode", () => {
    const paths = createWorkspacePaths("/greenroom", "/tmp/greenroom-data");
    const commands = buildProcessCommands({
      apiToken: "grt_test",
      bunPath: "/usr/local/bin/bun",
      host: "127.0.0.1",
      paths,
      ports: { api: 51001, mcp: 51002, web: 51003 },
    });

    expect(commands.api.env).not.toHaveProperty("GREENROOM_WEB_DIST");
    expect(commands.api.env.GREENROOM_ALLOWED_ORIGINS).toBe("http://127.0.0.1:51003");
  });

  it("configures the API to serve the built web app in static mode", () => {
    const paths = createWorkspacePaths("/greenroom", "/tmp/greenroom-data");
    const commands = buildProcessCommands({
      apiToken: "grt_test",
      bunPath: "/usr/local/bin/bun",
      host: "127.0.0.1",
      paths,
      ports: { api: 51001, mcp: 51002, web: 51003 },
      webDistDir: "/greenroom/apps/web/dist",
    });

    expect(commands.api.env.GREENROOM_WEB_DIST).toBe("/greenroom/apps/web/dist");
    // Same-origin serving needs no CORS allowlist entries at all.
    expect(commands.api.env.GREENROOM_ALLOWED_ORIGINS).toBe("");
  });
});
