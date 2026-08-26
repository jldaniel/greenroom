import { describe, expect, it } from "vitest";

import type { HarnessModelCatalog } from "@greenroom/schemas";

import {
  defaultModelFromCatalog,
  harnessKindOptionsWithCurrent,
  harnessModelOptionsWithCurrent,
  harnessReasoningOptionsWithCurrent,
  redactDiagnostic,
  reasoningLevelSupported,
  resolveMcpHttpEndpoint,
  statusLabel,
  tokenSourceLabel,
  toneForStatus,
  type HarnessKindOption,
} from "./settingsUtils";

const modelCatalog = {
  kind: "codex",
  source: "live",
  refreshedAt: "2026-07-18T00:00:00.000Z",
  diagnostics: [],
  models: [
    {
      id: "model-default",
      label: "Default model",
      isDefault: true,
      reasoningLevels: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    },
    {
      id: "model-fast",
      label: "Fast model",
      isDefault: false,
      reasoningLevels: [{ id: "low", label: "Low" }],
    },
  ],
} satisfies HarnessModelCatalog;

describe("resolveMcpHttpEndpoint", () => {
  it("prefers the supervised runtime MCP service URL", () => {
    expect(
      resolveMcpHttpEndpoint({ runtimeMcpUrl: "http://127.0.0.1:50123", configuredMcpPort: 400 }),
    ).toBe("http://127.0.0.1:50123/mcp");
  });

  it("strips a trailing slash before appending the path", () => {
    expect(
      resolveMcpHttpEndpoint({
        runtimeMcpUrl: "http://127.0.0.1:50123/",
        configuredMcpPort: undefined,
      }),
    ).toBe("http://127.0.0.1:50123/mcp");
  });

  it("derives a loopback URL from the configured MCP port", () => {
    expect(resolveMcpHttpEndpoint({ runtimeMcpUrl: null, configuredMcpPort: 40001 })).toBe(
      "http://127.0.0.1:40001/mcp",
    );
  });

  it("falls back to the packages/mcp default port", () => {
    expect(resolveMcpHttpEndpoint({ runtimeMcpUrl: null, configuredMcpPort: undefined })).toBe(
      "http://127.0.0.1:49332/mcp",
    );
  });
});

describe("statusLabel", () => {
  it("humanizes underscored statuses", () => {
    expect(statusLabel("not_configured")).toBe("Not Configured");
    expect(statusLabel("passed")).toBe("Passed");
  });

  it("labels missing values as unknown", () => {
    expect(statusLabel(null)).toBe("Unknown");
    expect(statusLabel(undefined)).toBe("Unknown");
    expect(statusLabel("  ")).toBe("Unknown");
  });
});

describe("toneForStatus", () => {
  it("maps statuses onto tones", () => {
    expect(toneForStatus("current")).toBe("success");
    expect(toneForStatus("failed")).toBe("danger");
    expect(toneForStatus("outdated")).toBe("warning");
    expect(toneForStatus("anything-else")).toBe("neutral");
  });
});

describe("tokenSourceLabel", () => {
  it("labels each source", () => {
    expect(tokenSourceLabel("environment")).toBe("Environment token");
    expect(tokenSourceLabel("browser")).toBe("Browser token");
    expect(tokenSourceLabel("missing")).toBe("Missing");
  });
});

describe("harnessKindOptionsWithCurrent", () => {
  const options: HarnessKindOption[] = [
    {
      kind: "claude-code",
      label: "Claude Code",
      defaultModel: "claude-code",
      supportedWorkflows: [],
      source: "available",
    },
  ];

  it("returns known options unchanged", () => {
    expect(harnessKindOptionsWithCurrent(options, "claude-code")).toBe(options);
    expect(harnessKindOptionsWithCurrent(options, "  ")).toBe(options);
  });

  it("appends a synthetic option for a profile-only kind", () => {
    const extended = harnessKindOptionsWithCurrent(options, "codex");

    expect(extended).toHaveLength(2);
    expect(extended[1]).toMatchObject({ kind: "codex", label: "Codex", source: "profile" });
  });
});

describe("harness model options", () => {
  it("uses catalog labels and preserves an unavailable saved model", () => {
    expect(harnessModelOptionsWithCurrent(modelCatalog, "model-default")).toHaveLength(2);
    expect(harnessModelOptionsWithCurrent(modelCatalog, "retired-model").at(-1)).toEqual({
      id: "retired-model",
      label: "retired-model (unavailable)",
      isDefault: false,
      source: "profile",
    });
  });

  it("uses the marked default, then the first model, then the fallback", () => {
    expect(defaultModelFromCatalog(modelCatalog, "fallback")).toBe("model-default");
    expect(
      defaultModelFromCatalog(
        {
          ...modelCatalog,
          models: modelCatalog.models.map((model) => ({ ...model, isDefault: false })),
        },
        "fallback",
      ),
    ).toBe("model-default");
    expect(defaultModelFromCatalog(undefined, "fallback")).toBe("fallback");
  });
});

describe("harness reasoning options", () => {
  it("returns levels for the selected model and preserves an unavailable saved level", () => {
    expect(harnessReasoningOptionsWithCurrent(modelCatalog, "model-default", "")).toEqual([
      { id: "low", label: "Low", source: "catalog" },
      { id: "high", label: "High", source: "catalog" },
    ]);
    expect(harnessReasoningOptionsWithCurrent(modelCatalog, "model-fast", "high").at(-1)).toEqual({
      id: "high",
      label: "high (unavailable)",
      source: "profile",
    });
  });

  it("recognizes inherit and model-specific supported levels", () => {
    expect(reasoningLevelSupported(modelCatalog, "model-fast", "")).toBe(true);
    expect(reasoningLevelSupported(modelCatalog, "model-fast", "low")).toBe(true);
    expect(reasoningLevelSupported(modelCatalog, "model-fast", "high")).toBe(false);
    expect(reasoningLevelSupported(undefined, "model-fast", "high")).toBe(false);
  });
});

describe("redactDiagnostic", () => {
  it("redacts bearer tokens and token-looking values", () => {
    expect(redactDiagnostic("Authorization: Bearer greenroom_abc.def")).not.toContain("abc");
    expect(redactDiagnostic("token=supersecret")).toBe("token=[redacted]");
    expect(redactDiagnostic("greenroom_tok123 rejected")).toBe("[redacted] rejected");
  });
});
