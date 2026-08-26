import { getHarnessKindDescriptor } from "@greenroom/schemas";

import type { HarnessBridgeConfig } from "../config";
import { claudeCodePreset } from "./claude-code";
import { codexPreset } from "./codex";
import { piPreset } from "./pi";
import { createRawHarnessCommandPreset } from "./raw";
import type { HarnessCommandPreset } from "./types";

const presetRegistry = new Map<string, HarnessCommandPreset>(
  [claudeCodePreset, codexPreset, piPreset].map((preset) => [preset.kind, preset]),
);

export interface ResolvedHarnessPreset {
  preset: HarnessCommandPreset;
  requestedKind: string | null;
}

export interface HarnessBridgeAvailableKind {
  kind: string;
  label: string;
  commandConfigured: boolean;
}

export function resolveHarnessPreset(input: {
  requestModel: string;
  requestHarnessKind?: string | null;
  config: HarnessBridgeConfig;
}): ResolvedHarnessPreset {
  const requestKind = resolveRequestedKind(
    input.requestHarnessKind,
    input.requestModel,
    input.config,
  );

  if (input.config.command.length > 0) {
    return {
      preset: createRawHarnessCommandPreset({
        command: input.config.command,
        args: input.config.args,
      }),
      requestedKind: requestKind,
    };
  }

  const kind = requestKind ?? input.config.defaultKind;

  if (kind === null || kind.length === 0) {
    throw new Error(
      "No harness command or kind is configured. Set GREENROOM_HARNESS_KIND or GREENROOM_HARNESS_COMMAND.",
    );
  }

  if (!isKindEnabled(kind, input.config)) {
    throw new Error(`Harness kind ${kind} is not enabled by GREENROOM_HARNESS_ENABLED_KINDS`);
  }

  const preset = presetRegistry.get(kind);

  if (preset === undefined) {
    throw new Error(`Harness kind ${kind} is not supported by this bridge`);
  }

  return { preset, requestedKind: kind };
}

export function bridgeAvailableKinds(config: HarnessBridgeConfig): HarnessBridgeAvailableKind[] {
  const kinds =
    config.enabledKinds.length > 0 ? config.enabledKinds : maybeArray(config.defaultKind);

  return kinds.map((kind) => {
    const descriptor = getHarnessKindDescriptor(kind);
    const hasPreset = presetRegistry.has(kind);

    return {
      kind,
      label: descriptor?.label ?? labelFromKind(kind),
      commandConfigured: config.command.length > 0 || hasPreset,
    };
  });
}

export function bridgeDefaultKind(config: HarnessBridgeConfig): string | null {
  return config.defaultKind;
}

export function knownPresetKinds(): string[] {
  return [...presetRegistry.keys()];
}

function resolveRequestedKind(
  requestHarnessKind: string | null | undefined,
  requestModel: string,
  config: HarnessBridgeConfig,
): string | null {
  const explicitKind = requestHarnessKind?.trim();
  const kind =
    explicitKind !== undefined && explicitKind.length > 0
      ? explicitKind
      : presetRegistry.has(requestModel)
        ? requestModel
        : null;

  if (kind === null) {
    return null;
  }

  if (!isKindEnabled(kind, config)) {
    throw new Error(`Harness kind ${kind} is not enabled by GREENROOM_HARNESS_ENABLED_KINDS`);
  }

  return kind;
}

function isKindEnabled(kind: string, config: HarnessBridgeConfig): boolean {
  return config.enabledKinds.length === 0 || config.enabledKinds.includes(kind);
}

function maybeArray(value: string | null): string[] {
  return value === null ? [] : [value];
}

function labelFromKind(kind: string): string {
  return kind
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export type { HarnessCommandPreset } from "./types";
