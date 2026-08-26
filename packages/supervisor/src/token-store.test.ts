import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  apiTokenFileName,
  bridgeTokenFileName,
  ensureBridgeToken,
  readStoredApiToken,
  readStoredApiTokenFromDataDir,
  writeStoredApiToken,
} from "./token-store";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-token-store-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("ensureBridgeToken", () => {
  it("prefers an explicit GREENROOM_HARNESS_TOKEN env var and does not persist it", async () => {
    const tokenPath = join(dataDir, bridgeTokenFileName);
    const result = await ensureBridgeToken({
      env: { GREENROOM_HARNESS_TOKEN: "  user-token  " },
      tokenPath,
    });

    expect(result).toEqual({ token: "user-token", source: "env" });
    await expect(readStoredApiToken(tokenPath)).resolves.toBeNull();
  });

  it("generates and persists a random token when none is configured or stored", async () => {
    const tokenPath = join(dataDir, bridgeTokenFileName);
    const result = await ensureBridgeToken({ env: {}, tokenPath });

    expect(result.source).toBe("generated");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/u);
    await expect(readStoredApiToken(tokenPath)).resolves.toBe(result.token);
    // Stored with owner-only permissions like the API token file.
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
  });

  it("reuses the persisted token across restarts", async () => {
    const tokenPath = join(dataDir, bridgeTokenFileName);
    const first = await ensureBridgeToken({ env: {}, tokenPath });
    const second = await ensureBridgeToken({ env: {}, tokenPath });

    expect(second).toEqual({ token: first.token, source: "stored" });
  });

  it("ignores an empty env token and falls back to the stored token", async () => {
    const tokenPath = join(dataDir, bridgeTokenFileName);
    const first = await ensureBridgeToken({ env: {}, tokenPath });
    const second = await ensureBridgeToken({
      env: { GREENROOM_HARNESS_TOKEN: "   " },
      tokenPath,
    });

    expect(second).toEqual({ token: first.token, source: "stored" });
  });
});

describe("readStoredApiTokenFromDataDir", () => {
  it("reads the current api-token.json filename", async () => {
    await writeStoredApiToken(join(dataDir, apiTokenFileName), {
      plaintextToken: "grt_current",
      tokenId: "token_1",
    });

    await expect(readStoredApiTokenFromDataDir(dataDir)).resolves.toBe("grt_current");
  });

  it("returns null when the token file does not exist", async () => {
    await expect(readStoredApiTokenFromDataDir(dataDir)).resolves.toBeNull();
  });
});
