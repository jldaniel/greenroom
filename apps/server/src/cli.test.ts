import { describe, expect, it } from "vitest";

import { isLoopbackHost, parseServerCliArgs, resolveSetupTokenEndpointEnabled } from "./cli";

const baseEnv = { GREENROOM_DB_PATH: ":memory:" };

describe("isLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("192.168.1.20")).toBe(false);
    expect(isLoopbackHost("example.test")).toBe(false);
  });
});

describe("resolveSetupTokenEndpointEnabled", () => {
  it("follows the bind host in auto mode", () => {
    expect(resolveSetupTokenEndpointEnabled("auto", "127.0.0.1")).toBe(true);
    expect(resolveSetupTokenEndpointEnabled("auto", "0.0.0.0")).toBe(false);
  });

  it("honors explicit overrides regardless of host", () => {
    expect(resolveSetupTokenEndpointEnabled("enabled", "0.0.0.0")).toBe(true);
    expect(resolveSetupTokenEndpointEnabled("disabled", "127.0.0.1")).toBe(false);
  });
});

describe("parseServerCliArgs setup-token options", () => {
  it("defaults to auto mode with no bootstrap token", () => {
    const config = parseServerCliArgs([], baseEnv);

    expect(config.setupTokenEndpoint).toBe("auto");
    expect(config.bootstrapAdminToken).toBeNull();
  });

  it("reads mode from flag and env with flag precedence", () => {
    expect(
      parseServerCliArgs([], { ...baseEnv, GREENROOM_SETUP_TOKEN_ENDPOINT: "disabled" })
        .setupTokenEndpoint,
    ).toBe("disabled");
    expect(
      parseServerCliArgs(["--setup-token-endpoint", "enabled"], {
        ...baseEnv,
        GREENROOM_SETUP_TOKEN_ENDPOINT: "disabled",
      }).setupTokenEndpoint,
    ).toBe("enabled");
  });

  it("rejects unknown modes", () => {
    expect(() =>
      parseServerCliArgs([], { ...baseEnv, GREENROOM_SETUP_TOKEN_ENDPOINT: "sometimes" }),
    ).toThrow(/auto, enabled, or disabled/u);
  });

  it("normalizes the bootstrap admin token from the environment", () => {
    expect(
      parseServerCliArgs([], { ...baseEnv, GREENROOM_BOOTSTRAP_ADMIN_TOKEN: "  " })
        .bootstrapAdminToken,
    ).toBeNull();
    expect(
      parseServerCliArgs([], {
        ...baseEnv,
        GREENROOM_BOOTSTRAP_ADMIN_TOKEN: "pre-provisioned-admin-token-value",
      }).bootstrapAdminToken,
    ).toBe("pre-provisioned-admin-token-value");
  });
});
