import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { greenroomConfigFileName, readGreenroomConfigFile } from "../config/file";
import type { GreenroomEnvironment } from "../config/paths";
import { createTestStorage, type TestStorage } from "../testing/storage";
import { createGreenroomApp } from "./app";
import { createGreenroomApiServices } from "./services";
import type { ConfigFileKeyStatus, ConfigFileResource } from "./config-api";

let dataDir: string;
let storage: TestStorage;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-config-api-test-"));
});

afterEach(() => {
  storage.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

function createConfigApiFixture(env: GreenroomEnvironment = {}) {
  storage = createTestStorage();
  const services = createGreenroomApiServices(storage.database, { defaultAiBackend: "mock" });
  const configFileEnv: GreenroomEnvironment = { GREENROOM_DATA_DIR: dataDir, ...env };
  const app = createGreenroomApp({ services, configFileEnv });
  const adminToken = services.tokens.create({ name: "Test admin", scopes: ["admin"] });
  const readToken = services.tokens.create({ name: "Test reader", scopes: ["read"] });

  const request = (path: string, token: string | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);

    if (token !== null) {
      headers.set("authorization", `Bearer ${token}`);
    }

    return app.request(path, { ...init, headers });
  };

  return {
    app,
    services,
    adminToken: adminToken.plaintextToken,
    readToken: readToken.plaintextToken,
    readConfig: (token: string | null) => request("/api/config/file", token),
    writeConfig: (token: string | null, config: unknown) =>
      request("/api/config/file", token, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
      }),
  };
}

function keyStatus(resource: ConfigFileResource, key: string): ConfigFileKeyStatus {
  const status = resource.keys.find((candidate) => candidate.key === key);

  if (status === undefined) {
    throw new Error(`Missing key status for ${key}`);
  }

  return status;
}

describe("config file API", () => {
  it("returns the resolved path, defaults, and no file when greenroom.toml is missing", async () => {
    const fixture = createConfigApiFixture();
    const response = await fixture.readConfig(fixture.adminToken);
    const resource = (await response.json()) as ConfigFileResource;

    expect(response.status).toBe(200);
    expect(resource.path).toBe(join(dataDir, greenroomConfigFileName));
    expect(resource.exists).toBe(false);
    expect(resource.config).toEqual({});
    expect(resource.fileError).toBeNull();
    expect(keyStatus(resource, "server.port").source).toBe("default");
    expect(keyStatus(resource, "bridge.token").source).toBe("default");
  });

  it("round-trips an edited config through PUT and GET and writes loader-readable TOML", async () => {
    const fixture = createConfigApiFixture();
    const config = {
      server: { host: "0.0.0.0", port: 50_000 },
      mcp: { port: 50_001 },
      bridge: {
        baseUrl: "http://127.0.0.1:49343",
        tokenEnv: "MY_BRIDGE_TOKEN",
        timeoutMs: 120_000,
      },
      pathMaps: [{ from: "/container", to: "/host" }],
      workflows: { maxConcurrentRuns: 2, absoluteTimeoutMs: 240_000, maxMcpResourceReads: 500 },
    };

    const putResponse = await fixture.writeConfig(fixture.adminToken, config);
    const putResource = (await putResponse.json()) as ConfigFileResource;

    expect(putResponse.status).toBe(200);
    expect(putResource.exists).toBe(true);
    expect(putResource.config).toEqual(config);
    expect(keyStatus(putResource, "server.port")).toMatchObject({
      source: "file",
      fileValue: 50_000,
      envValue: null,
    });
    expect(keyStatus(putResource, "bridge.token")).toMatchObject({
      source: "file",
      secret: true,
      fileValue: "env:MY_BRIDGE_TOKEN",
      envValue: null,
    });

    const getResponse = await fixture.readConfig(fixture.adminToken);
    const getResource = (await getResponse.json()) as ConfigFileResource;
    expect(getResource.config).toEqual(config);

    // The persisted TOML must be readable by the boot-time loader.
    const reread = readGreenroomConfigFile({ GREENROOM_DATA_DIR: dataDir });
    expect(reread.file).toEqual(config);
  });

  it("returns typed per-key issues for invalid values without writing the file", async () => {
    const fixture = createConfigApiFixture();
    const response = await fixture.writeConfig(fixture.adminToken, {
      server: { port: 99_999_999 },
      workflows: { maxConcurrentRuns: 0 },
    });
    const payload = (await response.json()) as {
      error: { code: string; details: { issues: Array<{ path: string; message: string }> } };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    const paths = payload.error.details.issues.map((issue) => issue.path);
    expect(paths).toContain("server.port");
    expect(paths).toContain("workflows.maxConcurrentRuns");

    const followUp = await fixture.readConfig(fixture.adminToken);
    const resource = (await followUp.json()) as ConfigFileResource;
    expect(resource.exists).toBe(false);
  });

  it("rejects inline bridge secrets and never persists or echoes the value", async () => {
    const fixture = createConfigApiFixture();
    const secret = "grh_super_secret_value";
    const response = await fixture.writeConfig(fixture.adminToken, {
      bridge: { token: secret },
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain(secret);
    expect(body).toContain("tokenEnv or tokenFile");

    const followUp = await fixture.readConfig(fixture.adminToken);
    const resource = (await followUp.json()) as ConfigFileResource;
    expect(resource.exists).toBe(false);
  });

  it("rejects mutually exclusive tokenEnv and tokenFile references", async () => {
    const fixture = createConfigApiFixture();
    const response = await fixture.writeConfig(fixture.adminToken, {
      bridge: { tokenEnv: "MY_TOKEN", tokenFile: "/tmp/token" },
    });
    const payload = (await response.json()) as {
      error: { code: string; details: { issues: Array<{ path: string; message: string }> } };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.details.issues[0]?.message).toContain("mutually exclusive");
  });

  it("marks env-overridden keys so the UI can warn that file edits are ineffective", async () => {
    const fixture = createConfigApiFixture({
      GREENROOM_PORT: "60123",
      GREENROOM_HARNESS_TOKEN: "grh_env_secret",
      GREENROOM_HARNESS_BASE_URL: "",
    });

    await fixture.writeConfig(fixture.adminToken, {
      server: { port: 50_000 },
      bridge: { baseUrl: "http://127.0.0.1:49343", tokenEnv: "MY_BRIDGE_TOKEN" },
    });

    const response = await fixture.readConfig(fixture.adminToken);
    const body = await response.text();
    const resource = JSON.parse(body) as ConfigFileResource;

    expect(keyStatus(resource, "server.port")).toMatchObject({
      source: "env",
      envVar: "GREENROOM_PORT",
      envValue: "60123",
      fileValue: 50_000,
    });
    // An empty GREENROOM_HARNESS_BASE_URL explicitly disables the bridge and
    // still counts as an env override.
    expect(keyStatus(resource, "bridge.baseUrl").source).toBe("env");
    expect(keyStatus(resource, "bridge.token")).toMatchObject({
      source: "env",
      secret: true,
      envValue: null,
    });
    expect(body).not.toContain("grh_env_secret");
  });

  it("reports a malformed on-disk file through fileError instead of failing", async () => {
    writeFileSync(join(dataDir, greenroomConfigFileName), '[server]\nport = "not a port"\n');
    const fixture = createConfigApiFixture();
    const response = await fixture.readConfig(fixture.adminToken);
    const resource = (await response.json()) as ConfigFileResource;

    expect(response.status).toBe(200);
    expect(resource.exists).toBe(true);
    expect(resource.config).toEqual({});
    expect(resource.fileError?.issues[0]?.path).toBe("server.port");

    // Saving from the UI overwrites the malformed file with regenerated TOML.
    const repaired = await fixture.writeConfig(fixture.adminToken, { server: { port: 50_000 } });
    expect(repaired.status).toBe(200);
    expect(readFileSync(join(dataDir, greenroomConfigFileName), "utf8")).toContain("port = 50000");
  });

  it("requires admin scope and bearer auth", async () => {
    const fixture = createConfigApiFixture();

    const unauthenticated = await fixture.readConfig(null);
    const readOnlyGet = await fixture.readConfig(fixture.readToken);
    const readOnlyPut = await fixture.writeConfig(fixture.readToken, {});

    expect(unauthenticated.status).toBe(401);
    expect(readOnlyGet.status).toBe(403);
    expect(readOnlyPut.status).toBe(403);
  });

  it("writes the annotated template when saving an empty config", async () => {
    const fixture = createConfigApiFixture();
    const response = await fixture.writeConfig(fixture.adminToken, {});

    expect(response.status).toBe(200);
    const contents = readFileSync(join(dataDir, greenroomConfigFileName), "utf8");
    expect(contents).toContain("# Greenroom configuration.");

    // The template's section headers parse to empty sections; every key stays
    // commented out, so no behavior changes until the user edits the file.
    expect(readGreenroomConfigFile({ GREENROOM_DATA_DIR: dataDir }).file).toEqual({
      server: {},
      mcp: {},
      bridge: {},
      workflows: { transcripts: {} },
      observability: {},
    });
  });
});
