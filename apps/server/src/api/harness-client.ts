import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getHarnessKindDescriptor,
  greenroomHarnessSkillPackageVersion,
  harnessKindFromProfile,
  harnessBridgeDetectionResponseSchema,
  harnessBridgeHealthResponseSchema,
  harnessModelCatalogSchema,
  harnessBridgeSmokeRecordResponseSchema,
  harnessRunJobCreateResponseSchema,
  harnessRunJobEventsResponseSchema,
  harnessRunJobSchema,
  harnessRunRequestSchema,
  harnessRunResponseSchema,
  harnessSetupSmokeResponseSchema,
  harnessSkillCheckResponseSchema,
  harnessSkillInstallResponseSchema,
  harnessStatusResponseSchema,
  listKnownHarnessKindDescriptors,
  workflowSetupSmokeDraftOutputSchema,
  type HarnessBridgeDetectionResponse,
  type HarnessBridgeCapability,
  type HarnessBridgeHealthResponse,
  type HarnessBridgeSmokeRecordResponse,
  type HarnessDetectedCli,
  type HarnessKindDescriptor,
  type HarnessKindSetupStatus,
  type HarnessLocalCliStatus,
  type HarnessModelCatalog,
  type HarnessMcpSetupStatusDetail,
  type HarnessRunJob,
  type HarnessRunRequest,
  type HarnessRunProfile,
  type HarnessRunResponse,
  type HarnessStreamEvent,
  type HarnessSetupSmokeCheckResult,
  type HarnessSetupSmokeResponse,
  type HarnessSkillCheckResponse,
  type HarnessSkillInstallResponse,
  type HarnessSkillStatusDetail,
  type HarnessStatusAvailableKind,
  type HarnessStatusResponse,
  type Profile,
} from "@greenroom/schemas";

import { redactDiagnostic, redactString } from "../config";
import { ApiHttpError } from "./errors";

export interface HarnessClient {
  run: (request: HarnessRunRequest, options?: HarnessRunOptions) => Promise<HarnessRunResponse>;
  health?: () => Promise<HarnessBridgeHealthResponse>;
  /** Reads the bridge's detected harness CLIs. */
  detectedHarnesses?: (options?: { refresh?: boolean }) => Promise<HarnessBridgeDetectionResponse>;
  /** Lists model and reasoning choices exposed by a harness kind. */
  models?: (kind: string, options?: { refresh?: boolean }) => Promise<HarnessModelCatalog>;
  /** Records a successful smoke run on the bridge so the detected version becomes verified. */
  recordSmoke?: (kind: string) => Promise<HarnessBridgeSmokeRecordResponse>;
  config?: HarnessClientConfig | null;
}

export interface HarnessRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: HarnessStreamEvent) => void;
  onJobUpdate?: (job: HarnessRunJob) => void;
}

export interface HarnessClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

// Extra time granted to the bridge's own timeout handling (SIGTERM, grace,
// SIGKILL, structured response) before the HTTP request itself is aborted.
const bridgeTimeoutAbortGraceMs = 15_000;
const defaultHarnessClientTimeoutMs = 3_600_000;
const maxHarnessClientTimeoutMs = 86_400_000;

export class HarnessRunFailedError extends Error {
  readonly run: HarnessRunResponse;

  constructor(run: HarnessRunResponse) {
    super(formatHarnessRunFailureMessage(run));
    this.name = "HarnessRunFailedError";
    this.run = run;
  }
}

export function createHarnessClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): HarnessClient | null {
  const config = readHarnessClientConfigFromEnv(env);

  return config === null ? null : createHttpHarnessClient(config);
}

export function readHarnessClientConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): HarnessClientConfig | null {
  const baseUrl = env.GREENROOM_HARNESS_BASE_URL?.trim();
  const token = env.GREENROOM_HARNESS_TOKEN?.trim();

  if (baseUrl === undefined || baseUrl.length === 0) {
    return null;
  }

  if (token === undefined || token.length === 0) {
    return null;
  }

  return {
    baseUrl,
    token,
    timeoutMs: parseTimeoutMs(env.GREENROOM_HARNESS_TIMEOUT_MS),
  };
}

export function createHttpHarnessClient(config: HarnessClientConfig): HarnessClient {
  const baseUrl = config.baseUrl.replace(/\/+$/u, "");
  const redaction = { env: process.env, extraSecrets: [config.token], maxChars: 4000 };

  async function bridgeJsonRequest(input: {
    path: string;
    method: "GET" | "POST";
    timeoutMessage: string;
    body?: unknown;
  }): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 10_000));
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.token}`,
    };

    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    try {
      const response = await fetch(`${baseUrl}${input.path}`, {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: controller.signal,
      });
      const payload = (await readJsonResponse(response)) as unknown;

      if (!response.ok) {
        throw new ApiHttpError(
          500,
          "internal_error",
          redactDiagnostic(bridgeErrorMessage(response.status, payload), redaction),
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof ApiHttpError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(input.timeoutMessage, { cause: error });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readBridgeHealth(): Promise<HarnessBridgeHealthResponse> {
    const payload = await bridgeJsonRequest({
      path: "/health",
      method: "GET",
      timeoutMessage: "Harness bridge health check timed out",
    });
    return harnessBridgeHealthResponseSchema.parse(payload);
  }

  return {
    config: { ...config, baseUrl },
    async health() {
      return readBridgeHealth();
    },
    async detectedHarnesses(options = {}) {
      const payload = await bridgeJsonRequest({
        path: options.refresh === true ? "/harnesses?refresh=true" : "/harnesses",
        method: "GET",
        timeoutMessage: "Harness bridge detection request timed out",
      });
      return harnessBridgeDetectionResponseSchema.parse(payload);
    },
    async models(kind, options = {}) {
      const suffix = options.refresh === true ? "?refresh=true" : "";
      const payload = await bridgeJsonRequest({
        path: `/harnesses/${encodeURIComponent(kind)}/models${suffix}`,
        method: "GET",
        timeoutMessage: "Harness model catalog request timed out",
      });
      return harnessModelCatalogSchema.parse(payload);
    },
    async recordSmoke(kind) {
      const payload = await bridgeJsonRequest({
        path: `/harnesses/${encodeURIComponent(kind)}/smoke`,
        method: "POST",
        timeoutMessage: "Harness bridge smoke recording timed out",
      });
      return harnessBridgeSmokeRecordResponseSchema.parse(payload);
    },
    async run(request, options = {}) {
      const parsed = harnessRunRequestSchema.parse(request);
      await assertRepositoryAccessSupported(parsed, readBridgeHealth);
      const requestedTimeoutMs = parsed.timeoutMs ?? config.timeoutMs;
      // The bridge clamps the run timeout to the API-provided budget and
      // reports the clamp in execution metadata, so the requested timeout is
      // forwarded unclamped alongside the budget.
      let job: HarnessRunJob | null = null;
      let cursor = 0;
      let cancelled = false;
      const abortHandler = () => {
        cancelled = true;

        if (job !== null) {
          void cancelBridgeRunJob(job.id)
            .then((cancelledJob) => {
              if (cancelledJob !== null) {
                options.onJobUpdate?.(
                  redactHarnessRunJob(cancelledJob, redactionOptions(parsed, config.token)),
                );
              }
            })
            .catch(() => undefined);
        }
      };

      if (options.signal?.aborted) {
        abortHandler();
      } else {
        options.signal?.addEventListener("abort", abortHandler, { once: true });
      }

      try {
        const createPayload = await bridgeJsonRequest({
          path: "/runs",
          method: "POST",
          timeoutMessage: "Harness bridge run submission timed out",
          body: { ...parsed, timeoutMs: requestedTimeoutMs },
        });
        job = harnessRunJobCreateResponseSchema.parse(createPayload).job;
        options.onJobUpdate?.(redactHarnessRunJob(job, redactionOptions(parsed, config.token)));

        while (!isTerminalHarnessJob(job)) {
          throwIfAborted(options.signal, "Harness bridge run cancelled.");
          const eventsPayload = await bridgeJsonRequest({
            path: `/runs/${encodeURIComponent(job.id)}/events?since=${cursor}`,
            method: "GET",
            timeoutMessage: "Harness bridge run events request timed out",
          });
          const events = harnessRunJobEventsResponseSchema.parse(eventsPayload);
          cursor = events.nextCursor;

          for (const event of events.events) {
            options.onEvent?.(
              redactHarnessStreamEvent(event, {
                env: process.env,
                extraSecrets: [config.token, parsed.mcp?.token ?? ""],
              }),
            );
          }

          const statusPayload = await bridgeJsonRequest({
            path: `/runs/${encodeURIComponent(job.id)}`,
            method: "GET",
            timeoutMessage: "Harness bridge run status request timed out",
          });
          job = harnessRunJobSchema.parse(statusPayload);
          options.onJobUpdate?.(redactHarnessRunJob(job, redactionOptions(parsed, config.token)));

          if (!isTerminalHarnessJob(job)) {
            await sleepWithAbort(500, options.signal);
          }
        }

        const finalEventsPayload = await bridgeJsonRequest({
          path: `/runs/${encodeURIComponent(job.id)}/events?since=${cursor}`,
          method: "GET",
          timeoutMessage: "Harness bridge final events request timed out",
        });
        const finalEvents = harnessRunJobEventsResponseSchema.parse(finalEventsPayload);

        for (const event of finalEvents.events) {
          options.onEvent?.(
            redactHarnessStreamEvent(event, {
              env: process.env,
              extraSecrets: [config.token, parsed.mcp?.token ?? ""],
            }),
          );
        }

        if (job.status === "cancelled" || cancelled) {
          throw new Error("Harness bridge run cancelled.");
        }

        if (job.result === null) {
          throw new Error(job.errorMessage ?? "Harness bridge run finished without a result.");
        }

        const run = redactHarnessRunResponse(harnessRunResponseSchema.parse(job.result), {
          env: process.env,
          extraSecrets: [config.token, parsed.mcp?.token ?? ""],
        });

        if (run.status === "failed") {
          throw new HarnessRunFailedError(run);
        }

        return run;
      } catch (error) {
        if (error instanceof ApiHttpError) {
          throw error;
        }

        if (options.signal?.aborted) {
          throw new Error("Harness bridge run cancelled.", { cause: error });
        }

        throw error;
      } finally {
        options.signal?.removeEventListener("abort", abortHandler);
      }
    },
  };

  async function cancelBridgeRunJob(jobId: string): Promise<HarnessRunJob | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), bridgeTimeoutAbortGraceMs);

    try {
      const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${config.token}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      return harnessRunJobSchema.parse(await readJsonResponse(response));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function formatHarnessRunFailureMessage(run: HarnessRunResponse): string {
  const execution = run.execution;
  const parts = [
    redactString(run.message ?? "Harness run failed", { env: process.env }),
    `command=${redactString(execution.command, { env: process.env })}`,
    `exitCode=${execution.exitCode === null ? "null" : execution.exitCode}`,
    `durationMs=${execution.durationMs}`,
    `timeoutMs=${execution.timeoutMs === null ? "null" : execution.timeoutMs}`,
    `timeoutBudgetMs=${execution.timeoutBudgetMs === null ? "null" : execution.timeoutBudgetMs}`,
    `timeoutClamped=${execution.timeoutClamped}`,
    `timedOut=${execution.timedOut}`,
    `repositoryChanged=${execution.repositoryChanged}`,
  ];

  return parts.join("; ");
}

export function redactHarnessRunResponse(
  run: HarnessRunResponse,
  options: Parameters<typeof redactString>[1] = {},
): HarnessRunResponse {
  return harnessRunResponseSchema.parse({
    ...run,
    ...(run.message === undefined ? {} : { message: redactString(run.message, options) }),
    execution: {
      ...run.execution,
      command: redactString(run.execution.command, options),
      stderrTail: redactDiagnostic(run.execution.stderrTail, {
        ...options,
        maxChars: run.execution.stderrTail.length,
      }),
      repositoryFingerprintBefore:
        run.execution.repositoryFingerprintBefore === null
          ? null
          : redactString(run.execution.repositoryFingerprintBefore, options),
      repositoryFingerprintAfter:
        run.execution.repositoryFingerprintAfter === null
          ? null
          : redactString(run.execution.repositoryFingerprintAfter, options),
    },
  });
}

export function redactHarnessRunJob(
  job: HarnessRunJob,
  options: Parameters<typeof redactString>[1] = {},
): HarnessRunJob {
  return harnessRunJobSchema.parse({
    ...job,
    ...(job.errorMessage === null
      ? {}
      : { errorMessage: redactDiagnostic(job.errorMessage, options) }),
    result: job.result === null ? null : redactHarnessRunResponse(job.result, options),
  });
}

function redactionOptions(
  request: HarnessRunRequest,
  token: string,
): Parameters<typeof redactString>[1] {
  return { env: process.env, extraSecrets: [token, request.mcp?.token ?? ""] };
}

export function redactHarnessStreamEvent(
  event: HarnessStreamEvent,
  options: Parameters<typeof redactString>[1] = {},
): HarnessStreamEvent {
  return {
    ...event,
    summary: redactString(event.summary, options),
    text: event.text === null ? null : redactDiagnostic(event.text, options),
    name: event.name === null ? null : redactString(event.name, options),
    data: redactHarnessEventData(event.data, options),
  };
}

function redactHarnessEventData(
  data: Record<string, unknown>,
  options: Parameters<typeof redactString>[1],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, redactHarnessEventValue(value, options)]),
  );
}

function redactHarnessEventValue(
  value: unknown,
  options: Parameters<typeof redactString>[1],
): unknown {
  if (typeof value === "string") {
    return redactString(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactHarnessEventValue(entry, options));
  }

  if (typeof value === "object" && value !== null) {
    return redactHarnessEventData(value as Record<string, unknown>, options);
  }

  return value;
}

function isTerminalHarnessJob(job: HarnessRunJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled";
}

async function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }

      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation aborted."));
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error(message);
  }
}

export function harnessProfileForRequest(profile: Profile): HarnessRunProfile {
  const harnessSettings = profile.modelSettings.harness;
  const reasoningLevel =
    harnessSettings !== null &&
    typeof harnessSettings === "object" &&
    "reasoningLevel" in harnessSettings &&
    typeof harnessSettings.reasoningLevel === "string" &&
    harnessSettings.reasoningLevel.trim().length > 0
      ? harnessSettings.reasoningLevel.trim()
      : null;

  return {
    id: profile.id,
    name: profile.name,
    workflowType: profile.workflowType,
    provider: profile.provider,
    model: profile.model,
    harnessKind: harnessKindFromProfile(profile) ?? profile.model,
    reasoningLevel,
  };
}

async function assertRepositoryAccessSupported(
  request: HarnessRunRequest,
  readBridgeHealth: () => Promise<HarnessBridgeHealthResponse>,
): Promise<void> {
  const requiredCapability = requiredRepositoryAccessCapability(request);

  if (requiredCapability === null) {
    return;
  }

  const health = await readBridgeHealth();

  if (health.capabilities.includes(requiredCapability)) {
    return;
  }

  throw new Error(
    `Harness bridge does not advertise ${requiredCapability}; repository snapshot access is disabled or unsupported by this bridge.`,
  );
}

function requiredRepositoryAccessCapability(
  request: HarnessRunRequest,
): HarnessBridgeCapability | null {
  const access = request.repositoryAccess ?? { mode: "mcp_only" };

  if (access.mode === "mcp_only") {
    return null;
  }

  if ((access.workspaceStrategy ?? "git_archive") === "git_archive") {
    return "repository_snapshot_git_archive";
  }

  return "repository_snapshot_git_worktree";
}

export interface HarnessSetupStatusOptions {
  env?: Record<string, string | undefined>;
  skillSourceDir?: string;
}

export async function readHarnessStatus(
  client: HarnessClient | null,
  options: HarnessSetupStatusOptions = {},
): Promise<HarnessStatusResponse> {
  const setupOptions = normalizeHarnessSetupOptions(options);

  if (client === null) {
    const harnesses = await readKnownHarnessSetupStatuses({
      bridgeConfigured: false,
      health: null,
      options: setupOptions,
    });

    return harnessStatusResponseSchema.parse({
      configured: false,
      baseUrl: null,
      healthy: false,
      runtimeMode: "disabled",
      availableKinds: [],
      harnesses,
      bridgeCapabilities: [],
      errorMessage: "Harness bridge is not configured",
    });
  }

  if (client.health === undefined) {
    const harnesses = await readKnownHarnessSetupStatuses({
      bridgeConfigured: true,
      health: null,
      options: setupOptions,
    });

    return harnessStatusResponseSchema.parse({
      configured: true,
      baseUrl: client.config?.baseUrl ?? null,
      healthy: false,
      runtimeMode: "bridge",
      availableKinds: [],
      harnesses,
      bridgeCapabilities: [],
      errorMessage: "Harness client does not expose bridge health",
    });
  }

  try {
    const health = await client.health();
    const availableKinds = health.availableKinds
      .filter((kind) => kind.commandConfigured)
      .map((kind) => descriptorForStatus(kind.kind))
      .filter((kind): kind is HarnessStatusAvailableKind => kind !== null);
    const harnesses = await readKnownHarnessSetupStatuses({
      bridgeConfigured: true,
      health,
      options: setupOptions,
    });
    const detectedHarnesses = await readBridgeDetectedHarnesses(client);

    return harnessStatusResponseSchema.parse({
      configured: true,
      baseUrl: client.config?.baseUrl ?? null,
      healthy: true,
      runtimeMode: health.runtimeMode,
      availableKinds,
      harnesses,
      detectedHarnesses,
      bridgeCapabilities: health.capabilities,
      errorMessage: null,
    });
  } catch (error) {
    const harnesses = await readKnownHarnessSetupStatuses({
      bridgeConfigured: true,
      health: null,
      options: setupOptions,
    });

    return harnessStatusResponseSchema.parse({
      configured: true,
      baseUrl: client.config?.baseUrl ?? null,
      healthy: false,
      runtimeMode: "bridge",
      availableKinds: [],
      harnesses,
      bridgeCapabilities: [],
      errorMessage:
        error instanceof Error
          ? redactDiagnostic(error.message, { env: setupOptions.env, maxChars: 1000 })
          : "Harness bridge is configured but unavailable",
    });
  }
}

/**
 * Best-effort read of the bridge's detected harness CLIs. Detection
 * is additive status detail, so a bridge that predates the `/harnesses`
 * endpoint (or a transient detection failure) degrades to an empty array
 * instead of failing the whole status read.
 */
async function readBridgeDetectedHarnesses(client: HarnessClient): Promise<HarnessDetectedCli[]> {
  if (client.detectedHarnesses === undefined) {
    return [];
  }

  try {
    return (await client.detectedHarnesses()).harnesses;
  } catch {
    return [];
  }
}

export async function readHarnessSkillCheck(
  kind: string,
  options: HarnessSetupStatusOptions = {},
): Promise<HarnessSkillCheckResponse> {
  const descriptor = requireKnownHarnessDescriptor(kind);
  const skill = await readHarnessSkillStatus(descriptor, normalizeHarnessSetupOptions(options));

  return harnessSkillCheckResponseSchema.parse({
    kind: descriptor.kind,
    skill,
  });
}

export async function installHarnessSkillPackage(
  kind: string,
  options: HarnessSetupStatusOptions = {},
): Promise<HarnessSkillInstallResponse> {
  const descriptor = requireKnownHarnessDescriptor(kind);
  const setupOptions = normalizeHarnessSetupOptions(options);

  if (descriptor.skillSupport.mode !== "managed_package") {
    const skill = await readHarnessSkillStatus(descriptor, setupOptions);

    return harnessSkillInstallResponseSchema.parse({
      kind: descriptor.kind,
      installed: false,
      skill,
    });
  }

  const targetPath = harnessSkillInstallPath(descriptor, setupOptions.env);

  if (targetPath === null) {
    return harnessSkillInstallResponseSchema.parse({
      kind: descriptor.kind,
      installed: false,
      skill: inlineUnknownSkillStatus(descriptor, [
        "Set HOME or a harness-specific skills directory before installing the Greenroom skill.",
      ]),
    });
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await cp(setupOptions.skillSourceDir, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  const skill = await readHarnessSkillStatus(descriptor, setupOptions);

  return harnessSkillInstallResponseSchema.parse({
    kind: descriptor.kind,
    installed: skill.status === "current",
    skill,
  });
}

export interface HarnessSetupSmokeOptions extends HarnessSetupStatusOptions {
  /** Bridge client used to launch the smoke run; null means no bridge. */
  harnessClient?: HarnessClient | null;
  /** Working directory for the smoke run; defaults to the OS temp dir. */
  cwd?: string;
  timeoutMs?: number;
}

const setupSmokeRunTimeoutMsDefault = 60_000;

// JSON-schema mirror of workflowSetupSmokeDraftOutputSchema, handed to the
// bridge so presets can enforce structured output.
const setupSmokeReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "status", "checks"],
  properties: {
    kind: { const: "setup_smoke_report" },
    status: { type: "string", enum: ["passed", "failed"] },
    checks: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status", "summary"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          status: { type: "string", enum: ["passed", "failed", "skipped"] },
          summary: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
    },
  },
} as const;

const setupSmokePrompt = [
  "You are running Greenroom's setup smoke test, which verifies that this",
  "coding-agent harness can execute a run and return schema-bound output.",
  "Do not read, create, or modify any files, and do not run any commands.",
  'Respond with only a JSON object (no prose, no code fences): set "kind" to',
  '"setup_smoke_report", "status" to "passed", and include exactly one entry',
  'in "checks" named "harness-echo" with status "passed" and a one-sentence',
  "summary confirming that you received this prompt.",
].join(" ");

/**
 * Runs the setup smoke test for one harness kind: local CLI
 * and skill checks plus a real minimal harness run through the bridge
 * (structured stdout, no MCP, no repository access). The overall status is
 * the harness run's result; the cli/skill/mcp checks are informational so a
 * host-side probe failure (for example a containerized API with a host-side
 * bridge) does not mask a working bridge.
 */
export async function createHarnessSetupSmokeResponse(
  kind: string,
  options: HarnessSetupSmokeOptions = {},
): Promise<HarnessSetupSmokeResponse> {
  const descriptor = requireKnownHarnessDescriptor(kind);
  const setupOptions = normalizeHarnessSetupOptions(options);
  const cli = await discoverLocalHarnessCli(descriptor, setupOptions);
  const skill = await readHarnessSkillStatus(descriptor, setupOptions);
  const diagnostics: string[] = ["No credentials were read or stored."];
  const harness = await runSetupSmokeThroughBridge(descriptor, options, diagnostics);

  const checks: HarnessSetupSmokeCheckResult[] = [
    {
      name: "cli",
      status: cli.status === "installed" ? "passed" : "failed",
      summary:
        cli.status === "installed"
          ? `${descriptor.label} CLI was found${cli.version === null ? "." : ` (${cli.version}).`}`
          : (cli.message ?? `${descriptor.label} CLI was not found.`),
    },
    {
      name: "skill",
      status:
        skill.status === "current" || skill.status === "unsupported"
          ? "passed"
          : skill.status === "unknown"
            ? "skipped"
            : "failed",
      summary: skillSummaryForSmoke(skill),
    },
    {
      name: "mcp",
      status: "skipped",
      summary:
        "The smoke run executes without MCP access; MCP tool wiring is exercised by real workflow runs.",
    },
    harness.check,
    ...harness.reportedChecks,
  ];

  return harnessSetupSmokeResponseSchema.parse({
    workflowKind: "setup_smoke",
    harnessKind: descriptor.kind,
    status: harness.passed ? "passed" : "failed",
    message: harness.passed
      ? `Setup smoke passed: the ${descriptor.label} harness executed a bridge run and returned a valid structured report.`
      : `Setup smoke failed: ${harness.check.summary}`,
    checks: checks.slice(0, 20),
    diagnostics: diagnostics.slice(0, 20),
  });
}

interface SetupSmokeHarnessResult {
  passed: boolean;
  check: HarnessSetupSmokeCheckResult;
  reportedChecks: HarnessSetupSmokeCheckResult[];
}

async function runSetupSmokeThroughBridge(
  descriptor: HarnessKindDescriptor,
  options: HarnessSetupSmokeOptions,
  diagnostics: string[],
): Promise<SetupSmokeHarnessResult> {
  const client = options.harnessClient ?? null;

  if (client === null) {
    return {
      passed: false,
      check: {
        name: "harness",
        status: "failed",
        summary:
          "Harness bridge is not configured; start Greenroom with `greenroom up` or set GREENROOM_HARNESS_BASE_URL and GREENROOM_HARNESS_TOKEN.",
      },
      reportedChecks: [],
    };
  }

  const request: HarnessRunRequest = harnessRunRequestSchema.parse({
    workflow: "setup_smoke",
    runId: `setup_smoke_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    profile: {
      id: "profile_setup_smoke",
      name: `Setup smoke (${descriptor.label})`,
      workflowType: "builtin_review",
      provider: "harness",
      model: descriptor.defaultModel,
      harnessKind: descriptor.kind,
      reasoningLevel: null,
    },
    cwd: options.cwd ?? tmpdir(),
    prompt: setupSmokePrompt,
    schema: setupSmokeReportJsonSchema as unknown as Record<string, unknown>,
    promptId: "greenroom_setup_smoke_prompt",
    outputMode: "setup_smoke_report",
    outputCapture: "structured_stdout",
    timeoutMs: options.timeoutMs ?? setupSmokeRunTimeoutMsDefault,
  });

  let response: HarnessRunResponse;

  try {
    response = await client.run(request);
  } catch (error) {
    const failed = error instanceof HarnessRunFailedError ? error.run : null;
    const message =
      failed?.message ?? (error instanceof Error ? error.message : "Harness run failed.");

    if (failed !== null && failed.execution.stderrTail.length > 0) {
      diagnostics.push(redactDiagnostic(`Harness stderr tail: ${failed.execution.stderrTail}`));
    }

    return {
      passed: false,
      check: {
        name: "harness",
        status: "failed",
        summary: redactDiagnostic(`The smoke run did not complete: ${message}`),
      },
      reportedChecks: [],
    };
  }

  if (response.status !== "completed") {
    if (response.execution.stderrTail.length > 0) {
      diagnostics.push(redactDiagnostic(`Harness stderr tail: ${response.execution.stderrTail}`));
    }

    return {
      passed: false,
      check: {
        name: "harness",
        status: "failed",
        summary: redactDiagnostic(
          `The smoke run failed: ${response.message ?? "the harness reported a failure."}`,
        ),
      },
      reportedChecks: [],
    };
  }

  const report = workflowSetupSmokeDraftOutputSchema.safeParse(response.output);

  if (!report.success) {
    return {
      passed: false,
      check: {
        name: "harness",
        status: "failed",
        summary:
          "The harness completed but its output does not match the setup smoke report schema.",
      },
      reportedChecks: [],
    };
  }

  return {
    passed: report.data.status === "passed",
    check: {
      name: "harness",
      status: report.data.status,
      summary:
        report.data.status === "passed"
          ? `The ${descriptor.label} harness executed a bridge run and returned a valid structured report in ${response.execution.durationMs}ms.`
          : `The harness ran but reported a failing smoke status.`,
    },
    reportedChecks: report.data.checks.map((check) => ({
      ...check,
      name: `harness:${check.name}`.slice(0, 120),
    })),
  };
}

interface NormalizedHarnessSetupStatusOptions {
  env: Record<string, string | undefined>;
  skillSourceDir: string;
}

interface ReadKnownHarnessSetupStatusesInput {
  bridgeConfigured: boolean;
  health: HarnessBridgeHealthResponse | null;
  options: NormalizedHarnessSetupStatusOptions;
}

interface CliVersionResult {
  status: "installed" | "unsupported" | "unknown";
  version: string | null;
  message: string | null;
}

async function readKnownHarnessSetupStatuses(
  input: ReadKnownHarnessSetupStatusesInput,
): Promise<HarnessKindSetupStatus[]> {
  return Promise.all(
    listKnownHarnessKindDescriptors().map(async (descriptor) => {
      const cli = await discoverLocalHarnessCli(descriptor, input.options);
      const skill = await readHarnessSkillStatus(descriptor, input.options);
      const mcpSetup = readHarnessMcpSetupStatus(descriptor, cli);
      const statusDescriptor = descriptorForStatus(descriptor.kind);
      const bridgeKind = input.health?.availableKinds.find(
        (candidate) => candidate.kind === descriptor.kind,
      );

      return {
        ...(statusDescriptor ?? descriptor),
        cli,
        bridge: {
          configured: input.bridgeConfigured,
          commandConfigured: bridgeKind?.commandConfigured ?? false,
        },
        skill,
        mcpSetup,
      } satisfies HarnessKindSetupStatus;
    }),
  );
}

export async function discoverLocalHarnessCli(
  descriptor: HarnessKindDescriptor,
  options: HarnessSetupStatusOptions = {},
): Promise<HarnessLocalCliStatus> {
  const setupOptions = normalizeHarnessSetupOptions(options);
  const configuredPath = configuredCliPathForKind(descriptor.kind, setupOptions.env);
  const commandCandidates =
    configuredPath === null
      ? descriptor.cli.commands
      : [configuredPath, ...descriptor.cli.commands];

  for (const command of commandCandidates) {
    const resolvedPath = await resolveCliCommandPath(command, setupOptions.env);

    if (resolvedPath === null) {
      continue;
    }

    const version = await readSafeCliVersion(
      resolvedPath,
      descriptor.cli.versionArgs,
      descriptor.cli.minimumVersion,
      setupOptions.env,
    );

    return {
      status: version.status,
      path: resolvedPath,
      version: version.version,
      message: version.message,
    };
  }

  return {
    status: "missing",
    path: null,
    version: null,
    message:
      configuredPath === null
        ? `${descriptor.label} CLI was not found on PATH.`
        : `${descriptor.label} CLI was not found at the configured path or on PATH.`,
  };
}

async function readHarnessSkillStatus(
  descriptor: HarnessKindDescriptor,
  options: NormalizedHarnessSetupStatusOptions,
): Promise<HarnessSkillStatusDetail> {
  if (descriptor.skillSupport.mode !== "managed_package") {
    return {
      skillMode: "inline_prompt",
      status: "unsupported",
      packageName: descriptor.skillSupport.packageName,
      expectedVersion: descriptor.skillSupport.expectedVersion,
      installedVersion: null,
      path: null,
      diagnostics: ["This harness receives Greenroom instructions inline with the prompt."],
    };
  }

  const targetPath = harnessSkillInstallPath(descriptor, options.env);

  if (targetPath === null) {
    return inlineUnknownSkillStatus(descriptor, [
      "Set HOME or a harness-specific skills directory before checking the Greenroom skill.",
    ]);
  }

  const metadataPath = join(targetPath, "metadata.json");
  const expectedVersion = descriptor.skillSupport.expectedVersion;

  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      version?: unknown;
      name?: unknown;
    };
    const installedVersion =
      typeof metadata.version === "string" && metadata.version.trim().length > 0
        ? metadata.version.trim()
        : null;
    const installedName =
      typeof metadata.name === "string" && metadata.name.trim().length > 0
        ? metadata.name.trim()
        : null;

    if (installedName !== descriptor.skillSupport.packageName) {
      return {
        skillMode: "managed_package",
        status: "outdated",
        packageName: descriptor.skillSupport.packageName,
        expectedVersion,
        installedVersion,
        path: targetPath,
        diagnostics: [
          `Greenroom skill metadata at ${targetPath} does not identify the expected package.`,
        ],
      };
    }

    if (expectedVersion !== null && installedVersion !== expectedVersion) {
      return {
        skillMode: "managed_package",
        status: "outdated",
        packageName: descriptor.skillSupport.packageName,
        expectedVersion,
        installedVersion,
        path: targetPath,
        diagnostics: [
          `Greenroom skill is installed at ${targetPath}, but version ${installedVersion ?? "unknown"} does not match expected version ${expectedVersion}.`,
        ],
      };
    }

    return {
      skillMode: "managed_package",
      status: "current",
      packageName: descriptor.skillSupport.packageName,
      expectedVersion,
      installedVersion,
      path: targetPath,
      diagnostics: [`Greenroom skill is current at ${targetPath}.`],
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        skillMode: "managed_package",
        status: "missing",
        packageName: descriptor.skillSupport.packageName,
        expectedVersion,
        installedVersion: null,
        path: targetPath,
        diagnostics: [`Greenroom skill is missing at ${targetPath}.`],
      };
    }

    return {
      skillMode: "managed_package",
      status: "unknown",
      packageName: descriptor.skillSupport.packageName,
      expectedVersion,
      installedVersion: null,
      path: targetPath,
      diagnostics: [
        redactDiagnostic(
          error instanceof Error
            ? `Could not read Greenroom skill metadata: ${error.message}`
            : "Could not read Greenroom skill metadata.",
          { env: options.env, maxChars: 1000 },
        ),
      ],
    };
  }
}

function readHarnessMcpSetupStatus(
  descriptor: HarnessKindDescriptor,
  cli: HarnessLocalCliStatus,
): HarnessMcpSetupStatusDetail {
  if (descriptor.mcp.expectation === "not_supported") {
    return {
      status: "unsupported",
      smokeResource: descriptor.mcp.smokeResource,
      diagnostics: ["This harness does not use MCP for Greenroom setup."],
    };
  }

  if (cli.status !== "installed") {
    return {
      status: "unknown",
      smokeResource: descriptor.mcp.smokeResource,
      diagnostics: [`Install ${descriptor.label} before checking Greenroom MCP visibility.`],
    };
  }

  return {
    status: "not_configured",
    smokeResource: descriptor.mcp.smokeResource,
    diagnostics: [
      descriptor.mcp.notes,
      "Actual harness MCP probing is pending E5/E6; no secret MCP credentials were read.",
    ],
  };
}

function inlineUnknownSkillStatus(
  descriptor: HarnessKindDescriptor,
  diagnostics: string[],
): HarnessSkillStatusDetail {
  return {
    skillMode: descriptor.skillSupport.mode,
    status: "unknown",
    packageName: descriptor.skillSupport.packageName,
    expectedVersion: descriptor.skillSupport.expectedVersion,
    installedVersion: null,
    path: null,
    diagnostics,
  };
}

function skillSummaryForSmoke(skill: HarnessSkillStatusDetail): string {
  switch (skill.status) {
    case "current":
      return `Greenroom skill ${skill.installedVersion ?? greenroomHarnessSkillPackageVersion} is installed.`;
    case "missing":
      return `Greenroom skill is missing${skill.path === null ? "." : ` at ${skill.path}.`}`;
    case "outdated":
      return `Greenroom skill is outdated; expected ${skill.expectedVersion ?? "the current version"} but found ${skill.installedVersion ?? "unknown"}.`;
    case "unsupported":
      return "This harness will receive Greenroom instructions through inline prompts.";
    case "unknown":
      return skill.diagnostics[0] ?? "Greenroom skill status could not be determined.";
  }
}

function normalizeHarnessSetupOptions(
  options: HarnessSetupStatusOptions,
): NormalizedHarnessSetupStatusOptions {
  const env = options.env ?? process.env;
  const skillSourceDir =
    options.skillSourceDir ??
    nonEmpty(env.GREENROOM_HARNESS_SKILL_SOURCE_DIR) ??
    defaultHarnessSkillSourceDir();

  return { env, skillSourceDir };
}

function defaultHarnessSkillSourceDir(): string {
  const apiDir = dirname(fileURLToPath(import.meta.url));
  return resolve(apiDir, "../../../..", "packages/harness/skills/greenroom");
}

function requireKnownHarnessDescriptor(kind: string): HarnessKindDescriptor {
  const descriptor = getHarnessKindDescriptor(kind);

  if (descriptor === null) {
    throw new ApiHttpError(404, "not_found", `Harness kind ${kind} is not supported`);
  }

  return descriptor;
}

function configuredCliPathForKind(
  kind: string,
  env: Record<string, string | undefined>,
): string | null {
  const configured = parseConfiguredCliPathsEnv(env.GREENROOM_HARNESS_CLI_PATHS_JSON);
  const normalized = envKeySuffix(kind);
  const genericKindPath = nonEmpty(env[`GREENROOM_HARNESS_${normalized}_PATH`]);

  if (genericKindPath !== undefined) {
    return genericKindPath;
  }

  if (configured[kind] !== undefined) {
    return configured[kind];
  }

  if (kind === "claude-code") {
    return (
      nonEmpty(env.GREENROOM_HARNESS_CLAUDE_CODE_PATH) ??
      nonEmpty(env.GREENROOM_HARNESS_CLAUDE_PATH) ??
      nonEmpty(env.CLAUDE_CODE_PATH) ??
      null
    );
  }

  if (kind === "codex") {
    return nonEmpty(env.GREENROOM_HARNESS_CODEX_PATH) ?? nonEmpty(env.CODEX_PATH) ?? null;
  }

  if (kind === "pi") {
    // Greenroom-managed Pi fallback install. Layout mirrors
    // managedPiBinaryPath in packages/harness/src/pi-install.ts; the candidate
    // simply falls through to `pi` on PATH when the managed install is absent.
    const dataDir = nonEmpty(env.GREENROOM_DATA_DIR);
    return dataDir === undefined
      ? null
      : join(dataDir, "tools", "pi", "node_modules", ".bin", "pi");
  }

  return null;
}

function parseConfiguredCliPathsEnv(value: string | undefined): Record<string, string> {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const entries: Array<[string, string]> = [];

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        continue;
      }

      const cliPath = value.trim();

      if (cliPath.length > 0) {
        entries.push([key, cliPath]);
      }
    }

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function resolveCliCommandPath(
  command: string,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  if (isPathLikeCommand(command)) {
    const candidate = isAbsolute(command) ? command : resolve(command);
    return (await canExecute(candidate)) ? candidate : null;
  }

  for (const directory of pathEntries(env.PATH)) {
    const candidate = join(directory, command);

    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSafeCliVersion(
  commandPath: string,
  args: readonly string[],
  minimumVersion: string | null,
  env: Record<string, string | undefined>,
): Promise<CliVersionResult> {
  const result = await spawnVersionCommand(commandPath, args, env);

  if (result.status === "unknown") {
    return result;
  }

  if (
    minimumVersion !== null &&
    result.version !== null &&
    compareSemver(extractSemver(result.version), extractSemver(minimumVersion)) < 0
  ) {
    return {
      status: "unsupported",
      version: result.version,
      message: `Installed version ${result.version} is older than supported version ${minimumVersion}.`,
    };
  }

  return result;
}

function spawnVersionCommand(
  commandPath: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliVersionResult> {
  return new Promise((resolveResult) => {
    const child = spawn(commandPath, [...args], {
      env: buildDiscoveryEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      resolveResult({
        status: "unknown",
        version: null,
        message: "CLI version command timed out.",
      });
    }, 2000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = tailString(`${stdout}${chunk}`, 4000);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = tailString(`${stderr}${chunk}`, 4000);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolveResult({
        status: "unknown",
        version: null,
        message: redactDiagnostic(error.message, { env, maxChars: 1000 }),
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (exitCode !== 0) {
        resolveResult({
          status: "unknown",
          version: null,
          message: redactDiagnostic(
            `CLI version command exited with status ${exitCode ?? "unknown"}${stderr.trim().length === 0 ? "." : `: ${stderr.trim()}`}`,
            { env, maxChars: 1000 },
          ),
        });
        return;
      }

      const versionText = firstNonEmptyLine(stdout) ?? firstNonEmptyLine(stderr);

      resolveResult({
        status: "installed",
        version: versionText === null ? null : versionText.slice(0, 400),
        message: null,
      });
    });
  });
}

function buildDiscoveryEnv(env: Record<string, string | undefined>): Record<string, string> {
  const allowlist = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL"];
  const output: Record<string, string> = {};

  for (const name of allowlist) {
    const value = env[name];

    if (value !== undefined) {
      output[name] = value;
    }
  }

  return output;
}

function harnessSkillInstallPath(
  descriptor: HarnessKindDescriptor,
  env: Record<string, string | undefined>,
): string | null {
  const packageName = descriptor.skillSupport.packageName;

  if (descriptor.skillSupport.mode !== "managed_package" || packageName === null) {
    return null;
  }

  const normalized = envKeySuffix(descriptor.kind);
  const explicitSkillsDir =
    nonEmpty(env[`GREENROOM_HARNESS_${normalized}_SKILLS_DIR`]) ??
    nonEmpty(env.GREENROOM_HARNESS_SKILLS_DIR);

  if (explicitSkillsDir !== undefined) {
    return join(explicitSkillsDir, packageName);
  }

  const home =
    nonEmpty(env[`GREENROOM_HARNESS_${normalized}_HOME`]) ??
    harnessDefaultHome(descriptor.kind, env);

  return home === null ? null : join(home, "skills", packageName);
}

function harnessDefaultHome(kind: string, env: Record<string, string | undefined>): string | null {
  if (kind === "claude-code") {
    return (
      nonEmpty(env.CLAUDE_CONFIG_DIR) ??
      nonEmpty(env.GREENROOM_CLAUDE_HOME) ??
      homeChild(env, ".claude")
    );
  }

  if (kind === "codex") {
    return nonEmpty(env.CODEX_HOME) ?? homeChild(env, ".codex");
  }

  return homeChild(env, `.greenroom-${kind}`);
}

function homeChild(env: Record<string, string | undefined>, child: string): string | null {
  const home = nonEmpty(env.HOME);
  return home === undefined ? null : join(home, child);
}

function pathEntries(pathValue: string | undefined): string[] {
  if (pathValue === undefined || pathValue.trim().length === 0) {
    return [];
  }

  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isPathLikeCommand(command: string): boolean {
  return isAbsolute(command) || command.includes("/") || command.includes(sep);
}

function firstNonEmptyLine(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

function extractSemver(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(value);

  if (match === null) {
    return null;
  }

  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareSemver(
  left: [number, number, number] | null,
  right: [number, number, number] | null,
): number {
  if (left === null || right === null) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function envKeySuffix(kind: string): string {
  return kind.replaceAll(/[^a-z0-9]+/giu, "_").toUpperCase();
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function parseTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultHarnessClientTimeoutMs;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > maxHarnessClientTimeoutMs) {
    return defaultHarnessClientTimeoutMs;
  }

  return parsed;
}

function descriptorForStatus(kind: string): HarnessStatusAvailableKind | null {
  const descriptor = getHarnessKindDescriptor(kind);

  if (descriptor === null) {
    return null;
  }

  return {
    kind: descriptor.kind,
    label: descriptor.label,
    defaultModel: descriptor.defaultModel,
    defaultModelDisplay: descriptor.defaultModelDisplay,
    supportedWorkflows: descriptor.supportedWorkflows,
    skillSupport: descriptor.skillSupport,
    mcp: descriptor.mcp,
    smokeTest: descriptor.smokeTest,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1000) };
  }
}

function bridgeErrorMessage(status: number, payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return `Harness bridge returned HTTP ${status}`;
}

function tailString(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return maxChars <= 0 ? "" : value;
  }

  return value.slice(value.length - maxChars);
}
