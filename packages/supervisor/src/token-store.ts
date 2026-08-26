import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface StoredApiToken {
  createdAt: string;
  plaintextToken: string;
  tokenId: string | null;
}

/**
 * Bootstrap API token persisted in the app data dir by `greenroom up`.
 */
export const apiTokenFileName = "api-token.json";

export function apiTokenFilePath(dataDir: string): string {
  return join(dataDir, apiTokenFileName);
}

/** Reads the stored bootstrap API token from the data dir. */
export async function readStoredApiTokenFromDataDir(dataDir: string): Promise<string | null> {
  return readStoredApiToken(apiTokenFilePath(dataDir));
}

/**
 * Harness bridge bearer token persisted in the app data dir (same stored-token
 * file shape and 0600 permissions as the API token). `greenroom up` reuses it
 * across restarts so the API's bridge configuration stays stable.
 */
export const bridgeTokenFileName = "harness-bridge-token.json";

export type BridgeTokenSource = "env" | "stored" | "generated";

export interface EnsuredBridgeToken {
  token: string;
  source: BridgeTokenSource;
}

/**
 * Resolves the bearer token shared by the supervised harness bridge and the
 * API. Precedence: an explicit GREENROOM_HARNESS_TOKEN env var wins, then the
 * token previously persisted in the data dir, else a fresh random token is
 * generated and persisted for reuse on the next start.
 */
export async function ensureBridgeToken(options: {
  env?: Record<string, string | undefined>;
  tokenPath: string;
}): Promise<EnsuredBridgeToken> {
  const env = options.env ?? process.env;
  const configured = env.GREENROOM_HARNESS_TOKEN?.trim();

  if (configured !== undefined && configured.length > 0) {
    return { token: configured, source: "env" };
  }

  const stored = await readStoredApiToken(options.tokenPath);

  if (stored !== null) {
    return { token: stored, source: "stored" };
  }

  const generated = randomBytes(32).toString("hex");
  await writeStoredApiToken(options.tokenPath, { plaintextToken: generated, tokenId: null });
  return { token: generated, source: "generated" };
}

export async function readStoredApiToken(path: string): Promise<string | null> {
  let payload: unknown;

  try {
    payload = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }

  if (!isStoredApiToken(payload)) {
    return null;
  }

  return payload.plaintextToken;
}

export async function writeStoredApiToken(
  path: string,
  token: { plaintextToken: string; tokenId: string | null },
): Promise<void> {
  const payload: StoredApiToken = {
    createdAt: new Date().toISOString(),
    plaintextToken: token.plaintextToken,
    tokenId: token.tokenId,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function isStoredApiToken(value: unknown): value is StoredApiToken {
  return (
    typeof value === "object" &&
    value !== null &&
    "plaintextToken" in value &&
    typeof value.plaintextToken === "string" &&
    value.plaintextToken.trim().length > 0 &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
