import { describe, expect, it, vi } from "vitest";

import type { HarnessBridgeDetectionResponse, HarnessModelCatalog } from "@greenroom/schemas";

import type { HarnessBridgeConfig } from "./config";
import { createHarnessBridgeApp } from "./http";
import { createHarnessModelCatalogProvider, parseCodexModels, parsePiModels } from "./models";

describe("harness model catalogs", () => {
  it("normalizes Codex model/list reasoning metadata", () => {
    expect(
      parseCodexModels({
        id: 2,
        result: {
          data: [
            {
              id: "gpt-5.4",
              model: "gpt-5.4",
              displayName: "GPT-5.4",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
                { reasoningEffort: "high", description: "Deep" },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        isDefault: true,
        reasoningLevels: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      },
    ]);
  });

  it("normalizes Pi RPC models and qualifies their provider", () => {
    expect(
      parsePiModels({
        type: "response",
        command: "get_available_models",
        data: {
          models: [
            {
              provider: "openai",
              id: "gpt-5",
              name: "GPT-5",
              reasoning: true,
            },
            {
              provider: "anthropic",
              id: "claude-opus",
              reasoning: true,
              thinkingLevelMap: { low: 1024, high: null, xhigh: 8192 },
            },
          ],
        },
      }),
    ).toMatchObject([
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        reasoningLevels: [
          { id: "off" },
          { id: "minimal" },
          { id: "low" },
          { id: "medium" },
          { id: "high" },
        ],
      },
      {
        id: "anthropic/claude-opus",
        reasoningLevels: [{ id: "low" }, { id: "xhigh" }],
      },
    ]);
  });

  it("caches live catalogs by detected CLI version and refreshes on demand", async () => {
    const detection = detected("codex", "/tools/codex", "1.0.0");
    const detector = {
      snapshot: vi.fn(async () => detection),
      probe: vi.fn(async () => detection),
      recordSmoke: vi.fn(async () => null),
    };
    const discoverCodex = vi.fn(async () => ({
      result: { data: [{ id: "gpt-5", displayName: "GPT-5", isDefault: true }] },
    }));
    const provider = createHarnessModelCatalogProvider({
      detector,
      discoverCodex,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });

    const first = await provider.get("codex");
    const cached = await provider.get("codex");
    const refreshed = await provider.get("codex", { refresh: true });

    expect(first).toMatchObject({
      kind: "codex",
      source: "live",
      refreshedAt: "2026-07-18T12:00:00.000Z",
      models: [{ id: "gpt-5", isDefault: true }],
    });
    expect(cached).toEqual(first);
    expect(refreshed).toEqual(first);
    expect(discoverCodex).toHaveBeenCalledTimes(2);
    expect(detector.probe).toHaveBeenCalledTimes(1);
  });

  it("returns a usable fallback when live discovery fails", async () => {
    const provider = createHarnessModelCatalogProvider({
      detector: staticDetector(detected("pi", "/tools/pi", "0.73.1")),
      discoverPi: async () => {
        throw new Error("RPC unavailable");
      },
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });

    await expect(provider.get("pi")).resolves.toMatchObject({
      kind: "pi",
      source: "fallback",
      diagnostics: [expect.stringContaining("RPC unavailable")],
      models: [{ id: "pi", isDefault: true, reasoningLevels: [] }],
    });
  });

  it("serves model catalogs from the authenticated bridge route", async () => {
    const catalog: HarnessModelCatalog = {
      kind: "codex",
      source: "live",
      refreshedAt: "2026-07-18T12:00:00.000Z",
      diagnostics: [],
      models: [{ id: "gpt-5", label: "GPT-5", isDefault: true, reasoningLevels: [] }],
    };
    const get = vi.fn(async () => catalog);
    const app = createHarnessBridgeApp(bridgeConfig(), {
      detector: staticDetector(detected("codex", "/tools/codex", "1.0.0")),
      modelCatalogProvider: { get },
    });

    expect((await app.request("/harnesses/codex/models")).status).toBe(401);
    const response = await app.request("/harnesses/codex/models?refresh=true", {
      headers: { authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(get).toHaveBeenCalledWith("codex", { refresh: true });
  });
});

function detected(kind: string, path: string, version: string): HarnessBridgeDetectionResponse {
  return {
    probedAt: "2026-07-18T12:00:00.000Z",
    harnesses: [
      {
        kind,
        label: kind,
        command: kind,
        found: true,
        path,
        version,
        lastVerifiedVersion: version,
        recommendSmoke: false,
        probedAt: "2026-07-18T12:00:00.000Z",
        message: null,
      },
    ],
  };
}

function staticDetector(detection: HarnessBridgeDetectionResponse) {
  return {
    snapshot: async () => detection,
    probe: async () => detection,
    recordSmoke: async () => null,
  };
}

function bridgeConfig(): HarnessBridgeConfig {
  return {
    host: "127.0.0.1",
    port: 49_343,
    token: "test-token",
    stateDir: null,
    toolsDir: null,
    defaultKind: null,
    enabledKinds: [],
    command: "",
    args: [],
    pathMappings: [],
    envAllowlist: [],
    maxStderrChars: 8000,
    maxStdoutChars: 4_000_000,
    killGraceMs: 5000,
    defaultTimeoutMs: 3_600_000,
    workspaceDir: null,
    workspaceStaleGraceMs: 86_400_000,
    workspaceMaxActive: 16,
    workspaceMaxBytes: 5_368_709_120,
  };
}
