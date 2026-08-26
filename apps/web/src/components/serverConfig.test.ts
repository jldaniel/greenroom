import { describe, expect, it } from "vitest";

import type { ConfigFileKeyStatus, GreenroomConfigFileData } from "../api/client";
import {
  configFromFormState,
  envOverridesFromKeys,
  fieldErrorsFromIssues,
  formStateFromConfig,
} from "./serverConfigUtils";

const loadedConfig: GreenroomConfigFileData = {
  server: { host: "127.0.0.1", port: 49_331, logLevel: "debug" },
  mcp: { port: 49_332 },
  bridge: { baseUrl: "http://127.0.0.1:49343", tokenEnv: "MY_TOKEN", timeoutMs: 180_000 },
  pathMaps: [{ from: "/container", to: "/host" }],
  workflows: { maxConcurrentRuns: 2 },
  observability: { tracingEnabled: true },
};

describe("formStateFromConfig", () => {
  it("maps the editable subset into string form fields", () => {
    const form = formStateFromConfig(loadedConfig);

    expect(form).toEqual({
      serverHost: "127.0.0.1",
      serverPort: "49331",
      mcpPort: "49332",
      bridgeBaseUrl: "http://127.0.0.1:49343",
      bridgeTokenRefKind: "tokenEnv",
      bridgeTokenRefValue: "MY_TOKEN",
      bridgeTimeoutMs: "180000",
      workflowMaxConcurrentRuns: "2",
      workflowIdleTimeoutMs: "",
      workflowAbsoluteTimeoutMs: "",
      workflowMaxMcpResourceReads: "",
    });
  });

  it("defaults every field to empty for a missing config file", () => {
    const form = formStateFromConfig({});

    expect(form.serverHost).toBe("");
    expect(form.bridgeTokenRefKind).toBe("none");
  });
});

describe("configFromFormState", () => {
  it("round-trips the form back into an equivalent config", () => {
    const { config, errors } = configFromFormState(loadedConfig, formStateFromConfig(loadedConfig));

    expect(errors).toEqual({});
    expect(config).toEqual(loadedConfig);
  });

  it("preserves keys the form does not edit", () => {
    const form = formStateFromConfig(loadedConfig);
    const { config } = configFromFormState(loadedConfig, {
      ...form,
      serverPort: "50000",
    });

    expect(config.server).toEqual({ host: "127.0.0.1", port: 50_000, logLevel: "debug" });
    expect(config.pathMaps).toEqual(loadedConfig.pathMaps);
    expect(config.observability).toEqual(loadedConfig.observability);
  });

  it("removes keys for cleared fields so built-in defaults apply", () => {
    const form = formStateFromConfig(loadedConfig);
    const { config } = configFromFormState(loadedConfig, {
      ...form,
      serverHost: "",
      serverPort: "",
      mcpPort: "",
    });

    expect(config.server).toEqual({ logLevel: "debug" });
    expect(config.mcp).toBeUndefined();
  });

  it("switching the token reference kind drops the other reference", () => {
    const form = formStateFromConfig(loadedConfig);
    const { config } = configFromFormState(loadedConfig, {
      ...form,
      bridgeTokenRefKind: "tokenFile",
      bridgeTokenRefValue: "/secrets/bridge-token",
    });

    expect(config.bridge).toEqual({
      baseUrl: "http://127.0.0.1:49343",
      tokenFile: "/secrets/bridge-token",
      timeoutMs: 180_000,
    });
  });

  it("never carries a secret token value, only references", () => {
    const { config } = configFromFormState(loadedConfig, formStateFromConfig(loadedConfig));

    expect(JSON.stringify(config)).not.toContain('token":');
    expect(config.bridge).not.toHaveProperty("token");
  });

  it("reports client-side errors for non-numeric and missing values", () => {
    const form = formStateFromConfig(loadedConfig);
    const { errors } = configFromFormState(loadedConfig, {
      ...form,
      serverPort: "not-a-number",
      bridgeTokenRefKind: "tokenEnv",
      bridgeTokenRefValue: "  ",
    });

    expect(errors["server.port"]).toBe("Must be a whole number");
    expect(errors["bridge.tokenEnv"]).toContain("required");
  });
});

describe("fieldErrorsFromIssues", () => {
  it("maps API issues to per-key messages, keeping the first per key", () => {
    const errors = fieldErrorsFromIssues([
      { path: "server.port", message: "Too big" },
      { path: "server.port", message: "Duplicate" },
      { path: "bridge", message: "mutually exclusive" },
    ]);

    expect(errors).toEqual({
      "server.port": "Too big",
      bridge: "mutually exclusive",
    });
  });
});

describe("envOverridesFromKeys", () => {
  it("indexes only env-sourced keys", () => {
    const keys: ConfigFileKeyStatus[] = [
      {
        key: "server.port",
        envVar: "GREENROOM_PORT",
        source: "env",
        secret: false,
        fileValue: 49_331,
        envValue: "60123",
      },
      {
        key: "server.host",
        envVar: "GREENROOM_HOST",
        source: "file",
        secret: false,
        fileValue: "127.0.0.1",
        envValue: null,
      },
    ];

    const overrides = envOverridesFromKeys(keys);
    expect(Object.keys(overrides)).toEqual(["server.port"]);
    expect(overrides["server.port"]?.envVar).toBe("GREENROOM_PORT");
  });
});
