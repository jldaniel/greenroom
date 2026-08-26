import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureConfigFileTemplate, resolveContainerMcpConfig } from "./container";
import { defaultGreenroomConfigFileContents, greenroomConfigFileName } from "./config";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "greenroom-container-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("ensureConfigFileTemplate", () => {
  it("writes the annotated template when no config file exists", async () => {
    const result = await ensureConfigFileTemplate({ GREENROOM_DATA_DIR: dataDir });

    expect(result.created).toBe(true);
    expect(result.path).toBe(join(dataDir, greenroomConfigFileName));
    expect(readFileSync(result.path, "utf8")).toBe(defaultGreenroomConfigFileContents());
  });

  it("creates missing parent directories", async () => {
    const nestedDataDir = join(dataDir, "nested", "data");
    const result = await ensureConfigFileTemplate({ GREENROOM_DATA_DIR: nestedDataDir });

    expect(result.created).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe(defaultGreenroomConfigFileContents());
  });

  it("does not overwrite an existing config file", async () => {
    const path = join(dataDir, greenroomConfigFileName);
    writeFileSync(path, '[server]\nlogLevel = "debug"\n', "utf8");

    const result = await ensureConfigFileTemplate({ GREENROOM_DATA_DIR: dataDir });

    expect(result.created).toBe(false);
    expect(result.path).toBe(path);
    expect(readFileSync(path, "utf8")).toBe('[server]\nlogLevel = "debug"\n');
  });
});

describe("resolveContainerMcpConfig", () => {
  it("pairs the MCP endpoint with the API port over in-container loopback", () => {
    const config = resolveContainerMcpConfig({}, 49_331);

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:49331");
  });

  it("follows an overridden API port", () => {
    const config = resolveContainerMcpConfig({}, 50_000);

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:50000");
  });

  it("keeps an explicit GREENROOM_API_BASE_URL", () => {
    const config = resolveContainerMcpConfig(
      { GREENROOM_API_BASE_URL: "http://api.internal:1234" },
      49_331,
    );

    expect(config.apiBaseUrl).toBe("http://api.internal:1234");
  });

  it("keeps MCP host and port from the resolved environment", () => {
    const config = resolveContainerMcpConfig(
      { GREENROOM_MCP_HOST: "0.0.0.0", GREENROOM_MCP_PORT: "49999" },
      49_331,
    );

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(49_999);
  });
});
