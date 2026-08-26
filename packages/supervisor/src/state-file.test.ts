import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isProcessAlive,
  isRuntimeStateFile,
  readRuntimeStateFile,
  removeRuntimeStateFile,
  runtimeStateFilePath,
  writeRuntimeStateFile,
  type RuntimeStateFile,
} from "./state-file";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-state-file-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function createState(overrides: Partial<RuntimeStateFile> = {}): RuntimeStateFile {
  return {
    version: 1,
    supervisorPid: process.pid,
    startedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:01.000Z",
    dataDir,
    host: "127.0.0.1",
    ports: { api: 49331, bridge: 49343, mcp: 49332, web: 5173 },
    urls: {
      api: "http://127.0.0.1:49331",
      bridge: "http://127.0.0.1:49343",
      mcp: "http://127.0.0.1:49332/mcp",
      web: "http://127.0.0.1:5173",
    },
    services: [
      {
        name: "api",
        state: "running",
        url: "http://127.0.0.1:49331",
        pid: 4242,
        startedAt: "2026-07-01T00:00:00.000Z",
        stoppedAt: null,
        exitCode: null,
        signal: null,
        message: null,
      },
    ],
    ...overrides,
  };
}

describe("runtime state file", () => {
  it("round-trips a written state file", async () => {
    const path = runtimeStateFilePath(dataDir);
    const state = createState();

    await writeRuntimeStateFile(path, state);
    await expect(readRuntimeStateFile(path)).resolves.toEqual(state);
  });

  it("returns null when the state file is missing", async () => {
    await expect(readRuntimeStateFile(runtimeStateFilePath(dataDir))).resolves.toBeNull();
  });

  it("returns null for malformed or unrecognized JSON instead of throwing", async () => {
    const path = runtimeStateFilePath(dataDir);

    writeFileSync(path, "{not json", "utf8");
    await expect(readRuntimeStateFile(path)).resolves.toBeNull();

    writeFileSync(path, JSON.stringify({ version: 2, supervisorPid: 1 }), "utf8");
    await expect(readRuntimeStateFile(path)).resolves.toBeNull();
  });

  it("removes the state file idempotently", async () => {
    const path = runtimeStateFilePath(dataDir);

    await writeRuntimeStateFile(path, createState());
    await removeRuntimeStateFile(path);
    await expect(readRuntimeStateFile(path)).resolves.toBeNull();
    await expect(removeRuntimeStateFile(path)).resolves.toBeUndefined();
  });

  it("validates the state file shape", () => {
    expect(isRuntimeStateFile(createState())).toBe(true);
    expect(isRuntimeStateFile(createState({ ports: null, urls: null, services: [] }))).toBe(true);
    expect(isRuntimeStateFile(null)).toBe(false);
    expect(isRuntimeStateFile({ version: 1 })).toBe(false);
    expect(isRuntimeStateFile(createState({ supervisorPid: -1 }))).toBe(false);
  });

  it("requires the bridge port and URL fields", () => {
    expect(
      isRuntimeStateFile(
        createState({
          ports: { api: 49331, mcp: 49332, web: 5173 } as unknown as RuntimeStateFile["ports"],
          urls: {
            api: "http://127.0.0.1:49331",
            mcp: "http://127.0.0.1:49332/mcp",
            web: "http://127.0.0.1:5173",
          } as unknown as RuntimeStateFile["urls"],
        }),
      ),
    ).toBe(false);
    expect(
      isRuntimeStateFile(
        createState({ ports: { api: 49331, bridge: null, mcp: 49332, web: 5173 } }),
      ),
    ).toBe(true);
    expect(
      isRuntimeStateFile(
        createState({
          ports: { api: 49331, bridge: "no" as unknown as number, mcp: 49332, web: 5173 },
        }),
      ),
    ).toBe(false);
  });

  it("detects live and exited processes", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);

    const exited = spawnSync("true", { stdio: "ignore" });
    expect(exited.pid).toBeGreaterThan(0);
    expect(isProcessAlive(exited.pid)).toBe(false);
  });
});
