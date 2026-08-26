import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runtimeStateFilePath,
  writeRuntimeStateFile,
  type RuntimeStateFile,
} from "@greenroom/supervisor";

import type { GreenroomEnvironment } from "../config/paths";
import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices } from "./services";
import type { RuntimeStatusResource } from "./runtime-status";

let dataDir: string;
let storage: TestStorage;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-runtime-status-test-"));
});

afterEach(() => {
  storage.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

function createRuntimeStatusFixture(env: GreenroomEnvironment = {}) {
  storage = createTestStorage();
  const services = createGreenroomApiServices(storage.database, { defaultAiBackend: "mock" });
  const configFileEnv: GreenroomEnvironment = { GREENROOM_DATA_DIR: dataDir, ...env };
  const app = createGreenroomApp({ services, configFileEnv });
  const readToken = services.tokens.create({ name: "Test reader", scopes: ["read"] });

  const readStatus = (token: string | null) => {
    const headers = new Headers();

    if (token !== null) {
      headers.set("authorization", `Bearer ${token}`);
    }

    return app.request("/api/runtime/status", { headers });
  };

  return { app, services, readToken: readToken.plaintextToken, readStatus };
}

function createStateFile(overrides: Partial<RuntimeStateFile> = {}): RuntimeStateFile {
  return {
    version: 1,
    supervisorPid: process.pid,
    startedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:05.000Z",
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
      {
        name: "mcp",
        state: "failed",
        url: "http://127.0.0.1:49332/mcp",
        pid: null,
        startedAt: "2026-07-01T00:00:00.000Z",
        stoppedAt: "2026-07-01T00:00:04.000Z",
        exitCode: 1,
        signal: null,
        message: "Greenroom mcp service exited with code 1",
      },
    ],
    ...overrides,
  };
}

describe("runtime status API", () => {
  it("reports unsupervised when no state file exists", async () => {
    const fixture = createRuntimeStatusFixture();
    const response = await fixture.readStatus(fixture.readToken);
    const resource = (await response.json()) as RuntimeStatusResource;

    expect(response.status).toBe(200);
    expect(resource.supervised).toBe(false);
    expect(resource.reason).toBe("no-state-file");
    expect(resource.supervisor).toBeNull();
    expect(resource.services).toEqual([]);
    expect(resource.dataDir).toBe(dataDir);
  });

  it("returns per-service status with ports and lastExit when the supervisor is alive", async () => {
    await writeRuntimeStateFile(runtimeStateFilePath(dataDir), createStateFile());
    const fixture = createRuntimeStatusFixture();
    const response = await fixture.readStatus(fixture.readToken);
    const resource = (await response.json()) as RuntimeStatusResource;

    expect(response.status).toBe(200);
    expect(resource.supervised).toBe(true);
    expect(resource.reason).toBe("ok");
    expect(resource.supervisor).toEqual({
      pid: process.pid,
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(resource.services).toEqual([
      {
        name: "api",
        state: "running",
        port: 49331,
        pid: 4242,
        url: "http://127.0.0.1:49331",
        startedAt: "2026-07-01T00:00:00.000Z",
        stoppedAt: null,
        lastExit: null,
        message: null,
      },
      {
        name: "mcp",
        state: "failed",
        port: 49332,
        pid: null,
        url: "http://127.0.0.1:49332/mcp",
        startedAt: "2026-07-01T00:00:00.000Z",
        stoppedAt: "2026-07-01T00:00:04.000Z",
        lastExit: { exitCode: 1, signal: null },
        message: "Greenroom mcp service exited with code 1",
      },
    ]);
  });

  it("reports a stale state file when the supervisor process is gone", async () => {
    const exited = spawnSync("true", { stdio: "ignore" });
    await writeRuntimeStateFile(
      runtimeStateFilePath(dataDir),
      createStateFile({ supervisorPid: exited.pid }),
    );
    const fixture = createRuntimeStatusFixture();
    const response = await fixture.readStatus(fixture.readToken);
    const resource = (await response.json()) as RuntimeStatusResource;

    expect(response.status).toBe(200);
    expect(resource.supervised).toBe(false);
    expect(resource.reason).toBe("supervisor-not-running");
    expect(resource.updatedAt).toBe("2026-07-01T00:00:05.000Z");
    expect(resource.services).toEqual([]);
  });

  it("requires bearer auth", async () => {
    const fixture = createRuntimeStatusFixture();
    const response = await fixture.readStatus(null);

    expect(response.status).toBe(401);
  });
});
