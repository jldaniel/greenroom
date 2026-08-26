import type {
  HarnessKindSetupStatus,
  HarnessModelCatalog,
  HarnessSetupSmokeResponse,
  HarnessSkillStatusDetail,
  HarnessStatusAvailableKind,
  HarnessStatusResponse,
  ProfileWorkflowType,
} from "@greenroom/schemas";

import type { GreenroomApiTokenStatus, GreenroomRuntimeStatus } from "../../api/client";

/**
 * Pure helpers shared by the Settings sections. Everything here is
 * presentation-free so the section components stay small and the logic stays
 * unit-testable without a DOM harness.
 */

export type StatusTone = "danger" | "neutral" | "success" | "warning";

export interface HarnessKindOption {
  kind: string;
  label: string;
  defaultModel: string;
  supportedWorkflows: ProfileWorkflowType[];
  source: "available" | "detected" | "profile";
}

export interface HarnessModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  source: "catalog" | "profile";
}

export interface HarnessReasoningOption {
  id: string;
  label: string;
  source: "catalog" | "profile";
}

export function harnessKindOptionsFromStatus(
  status: HarnessStatusResponse | undefined,
): HarnessKindOption[] {
  if (status === undefined) {
    return [];
  }

  const options = new Map<string, HarnessKindOption>();

  for (const kind of status.availableKinds) {
    options.set(kind.kind, harnessKindOptionFromAvailableKind(kind, "available"));
  }

  for (const harness of status.harnesses) {
    if (!options.has(harness.kind)) {
      options.set(harness.kind, harnessKindOptionFromAvailableKind(harness, "detected"));
    }
  }

  return [...options.values()];
}

export function harnessKindOptionsWithCurrent(
  options: HarnessKindOption[],
  currentKind: string,
): HarnessKindOption[] {
  const trimmed = currentKind.trim();

  if (trimmed.length === 0 || options.some((option) => option.kind === trimmed)) {
    return options;
  }

  return [
    ...options,
    {
      kind: trimmed,
      label: labelFromKind(trimmed),
      defaultModel: trimmed,
      supportedWorkflows: [],
      source: "profile",
    },
  ];
}

export function harnessModelOptionsWithCurrent(
  catalog: HarnessModelCatalog | undefined,
  currentModel: string,
): HarnessModelOption[] {
  const options =
    catalog?.models.map((model) => ({
      id: model.id,
      label: model.label,
      isDefault: model.isDefault,
      source: "catalog" as const,
    })) ?? [];
  const trimmed = currentModel.trim();

  if (trimmed.length === 0 || options.some((option) => option.id === trimmed)) {
    return options;
  }

  return [
    ...options,
    {
      id: trimmed,
      label: trimmed === catalog?.kind ? "Harness default" : `${trimmed} (unavailable)`,
      isDefault: trimmed === catalog?.kind,
      source: "profile",
    },
  ];
}

export function harnessReasoningOptionsWithCurrent(
  catalog: HarnessModelCatalog | undefined,
  modelId: string,
  currentReasoningLevel: string,
): HarnessReasoningOption[] {
  const model = catalog?.models.find((candidate) => candidate.id === modelId);
  const options =
    model?.reasoningLevels.map((level) => ({
      id: level.id,
      label: level.label,
      source: "catalog" as const,
    })) ?? [];
  const trimmed = currentReasoningLevel.trim();

  if (trimmed.length === 0 || options.some((option) => option.id === trimmed)) {
    return options;
  }

  return [...options, { id: trimmed, label: `${trimmed} (unavailable)`, source: "profile" }];
}

export function defaultModelFromCatalog(
  catalog: HarnessModelCatalog | undefined,
  fallback: string,
): string {
  return catalog?.models.find((model) => model.isDefault)?.id ?? catalog?.models[0]?.id ?? fallback;
}

export function reasoningLevelSupported(
  catalog: HarnessModelCatalog | undefined,
  modelId: string,
  reasoningLevel: string,
): boolean {
  const trimmed = reasoningLevel.trim();

  return (
    trimmed.length === 0 ||
    catalog?.models
      .find((model) => model.id === modelId)
      ?.reasoningLevels.some((level) => level.id === trimmed) === true
  );
}

function harnessKindOptionFromAvailableKind(
  kind: HarnessStatusAvailableKind,
  source: HarnessKindOption["source"],
): HarnessKindOption {
  return {
    kind: kind.kind,
    label: kind.label,
    defaultModel: kind.defaultModel,
    supportedWorkflows: kind.supportedWorkflows,
    source,
  };
}

export function tokenSourceLabel(source: GreenroomApiTokenStatus["source"]): string {
  if (source === "environment") {
    return "Environment token";
  }

  if (source === "browser") {
    return "Browser token";
  }

  return "Missing";
}

/**
 * "Runtime" row value in the App status panel: whether this API is running
 * under `greenroom up` supervision (per `GET /api/runtime/status`).
 */
export function supervisionLabel(runtimeStatus: GreenroomRuntimeStatus | undefined): string {
  if (runtimeStatus === undefined) {
    return "Unknown";
  }

  return runtimeStatus.supervised ? "Supervised (greenroom up)" : "Standalone";
}

export function statusLabel(status: string | null | undefined): string {
  if (status === null || status === undefined || status.trim().length === 0) {
    return "Unknown";
  }

  return status
    .split("_")
    .map((part) => (part.length === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

export function statusBadgeClassName(tone: StatusTone): string {
  if (tone === "success") {
    return "bg-success-soft text-success-ink";
  }

  if (tone === "warning") {
    return "bg-warning-soft text-warning-ink";
  }

  if (tone === "danger") {
    return "bg-danger-soft text-danger-ink";
  }

  return "bg-muted-surface text-muted";
}

export function toneForStatus(status: string | null | undefined): StatusTone {
  if (
    status === "current" ||
    status === "configured" ||
    status === "installed" ||
    status === "passed"
  ) {
    return "success";
  }

  if (status === "missing" || status === "failed") {
    return "danger";
  }

  if (status === "not_configured" || status === "outdated") {
    return "warning";
  }

  return "neutral";
}

export function skillVersionLabel(skill: HarnessSkillStatusDetail | null): string | undefined {
  if (skill === null) {
    return undefined;
  }

  if (skill.installedVersion !== null && skill.expectedVersion !== null) {
    return `${skill.installedVersion} installed; ${skill.expectedVersion} expected`;
  }

  if (skill.installedVersion !== null) {
    return `${skill.installedVersion} installed`;
  }

  if (skill.expectedVersion !== null) {
    return `${skill.expectedVersion} expected`;
  }

  return skill.skillMode === "inline_prompt" ? "Inline prompt" : undefined;
}

export function smokeStatusLabel(
  result: HarnessSetupSmokeResponse | undefined,
  selectedKind: string,
  harness: HarnessKindSetupStatus | undefined,
): string {
  if (result !== undefined && result.harnessKind === selectedKind) {
    return statusLabel(result.status);
  }

  if (harness?.smokeTest.supported === true) {
    return "Supported";
  }

  if (harness?.smokeTest.supported === false) {
    return "Unsupported";
  }

  return "Unknown";
}

export function toneForSmoke(
  result: HarnessSetupSmokeResponse | undefined,
  selectedKind: string,
  harness: HarnessKindSetupStatus | undefined,
): StatusTone {
  if (result !== undefined && result.harnessKind === selectedKind) {
    return toneForStatus(result.status);
  }

  return harness?.smokeTest.supported === false ? "neutral" : "success";
}

export function diagnosticsForHarness(
  harness: HarnessKindSetupStatus | undefined,
  skill: HarnessSkillStatusDetail | null,
): string[] {
  if (harness === undefined) {
    return [];
  }

  return [
    ...(harness.cli.message === null ? [] : [harness.cli.message]),
    ...harness.mcpSetup.diagnostics,
    ...(skill?.diagnostics ?? harness.skill.diagnostics),
  ];
}

export function skillInstallResultToSmokeLike(result: {
  kind: string;
  installed: boolean;
  skill: HarnessSkillStatusDetail;
}): HarnessSetupSmokeResponse {
  const passed = result.installed || result.skill.status === "current";

  return {
    workflowKind: "setup_smoke",
    harnessKind: result.kind,
    status: passed ? "passed" : "failed",
    message: result.installed ? "Skill installed" : `Skill ${statusLabel(result.skill.status)}`,
    checks: [
      {
        name: "Skill package",
        status: passed ? "passed" : "failed",
        summary: result.skill.path ?? statusLabel(result.skill.status),
      },
    ],
    diagnostics: result.skill.diagnostics,
  };
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(authorization|api[-_ ]?token|token|secret|provider[-_ ]?key)(\s*[:=]\s*)(["']?)[^\s"',]+/gi,
      "$1$2$3[redacted]",
    )
    .replace(/\bgreenroom_[A-Za-z0-9._-]+/g, "[redacted]");
}

export function labelFromKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

/** Matches `defaultMcpHttpPort` in `packages/mcp/src/http.ts`. */
export const defaultMcpHttpPort = 49332;

/**
 * The MCP HTTP JSON-RPC endpoint shown on the Connections section. Prefers
 * the supervised runtime's live MCP service URL; otherwise derives a loopback
 * URL from the configured `mcp.port` (or the package default).
 */
export function resolveMcpHttpEndpoint(input: {
  runtimeMcpUrl: string | null;
  configuredMcpPort: number | undefined;
}): string {
  const base =
    input.runtimeMcpUrl ?? `http://127.0.0.1:${input.configuredMcpPort ?? defaultMcpHttpPort}`;

  return `${base.replace(/\/+$/, "")}/mcp`;
}

export function formatTimestamp(timestamp: string | null): string {
  if (timestamp === null) {
    return "Never";
  }

  return new Date(timestamp).toLocaleString();
}
