import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  parseGreenroomMcpHttpServerConfig,
  startGreenroomMcpHttpServer,
  type GreenroomMcpHttpServerConfig,
} from "@greenroom/mcp/http";

import { parseServerCliArgs, serverCliHelp, startGreenroomServer } from "./cli";
import {
  defaultGreenroomConfigFileContents,
  loadGreenroomEnvironment,
  resolveConfigFilePath,
  type GreenroomEnvironment,
} from "./config";

/**
 * Docker container entrypoint.
 *
 * Runs the Greenroom API (which serves the built web app) and the
 * MCP HTTP endpoint in a single Bun process, so one container covers the whole
 * production surface without a process supervisor. The harness bridge is not
 * started here: it runs on the host next to the user's harness CLI install and
 * the API reaches it through GREENROOM_HARNESS_BASE_URL (or `bridge.baseUrl`
 * in the mounted config file).
 *
 * Unlike the standalone MCP process, the in-container MCP endpoint
 * receives the config-file-resolved environment, so `[mcp]` keys in the
 * mounted greenroom.toml apply here.
 */

export interface EnsuredConfigFileTemplate {
  path: string;
  created: boolean;
}

/**
 * Writes the fully commented config template to the resolved config path when
 * no file exists yet, so the mounted data volume is self-documenting. The
 * template sets no keys and changes no behavior.
 */
export async function ensureConfigFileTemplate(
  env: GreenroomEnvironment = process.env,
): Promise<EnsuredConfigFileTemplate> {
  const path = resolveConfigFilePath(env);

  if (existsSync(path)) {
    return { path, created: false };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, defaultGreenroomConfigFileContents(), { encoding: "utf8", flag: "wx" });

  return { path, created: true };
}

/**
 * MCP endpoint config for the container: when GREENROOM_API_BASE_URL is not
 * set, the MCP endpoint talks to the API over the in-container loopback on
 * the API's actual port, so overriding GREENROOM_PORT keeps them paired.
 */
export function resolveContainerMcpConfig(
  env: GreenroomEnvironment,
  apiPort: number,
): GreenroomMcpHttpServerConfig {
  const config = parseGreenroomMcpHttpServerConfig(env);
  const explicitApiBaseUrl = env.GREENROOM_API_BASE_URL?.trim();

  if (explicitApiBaseUrl === undefined || explicitApiBaseUrl.length === 0) {
    return { ...config, apiBaseUrl: `http://127.0.0.1:${apiPort}` };
  }

  return config;
}

if (import.meta.main) {
  try {
    const template = await ensureConfigFileTemplate(process.env);

    if (template.created) {
      console.log(`Wrote annotated config file template to ${template.path}`);
    }

    const loaded = loadGreenroomEnvironment(process.env);
    const config = parseServerCliArgs(Bun.argv.slice(2), loaded.env);

    if (config.help) {
      console.log(serverCliHelp());
      process.exit(0);
    }

    const api = await startGreenroomServer(config, loaded.env);
    console.log(
      `Greenroom API listening at ${api.url} using ${api.database.path} (${config.logLevel})`,
    );

    const mcp = startGreenroomMcpHttpServer(resolveContainerMcpConfig(loaded.env, api.port));
    console.log(`Greenroom MCP HTTP listening at ${mcp.url}${mcp.path} using API ${api.url}`);

    const stop = () => {
      mcp.stop();
      api.stop();
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Greenroom container";
    console.error(message);
    process.exit(1);
  }
}
