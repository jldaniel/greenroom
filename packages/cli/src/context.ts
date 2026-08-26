import { resolve } from "node:path";

import { readStoredApiTokenFromDataDir } from "@greenroom/supervisor";
import { resolveAppDataDir, type GreenroomEnvironment } from "@greenroom/server/config/paths";

/**
 * Shared environment resolution for CLI commands. The CLI reuses the server's
 * app-data-dir rules (GREENROOM_DATA_DIR > platform default) and the
 * supervisor's stored bootstrap token so all entry points agree on paths.
 */

export function resolveCliDataDir(
  dataDirFlag: string | null,
  env: GreenroomEnvironment = process.env,
): string {
  return resolve(dataDirFlag ?? resolveAppDataDir(env));
}

export function resolveRepoRoot(env: GreenroomEnvironment = process.env): string {
  const configured = env.GREENROOM_REPO_ROOT?.trim();

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  // packages/cli/src -> repository root.
  return resolve(import.meta.dir, "..", "..", "..");
}

export function resolveBunPath(env: GreenroomEnvironment = process.env): string {
  const configured = env.GREENROOM_BUN_PATH?.trim() ?? env.BUN_BIN?.trim();

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  // Under Bun, execPath is the running bun binary.
  return process.execPath;
}

/**
 * Resolves an API token for authenticated CLI calls: the explicit
 * GREENROOM_API_TOKEN env var first, then the token the supervisor bootstrap
 * stored in the data dir (api-token.json).
 */
export async function resolveApiToken(
  dataDir: string,
  env: GreenroomEnvironment = process.env,
): Promise<string | null> {
  const configured = env.GREENROOM_API_TOKEN?.trim();

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  return readStoredApiTokenFromDataDir(dataDir);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
