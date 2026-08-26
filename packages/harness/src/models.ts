import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  getHarnessKindDescriptor,
  harnessModelCatalogSchema,
  type HarnessBridgeDetectionResponse,
  type HarnessModelCatalog,
  type HarnessModelCatalogModel,
  type HarnessModelReasoningLevel,
} from "@greenroom/schemas";

import { buildHarnessSubprocessEnv } from "./config";
import type { HarnessDetector } from "./detect";

export interface HarnessModelCatalogProvider {
  get: (kind: string, options?: { refresh?: boolean }) => Promise<HarnessModelCatalog | null>;
}

export interface HarnessModelCatalogProviderOptions {
  detector: HarnessDetector;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  now?: () => Date;
  discoverCodex?: (command: string) => Promise<unknown>;
  discoverPi?: (command: string) => Promise<unknown>;
  probeClaudeHelp?: (command: string) => Promise<string>;
}

const defaultDiscoveryTimeoutMs = 8_000;

export function createHarnessModelCatalogProvider(
  options: HarnessModelCatalogProviderOptions,
): HarnessModelCatalogProvider {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? defaultDiscoveryTimeoutMs;
  const now = options.now ?? (() => new Date());
  const cache = new Map<string, { version: string | null; catalog: HarnessModelCatalog }>();

  return {
    async get(kind, requestOptions = {}) {
      const descriptor = getHarnessKindDescriptor(kind);

      if (descriptor === null) {
        return null;
      }

      const detection = requestOptions.refresh
        ? await options.detector.probe()
        : await options.detector.snapshot();
      const detected = detectionForKind(detection, kind);
      const cached = cache.get(kind);

      if (!requestOptions.refresh && cached !== undefined && cached.version === detected?.version) {
        return cloneCatalog(cached.catalog);
      }

      const refreshedAt = now().toISOString();
      let catalog: HarnessModelCatalog;

      if (kind === "claude-code") {
        catalog = await discoverClaudeCatalog({
          command: detected?.found === true ? detected.path : null,
          refreshedAt,
          timeoutMs,
          env,
          ...(options.probeClaudeHelp === undefined ? {} : { probeHelp: options.probeClaudeHelp }),
        });
      } else if (detected?.found !== true || detected.path === null) {
        catalog = fallbackCatalog(
          kind,
          refreshedAt,
          `${descriptor.label} CLI is not installed or could not be detected.`,
        );
      } else if (kind === "codex") {
        catalog = await discoverLiveCatalog({
          kind,
          command: detected.path,
          refreshedAt,
          discover:
            options.discoverCodex ?? ((command) => queryCodexModels(command, env, timeoutMs)),
          parse: parseCodexModels,
        });
      } else if (kind === "pi") {
        catalog = await discoverLiveCatalog({
          kind,
          command: detected.path,
          refreshedAt,
          discover: options.discoverPi ?? ((command) => queryPiModels(command, env, timeoutMs)),
          parse: parsePiModels,
        });
      } else {
        catalog = fallbackCatalog(
          kind,
          refreshedAt,
          `No model discovery adapter exists for ${kind}.`,
        );
      }

      cache.set(kind, { version: detected?.version ?? null, catalog });
      return cloneCatalog(catalog);
    },
  };
}

async function discoverLiveCatalog(input: {
  kind: string;
  command: string;
  refreshedAt: string;
  discover: (command: string) => Promise<unknown>;
  parse: (payload: unknown) => HarnessModelCatalogModel[];
}): Promise<HarnessModelCatalog> {
  try {
    const models = input.parse(await input.discover(input.command));

    if (models.length === 0) {
      throw new Error("the CLI returned no usable models");
    }

    return harnessModelCatalogSchema.parse({
      kind: input.kind,
      source: "live",
      refreshedAt: input.refreshedAt,
      diagnostics: [],
      models: ensureDefault(models),
    });
  } catch (error) {
    return fallbackCatalog(
      input.kind,
      input.refreshedAt,
      `Live model discovery failed: ${errorMessage(error)}`,
    );
  }
}

async function discoverClaudeCatalog(input: {
  command: string | null;
  refreshedAt: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  probeHelp?: (command: string) => Promise<string>;
}): Promise<HarnessModelCatalog> {
  const diagnostics: string[] = [];
  let effortSupported = true;

  if (input.command === null) {
    diagnostics.push("Claude Code CLI is not installed; showing Greenroom's built-in catalog.");
  } else {
    try {
      const help = input.probeHelp
        ? await input.probeHelp(input.command)
        : await captureCommand(input.command, ["--help"], input.env, input.timeoutMs);
      effortSupported = /(?:^|\s)--effort(?:\s|,|$)/mu.test(help);

      if (!effortSupported) {
        diagnostics.push("The installed Claude Code CLI does not advertise --effort.");
      }
    } catch (error) {
      diagnostics.push(`Claude Code capability probe failed: ${errorMessage(error)}`);
    }
  }

  const defaultReasoningLevels = effortSupported
    ? ["low", "medium", "high", "max"].map((level) => reasoningLevel(level))
    : [];
  const opusReasoningLevels = effortSupported
    ? ["low", "medium", "high", "xhigh", "max"].map((level) => reasoningLevel(level))
    : [];

  return harnessModelCatalogSchema.parse({
    kind: "claude-code",
    source: "built_in",
    refreshedAt: input.refreshedAt,
    diagnostics,
    models: [
      model("claude-code", "Claude Code default", true, defaultReasoningLevels),
      model("sonnet", "Sonnet", false, defaultReasoningLevels),
      model("opus", "Opus", false, opusReasoningLevels),
      model("haiku", "Haiku", false, []),
    ],
  });
}

function fallbackCatalog(
  kind: string,
  refreshedAt: string,
  diagnostic: string,
): HarnessModelCatalog {
  const descriptor = getHarnessKindDescriptor(kind);
  const id = descriptor?.defaultModel ?? kind;
  return harnessModelCatalogSchema.parse({
    kind,
    source: "fallback",
    refreshedAt,
    diagnostics: [diagnostic.slice(0, 1000)],
    models: [model(id, descriptor?.defaultModelDisplay ?? `${kind} default`, true, [])],
  });
}

export function parseCodexModels(payload: unknown): HarnessModelCatalogModel[] {
  const result = recordValue(recordValue(payload)?.result) ?? recordValue(payload);
  const data = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result?.models)
      ? result.models
      : [];

  return uniqueModels(
    data.flatMap((candidate) => {
      const entry = recordValue(candidate);
      const id = stringValue(entry?.id) ?? stringValue(entry?.model);

      if (id === null) {
        return [];
      }

      const efforts = Array.isArray(entry?.supportedReasoningEfforts)
        ? entry.supportedReasoningEfforts
        : [];
      const levels = efforts.flatMap((effort) => {
        const value = recordValue(effort);
        const effortId = stringValue(value?.reasoningEffort) ?? stringValue(value?.id);
        return effortId === null ? [] : [{ id: effortId, label: titleCase(effortId) }];
      });

      return [
        model(
          id,
          stringValue(entry?.displayName) ?? stringValue(entry?.name) ?? id,
          entry?.isDefault === true,
          levels,
        ),
      ];
    }),
  );
}

export function parsePiModels(payload: unknown): HarnessModelCatalogModel[] {
  const response = recordValue(payload);
  const data = recordValue(response?.data);
  const candidates = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(response?.models)
      ? response.models
      : Array.isArray(payload)
        ? payload
        : [];

  return uniqueModels(
    candidates.flatMap((candidate) => {
      const entry = recordValue(candidate);
      const modelId = stringValue(entry?.id) ?? stringValue(entry?.model);

      if (modelId === null) {
        return [];
      }

      const provider = stringValue(entry?.provider);
      const id = provider === null || modelId.includes("/") ? modelId : `${provider}/${modelId}`;
      const thinkingLevelMap = recordValue(entry?.thinkingLevelMap);
      const mappedLevels =
        thinkingLevelMap === null
          ? []
          : Object.entries(thinkingLevelMap)
              .filter(([, value]) => value !== null && value !== false)
              .map(([level]) => reasoningLevel(level));
      const explicitLevels = firstArray(
        entry?.supportedThinkingLevels,
        entry?.thinkingLevels,
        entry?.reasoningLevels,
      );
      const levels =
        mappedLevels.length > 0
          ? mappedLevels
          : explicitLevels.length > 0
            ? explicitLevels.flatMap((level) => {
                const levelRecord = recordValue(level);
                const levelId =
                  stringValue(levelRecord?.id) ??
                  stringValue(levelRecord?.value) ??
                  stringValue(level);
                return levelId === null
                  ? []
                  : [reasoningLevel(levelId, stringValue(levelRecord?.label))];
              })
            : entry?.reasoning === true
              ? ["off", "minimal", "low", "medium", "high"].map((level) => reasoningLevel(level))
              : [];

      return [
        model(
          id,
          stringValue(entry?.name) ?? stringValue(entry?.displayName) ?? id,
          entry?.isDefault === true,
          levels,
        ),
      ];
    }),
  );
}

async function queryCodexModels(
  command: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<unknown> {
  // Model metadata is bundled with Codex and does not require account auth.
  // Isolated HOME and CODEX_HOME values prevent model discovery from starting
  // user-configured MCP servers or plugin-contributed tools during app-server
  // initialization, including when the bridge itself has CODEX_HOME set.
  const isolatedHome = await mkdtemp(join(tmpdir(), "greenroom-codex-catalog-"));

  try {
    return await jsonLineExchange({
      command,
      args: ["app-server"],
      env: { ...env, HOME: isolatedHome, CODEX_HOME: isolatedHome },
      timeoutMs,
      messages: [
        {
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "greenroom", title: "Greenroom", version: "0.0.0" },
            capabilities: { experimentalApi: true, requestAttestation: false },
          },
        },
      ],
      after: {
        accept: (message) => recordValue(message)?.id === 1,
        messages: [
          { method: "initialized", params: {} },
          {
            id: 2,
            method: "model/list",
            params: { cursor: null, limit: 500, includeHidden: false },
          },
        ],
      },
      accept: (message) => recordValue(message)?.id === 2,
    });
  } finally {
    await rm(isolatedHome, { force: true, recursive: true });
  }
}

async function queryPiModels(
  command: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<unknown> {
  return jsonLineExchange({
    command,
    args: ["--mode", "rpc"],
    env,
    timeoutMs,
    messages: [{ type: "get_available_models" }],
    accept: (message) => {
      const value = recordValue(message);
      return value?.type === "response" && value.command === "get_available_models";
    },
  });
}

async function jsonLineExchange(input: {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
  messages: unknown[];
  after?: { accept: (message: unknown) => boolean; messages: unknown[] };
  accept: (message: unknown) => boolean;
}): Promise<unknown> {
  const child = spawn(input.command, input.args, {
    env: buildHarnessSubprocessEnv([], input.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });

  const lines = createInterface({ input: child.stdout });

  try {
    const result = new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let afterSent = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error(`discovery timed out after ${input.timeoutMs}ms`))),
        input.timeoutMs,
      );

      child.once("error", (error) => finish(() => reject(error)));
      child.once("exit", (code) => {
        const detail = safeDiagnostic(stderr, input.env);
        finish(() =>
          reject(
            new Error(
              code === 0
                ? "CLI exited before returning model data"
                : `CLI exited with status ${code}${detail === "" ? "" : `: ${detail}`}`,
            ),
          ),
        );
      });
      lines.on("line", (line) => {
        try {
          const message: unknown = JSON.parse(line);

          if (!afterSent && input.after?.accept(message) === true) {
            afterSent = true;
            for (const nextMessage of input.after.messages) {
              child.stdin.write(`${JSON.stringify(nextMessage)}\n`);
            }
          }

          if (input.accept(message)) {
            finish(() => resolve(message));
          }
        } catch {
          // Ignore human-readable status output around the JSONL protocol.
        }
      });
    });

    for (const message of input.messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    return await result;
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

async function captureCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<string> {
  const proc = Bun.spawn({
    cmd: [command, ...args],
    env: buildHarnessSubprocessEnv([], env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`capability probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const output = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const [stdout, stderr, exitCode] = await Promise.race([output, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });

  if (exitCode !== 0) {
    throw new Error(`capability probe exited with status ${exitCode}`);
  }

  return `${stdout}\n${stderr}`;
}

function detectionForKind(detection: HarnessBridgeDetectionResponse, kind: string) {
  return detection.harnesses.find((candidate) => candidate.kind === kind);
}

function model(
  id: string,
  label: string,
  isDefault: boolean,
  reasoningLevels: HarnessModelReasoningLevel[],
): HarnessModelCatalogModel {
  return { id, label, isDefault, reasoningLevels };
}

function reasoningLevel(id: string, label?: string | null): HarnessModelReasoningLevel {
  return { id, label: label ?? titleCase(id) };
}

function ensureDefault(models: HarnessModelCatalogModel[]): HarnessModelCatalogModel[] {
  return models.some((candidate) => candidate.isDefault)
    ? models
    : models.map((candidate, index) => ({ ...candidate, isDefault: index === 0 }));
}

function uniqueModels(models: HarnessModelCatalogModel[]): HarnessModelCatalogModel[] {
  const seen = new Set<string>();
  return models.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function cloneCatalog(catalog: HarnessModelCatalog): HarnessModelCatalog {
  return {
    ...catalog,
    diagnostics: [...catalog.diagnostics],
    models: catalog.models.map((entry) => ({
      ...entry,
      reasoningLevels: entry.reasoningLevels.map((level) => ({ ...level })),
    })),
  };
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeDiagnostic(value: string, env: Record<string, string | undefined>): string {
  let redacted = value.trim();

  for (const [name, secret] of Object.entries(env)) {
    if (/(?:TOKEN|KEY|SECRET|PASSWORD)/u.test(name) && secret !== undefined && secret.length >= 8) {
      redacted = redacted.replaceAll(secret, "[redacted]");
    }
  }

  return redacted
    .replace(/\b(?:grt_|sk-)[A-Za-z0-9_-]{12,}\b/gu, "[redacted-token]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .slice(0, 900);
}
