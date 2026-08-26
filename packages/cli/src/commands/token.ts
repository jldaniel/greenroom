import { isProcessAlive, readRuntimeStateFile, runtimeStateFilePath } from "@greenroom/supervisor";

import { CliUsageError, expectNoPositionals, parseCommandArgs, readStringFlag } from "../args";
import { resolveApiToken, resolveCliDataDir } from "../context";

const knownScopes = ["read", "comment:write", "thread:resolve", "review:write", "admin"] as const;
const defaultScopes = ["read", "comment:write"];
const defaultTokenName = "Greenroom CLI token";

/**
 * `greenroom token create [--name] [--scopes]`: mints a capability token
 * through the running API's `POST /api/tokens` endpoint, authenticated with
 * the admin token the `greenroom up` bootstrap stored in the data dir (the
 * same mechanism the web Settings page uses).
 */
export async function runTokenCreate(args: readonly string[]): Promise<number> {
  const parsed = parseCommandArgs(args, {
    "data-dir": "string",
    name: "string",
    scopes: "string",
  });
  expectNoPositionals(parsed, "token create");

  const name = readStringFlag(parsed, "name") ?? defaultTokenName;
  const scopes = parseScopes(readStringFlag(parsed, "scopes"));
  const dataDir = resolveCliDataDir(readStringFlag(parsed, "data-dir"));
  const state = await readRuntimeStateFile(runtimeStateFilePath(dataDir));
  const apiBaseUrl = state?.urls?.api ?? null;

  if (state === null || apiBaseUrl === null || !isProcessAlive(state.supervisorPid)) {
    console.error("Greenroom API is not running. Start it with `greenroom up` first.");
    return 1;
  }

  const adminToken = await resolveApiToken(dataDir);

  if (adminToken === null) {
    console.error(
      `No admin API token found in ${dataDir} and GREENROOM_API_TOKEN is not set. ` +
        "Run `greenroom up` once to bootstrap a token.",
    );
    return 1;
  }

  const response = await fetch(`${apiBaseUrl}/api/tokens`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, scopes }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Unable to create token (HTTP ${response.status}): ${body}`);
    return 1;
  }

  const created = (await response.json()) as {
    plaintextToken: string;
    token: { id: string; name: string; scopes: string[] };
  };

  console.log(`Created token "${created.token.name}" (${created.token.id})`);
  console.log(`Scopes: ${created.token.scopes.join(", ")}`);
  console.log("");
  console.log(created.plaintextToken);
  console.log("");
  console.log("Store this token now; it is shown only once.");
  return 0;
}

function parseScopes(raw: string | null): string[] {
  if (raw === null) {
    return [...defaultScopes];
  }

  const scopes = raw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  if (scopes.length === 0) {
    throw new CliUsageError("Expected at least one scope for --scopes");
  }

  for (const scope of scopes) {
    if (!(knownScopes as readonly string[]).includes(scope)) {
      throw new CliUsageError(`Unknown scope "${scope}". Known scopes: ${knownScopes.join(", ")}`);
    }
  }

  return scopes;
}
