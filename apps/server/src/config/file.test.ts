import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseServerCliArgs } from "../cli";
import {
  GreenroomConfigFileError,
  defaultGreenroomConfigFileContents,
  greenroomConfigFileName,
  loadGreenroomEnvironment,
  parseGreenroomConfigFile,
  readGreenroomConfigFile,
  resolveConfigFilePath,
} from "./file";
import { readWorkflowRuntimeConfigFromEnv } from "./observability";
import { readHarnessClientConfigFromEnv } from "../api/harness-client";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-config-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function writeConfig(contents: string, fileName = greenroomConfigFileName): string {
  const path = join(dataDir, fileName);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("resolveConfigFilePath", () => {
  it("defaults to greenroom.toml in the app data dir", () => {
    expect(resolveConfigFilePath({ GREENROOM_DATA_DIR: dataDir })).toBe(
      join(dataDir, "greenroom.toml"),
    );
  });

  it("honors GREENROOM_CONFIG_PATH", () => {
    const explicit = join(dataDir, "elsewhere.toml");
    expect(
      resolveConfigFilePath({ GREENROOM_DATA_DIR: dataDir, GREENROOM_CONFIG_PATH: explicit }),
    ).toBe(explicit);
  });
});

describe("loadGreenroomEnvironment with no config file", () => {
  it("returns the environment unchanged and built-in defaults apply", () => {
    const env = { GREENROOM_DATA_DIR: dataDir, GREENROOM_DB_PATH: ":memory:" };
    const loaded = loadGreenroomEnvironment(env);

    expect(loaded.file).toBeNull();
    expect(loaded.path).toBe(join(dataDir, "greenroom.toml"));
    expect(loaded.env).toBe(env);

    const cli = parseServerCliArgs([], loaded.env);
    expect(cli.host).toBe("127.0.0.1");
    expect(cli.port).toBe(49331);
    expect(cli.logLevel).toBe("info");

    const runtime = readWorkflowRuntimeConfigFromEnv(loaded.env);
    expect(runtime.operational.maxConcurrentRuns).toBe(1);
    expect(runtime.operational.maxRepairAttempts).toBe(2);
    expect(runtime.tracing.enabled).toBe(false);

    expect(readHarnessClientConfigFromEnv(loaded.env)).toBeNull();
  });
});

describe("loadGreenroomEnvironment with a config file only", () => {
  it("applies file values across all sections", () => {
    writeConfig(`
[server]
host = "0.0.0.0"
port = 50000
logLevel = "debug"
allowedOrigins = ["http://one.test", "http://two.test"]
setupTokenEndpoint = "disabled"
webDist = "/srv/greenroom/web-dist"

[mcp]
port = 50002

[bridge]
baseUrl = "http://127.0.0.1:50003"
tokenEnv = "MY_BRIDGE_TOKEN"
timeoutMs = 3600000

[[pathMaps]]
from = "/container/repo"
to = "/host/repo"

[workflows]
maxConcurrentRuns = 3
absoluteTimeoutMs = 60000
maxMcpResourceReads = 500
maxRepairAttempts = 3

[observability]
tracingEnabled = true
otlpEndpoint = "http://127.0.0.1:4318/v1/traces"
serviceName = "greenroom-under-test"
`);

    const loaded = loadGreenroomEnvironment({
      GREENROOM_DATA_DIR: dataDir,
      MY_BRIDGE_TOKEN: "bridge-secret",
    });

    expect(loaded.file).not.toBeNull();

    const cli = parseServerCliArgs([], loaded.env);
    expect(cli.host).toBe("0.0.0.0");
    expect(cli.port).toBe(50000);
    expect(cli.logLevel).toBe("debug");
    expect(cli.allowedOrigins).toEqual(["http://one.test", "http://two.test"]);
    expect(cli.setupTokenEndpoint).toBe("disabled");
    expect(cli.webDistPath).toBe("/srv/greenroom/web-dist");

    expect(loaded.env.GREENROOM_MCP_PORT).toBe("50002");
    expect(loaded.env.GREENROOM_HARNESS_PATH_MAP_JSON).toBe(
      JSON.stringify([{ from: "/container/repo", to: "/host/repo" }]),
    );

    const bridge = readHarnessClientConfigFromEnv(loaded.env);
    expect(bridge).toEqual({
      baseUrl: "http://127.0.0.1:50003",
      token: "bridge-secret",
      timeoutMs: 3600000,
    });

    const runtime = readWorkflowRuntimeConfigFromEnv(loaded.env);
    expect(runtime.operational.maxConcurrentRuns).toBe(3);
    expect(runtime.operational.absoluteTimeoutMs).toBe(60000);
    expect(runtime.operational.maxMcpResourceReadEvents).toBe(500);
    expect(runtime.operational.maxRepairAttempts).toBe(3);
    expect(runtime.tracing.enabled).toBe(true);
    expect(runtime.tracing.otlpEndpoint).toBe("http://127.0.0.1:4318/v1/traces");
    expect(runtime.tracing.serviceName).toBe("greenroom-under-test");
  });

  it("resolves the bridge token from a token file reference", () => {
    const tokenPath = join(dataDir, "bridge-token");
    writeFileSync(tokenPath, "file-secret\n", "utf8");
    writeConfig(`
[bridge]
baseUrl = "http://127.0.0.1:50003"
tokenFile = ${JSON.stringify(tokenPath)}
`);

    const loaded = loadGreenroomEnvironment({ GREENROOM_DATA_DIR: dataDir });
    expect(loaded.env.GREENROOM_HARNESS_TOKEN).toBe("file-secret");
  });

  it("leaves the bridge disabled when the referenced env var is unset", () => {
    writeConfig(`
[bridge]
baseUrl = "http://127.0.0.1:50003"
tokenEnv = "MY_BRIDGE_TOKEN"
`);

    const loaded = loadGreenroomEnvironment({ GREENROOM_DATA_DIR: dataDir });
    expect(loaded.env.GREENROOM_HARNESS_TOKEN).toBeUndefined();
    expect(readHarnessClientConfigFromEnv(loaded.env)).toBeNull();
  });
});

describe("precedence: env var over config file, per key", () => {
  it("keeps env values and fills only unset keys from the file", () => {
    writeConfig(`
[server]
port = 50000
logLevel = "debug"
webDist = "/srv/from-file/web-dist"

[workflows]
maxConcurrentRuns = 3
maxRepairAttempts = 5
`);

    const loaded = loadGreenroomEnvironment({
      GREENROOM_DATA_DIR: dataDir,
      GREENROOM_PORT: "49999",
      GREENROOM_WEB_DIST: "/srv/from-env/web-dist",
      GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS: "5",
      GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS: "4",
    });

    const cli = parseServerCliArgs([], loaded.env);
    expect(cli.port).toBe(49999);
    expect(cli.logLevel).toBe("debug");
    expect(cli.webDistPath).toBe("/srv/from-env/web-dist");

    const runtime = readWorkflowRuntimeConfigFromEnv(loaded.env);
    expect(runtime.operational.maxConcurrentRuns).toBe(5);
    expect(runtime.operational.maxRepairAttempts).toBe(4);
  });

  it("prefers a directly set GREENROOM_HARNESS_TOKEN over the file reference", () => {
    writeConfig(`
[bridge]
baseUrl = "http://127.0.0.1:50003"
tokenEnv = "MY_BRIDGE_TOKEN"
`);

    const loaded = loadGreenroomEnvironment({
      GREENROOM_DATA_DIR: dataDir,
      GREENROOM_HARNESS_TOKEN: "env-secret",
      MY_BRIDGE_TOKEN: "file-referenced-secret",
    });

    expect(loaded.env.GREENROOM_HARNESS_TOKEN).toBe("env-secret");
  });

  it("lets an empty GREENROOM_HARNESS_BASE_URL env var disable the bridge", () => {
    writeConfig(`
[bridge]
baseUrl = "http://127.0.0.1:50003"
`);

    const loaded = loadGreenroomEnvironment({
      GREENROOM_DATA_DIR: dataDir,
      GREENROOM_HARNESS_BASE_URL: "",
    });

    expect(loaded.env.GREENROOM_HARNESS_BASE_URL).toBe("");
    expect(readHarnessClientConfigFromEnv(loaded.env)).toBeNull();
  });
});

describe("validation errors", () => {
  it("fails fast on malformed TOML with the file path in the message", () => {
    const path = writeConfig("[server\nport = ");

    expect(() => readGreenroomConfigFile({ GREENROOM_DATA_DIR: dataDir })).toThrow(
      GreenroomConfigFileError,
    );

    try {
      readGreenroomConfigFile({ GREENROOM_DATA_DIR: dataDir });
      expect.unreachable();
    } catch (error) {
      const configError = error as GreenroomConfigFileError;
      expect(configError.filePath).toBe(path);
      expect(configError.message).toContain(path);
      expect(configError.message).toContain("not valid TOML");
    }
  });

  it("names the key and problem for invalid values", () => {
    writeConfig(`
[server]
port = "not-a-port"
`);

    try {
      readGreenroomConfigFile({ GREENROOM_DATA_DIR: dataDir });
      expect.unreachable();
    } catch (error) {
      const configError = error as GreenroomConfigFileError;
      expect(configError.issues).toHaveLength(1);
      expect(configError.issues[0]?.key).toBe("server.port");
      expect(configError.message).toContain("server.port");
    }
  });

  it("rejects unknown keys with the section named", () => {
    try {
      parseGreenroomConfigFile(
        `
[server]
prot = 50000
`,
        "/tmp/greenroom.toml",
      );
      expect.unreachable();
    } catch (error) {
      const configError = error as GreenroomConfigFileError;
      expect(configError.issues[0]?.key).toBe("server");
      expect(configError.issues[0]?.message).toContain("prot");
    }
  });

  it("rejects inline secrets with an actionable message", () => {
    try {
      parseGreenroomConfigFile(
        `
[bridge]
baseUrl = "http://127.0.0.1:50003"
token = "grt_should_not_be_here"
`,
        "/tmp/greenroom.toml",
      );
      expect.unreachable();
    } catch (error) {
      const configError = error as GreenroomConfigFileError;
      expect(configError.issues[0]?.key).toContain("token");
      expect(configError.issues[0]?.message).toContain("tokenEnv or tokenFile");
    }
  });

  it("rejects configuring both tokenEnv and tokenFile", () => {
    expect(() =>
      parseGreenroomConfigFile(
        `
[bridge]
tokenEnv = "A_TOKEN"
tokenFile = "/tmp/token"
`,
        "/tmp/greenroom.toml",
      ),
    ).toThrow(/mutually exclusive/u);
  });

  it("fails fast when the referenced token file is unreadable", () => {
    writeConfig(`
[bridge]
tokenFile = ${JSON.stringify(join(dataDir, "missing-token"))}
`);

    try {
      loadGreenroomEnvironment({ GREENROOM_DATA_DIR: dataDir });
      expect.unreachable();
    } catch (error) {
      const configError = error as GreenroomConfigFileError;
      expect(configError.issues[0]?.key).toBe("bridge.tokenFile");
      expect(configError.issues[0]?.message).toContain("missing-token");
    }
  });
});

describe("defaultGreenroomConfigFileContents", () => {
  it("is valid TOML that changes no behavior", () => {
    const file = parseGreenroomConfigFile(
      defaultGreenroomConfigFileContents(),
      "/tmp/greenroom.toml",
    );

    expect(file.server).toEqual({});
    expect(file.pathMaps).toBeUndefined();
  });
});
