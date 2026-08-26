import { randomUUID } from "node:crypto";

import {
  harnessRunJobCreateResponseSchema,
  harnessRunJobEventsResponseSchema,
  harnessRunJobSchema,
  harnessRunRequestSchema,
  harnessModelCatalogSchema,
  harnessStreamEventSchema,
  type HarnessBridgeCapability,
  type HarnessRunJob,
  type HarnessRunJobStatus,
  type HarnessRunRequest,
  type HarnessStreamEvent,
} from "@greenroom/schemas";

import { readHarnessBridgeConfig, type HarnessBridgeConfig } from "./config";
import { createHarnessDetector, type HarnessDetector } from "./detect";
import { runHarnessCommand } from "./run";
import { createHarnessModelCatalogProvider, type HarnessModelCatalogProvider } from "./models";
import { bridgeAvailableKinds, bridgeDefaultKind, resolveHarnessPreset } from "./presets";

export interface HarnessBridgeApp {
  fetch: (request: Request) => Promise<Response>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  detector: HarnessDetector;
}

export interface HarnessBridgeAppOptions {
  detector?: HarnessDetector;
  modelCatalogProvider?: HarnessModelCatalogProvider;
  jobTtlMs?: number;
  clock?: () => string;
}

export function createHarnessBridgeApp(
  config: HarnessBridgeConfig,
  options: HarnessBridgeAppOptions = {},
): HarnessBridgeApp {
  const detector =
    options.detector ??
    createHarnessDetector({ stateDir: config.stateDir, toolsDir: config.toolsDir });
  const modelCatalogProvider =
    options.modelCatalogProvider ?? createHarnessModelCatalogProvider({ detector });
  const jobs = new HarnessRunJobStore({
    config,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.jobTtlMs === undefined ? {} : { ttlMs: options.jobTtlMs }),
  });

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const availableKinds = bridgeAvailableKinds(config);

        return jsonResponse({
          status: "ok",
          runtimeMode: "bridge",
          defaultKind: bridgeDefaultKind(config),
          commandConfigured:
            config.command.length > 0 || availableKinds.some((kind) => kind.commandConfigured),
          availableKinds,
          pathMappings: config.pathMappings.length,
          capabilities: bridgeCapabilities(config),
        });
      }

      if (request.method === "GET" && url.pathname === "/harnesses") {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const refresh = url.searchParams.get("refresh");
        const detection =
          refresh === "true" || refresh === "1"
            ? await detector.probe()
            : await detector.snapshot();
        return jsonResponse(detection);
      }

      const modelCatalogKind = matchModelCatalogPath(url.pathname);

      if (request.method === "GET" && modelCatalogKind !== null) {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const catalog = await modelCatalogProvider.get(modelCatalogKind, {
          refresh:
            url.searchParams.get("refresh") === "true" || url.searchParams.get("refresh") === "1",
        });

        if (catalog === null) {
          return jsonResponse(
            {
              error: {
                code: "not_found",
                message: `Harness kind ${modelCatalogKind} is not known to this bridge`,
              },
            },
            404,
          );
        }

        return jsonResponse(harnessModelCatalogSchema.parse(catalog));
      }

      const smokeKind = matchSmokeRecordPath(url.pathname);

      if (request.method === "POST" && smokeKind !== null) {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const harness = await detector.recordSmoke(smokeKind);

        if (harness === null) {
          return jsonResponse(
            {
              error: {
                code: "not_found",
                message: `Harness kind ${smokeKind} is not known to this bridge`,
              },
            },
            404,
          );
        }

        return jsonResponse({ recorded: harness.found, harness });
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const body = harnessRunRequestSchema.parse(await request.json());
        const job = jobs.create(body);
        return jsonResponse(harnessRunJobCreateResponseSchema.parse({ job }), 202);
      }

      const runJobId = matchRunJobPath(url.pathname);

      if (runJobId !== null && request.method === "GET") {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const job = jobs.read(runJobId);

        if (job === null) {
          return jsonResponse(
            { error: { code: "not_found", message: "Run job was not found" } },
            404,
          );
        }

        return jsonResponse(job);
      }

      const runJobEventsId = matchRunJobEventsPath(url.pathname);

      if (runJobEventsId !== null && request.method === "GET") {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);

        if (url.searchParams.get("stream") === "1") {
          return jobs.streamEvents(runJobEventsId, readSinceCursor(url));
        }

        const payload = jobs.listEvents(runJobEventsId, readSinceCursor(url));

        if (payload === null) {
          return jsonResponse(
            { error: { code: "not_found", message: "Run job was not found" } },
            404,
          );
        }

        return jsonResponse(harnessRunJobEventsResponseSchema.parse(payload));
      }

      if (runJobId !== null && request.method === "DELETE") {
        requireHarnessAuth(request.headers.get("authorization") ?? undefined, config);
        const job = jobs.cancel(runJobId);

        if (job === null) {
          return jsonResponse(
            { error: { code: "not_found", message: "Run job was not found" } },
            404,
          );
        }

        return jsonResponse(job);
      }

      return jsonResponse({ error: { code: "not_found", message: "Route was not found" } }, 404);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return jsonResponse(
        {
          error: {
            code: "bad_request",
            message: error instanceof Error ? error.message : "Harness bridge request failed",
          },
        },
        400,
      );
    }
  }

  return {
    fetch,
    request(path, init) {
      const url =
        path.startsWith("http://") || path.startsWith("https://")
          ? path
          : `http://127.0.0.1${path}`;
      return fetch(new Request(url, init));
    },
    detector,
  };
}

interface HarnessRunJobRecord {
  job: HarnessRunJob;
  request: ReturnType<typeof harnessRunRequestSchema.parse>;
  controller: AbortController;
  events: HarnessStreamEvent[];
  subscribers: Set<() => void>;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  cancelRequested: boolean;
}

const harnessJobHeartbeatIntervalMs = 5_000;

class HarnessRunJobStore {
  readonly #jobs = new Map<string, HarnessRunJobRecord>();
  readonly #config: HarnessBridgeConfig;
  readonly #clock: () => string;
  readonly #ttlMs: number;

  constructor(input: { config: HarnessBridgeConfig; clock?: () => string; ttlMs?: number }) {
    this.#config = input.config;
    this.#clock = input.clock ?? (() => new Date().toISOString());
    this.#ttlMs = input.ttlMs ?? 10 * 60_000;
  }

  create(requestInput: HarnessRunRequest): HarnessRunJob {
    const request = harnessRunRequestSchema.parse(requestInput);
    const preset = resolveHarnessPreset({
      requestModel: request.profile.model,
      requestHarnessKind: request.profile.harnessKind,
      config: this.#config,
    }).preset;
    const now = this.#clock();
    const id = `harness_job_${randomUUID()}`;
    const record: HarnessRunJobRecord = {
      job: harnessRunJobSchema.parse({
        id,
        runId: request.runId,
        workflow: request.workflow,
        status: "queued",
        streaming: preset.streaming,
        submittedAt: now,
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: now,
        lastProcessSeenAt: null,
        heartbeatIntervalMs: harnessJobHeartbeatIntervalMs,
        cancelRequestedAt: null,
        lastEventSequence: 0,
        result: null,
        errorMessage: null,
      }),
      request,
      controller: new AbortController(),
      events: [],
      subscribers: new Set(),
      cleanupTimer: null,
      heartbeatTimer: null,
      cancelRequested: false,
    };
    this.#jobs.set(id, record);
    void this.#execute(record);
    return record.job;
  }

  read(id: string): HarnessRunJob | null {
    return this.#jobs.get(id)?.job ?? null;
  }

  cancel(id: string): HarnessRunJob | null {
    const record = this.#jobs.get(id);

    if (record === undefined) {
      return null;
    }

    if (!isTerminalJobStatus(record.job.status)) {
      record.cancelRequested = true;
      this.#setStatus(record, record.job.status, { cancelRequestedAt: this.#clock() });
      record.controller.abort(new Error("Harness run job cancelled."));
    }

    return record.job;
  }

  listEvents(
    id: string,
    since: number,
  ): { events: HarnessStreamEvent[]; nextCursor: number; terminal: boolean } | null {
    const record = this.#jobs.get(id);

    if (record === undefined) {
      return null;
    }

    const events = record.events.filter((event) => event.sequence > since);
    return {
      events,
      nextCursor: record.job.lastEventSequence,
      terminal: isTerminalJobStatus(record.job.status),
    };
  }

  streamEvents(id: string, since: number): Response {
    const record = this.#jobs.get(id);

    if (record === undefined) {
      return jsonResponse({ error: { code: "not_found", message: "Run job was not found" } }, 404);
    }

    let cursor = since;
    const encoder = new TextEncoder();

    let send: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        send = () => {
          const events = record.events.filter((event) => event.sequence > cursor);

          for (const event of events) {
            cursor = event.sequence;
            controller.enqueue(encoder.encode(`id: ${event.sequence}\n`));
            controller.enqueue(encoder.encode("event: harness\n"));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }

          if (isTerminalJobStatus(record.job.status) && cursor >= record.job.lastEventSequence) {
            if (send !== null) {
              record.subscribers.delete(send);
            }
            controller.close();
          }
        };

        record.subscribers.add(send);
        send();
      },
      cancel: () => {
        if (send !== null) {
          record.subscribers.delete(send);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  async #execute(record: HarnessRunJobRecord): Promise<void> {
    const startedAt = this.#clock();
    this.#setStatus(record, "running", {
      startedAt,
      lastHeartbeatAt: startedAt,
      lastProcessSeenAt: startedAt,
    });
    this.#startHeartbeat(record);

    try {
      const result = await runHarnessCommand({
        request: record.request,
        config: this.#config,
        jobId: record.job.id,
        signal: record.controller.signal,
        onEvent: (draft) => this.#appendEvent(record, draft),
      });

      const status: HarnessRunJobStatus = record.cancelRequested
        ? "cancelled"
        : result.status === "completed"
          ? "completed"
          : "failed";
      this.#setStatus(record, status, {
        finishedAt: this.#clock(),
        lastHeartbeatAt: this.#clock(),
        lastProcessSeenAt: this.#clock(),
        result,
        errorMessage: result.status === "failed" ? (result.message ?? "Harness run failed") : null,
      });
    } catch (error) {
      this.#setStatus(record, record.cancelRequested ? "cancelled" : "failed", {
        finishedAt: this.#clock(),
        lastHeartbeatAt: this.#clock(),
        lastProcessSeenAt: this.#clock(),
        errorMessage: error instanceof Error ? error.message : "Harness run job failed",
      });
    } finally {
      this.#stopHeartbeat(record);
      this.#scheduleCleanup(record);
    }
  }

  #appendEvent(
    record: HarnessRunJobRecord,
    draft: Omit<HarnessStreamEvent, "sequence" | "timestamp">,
  ): void {
    const event = harnessStreamEventSchema.parse({
      ...draft,
      sequence: record.job.lastEventSequence + 1,
      timestamp: this.#clock(),
    });
    record.events.push(event);
    record.job = harnessRunJobSchema.parse({
      ...record.job,
      lastEventSequence: event.sequence,
      lastHeartbeatAt: event.timestamp,
      lastProcessSeenAt: event.timestamp,
    });
    this.#notify(record);
  }

  #setStatus(
    record: HarnessRunJobRecord,
    status: HarnessRunJobStatus,
    updates: Partial<
      Pick<
        HarnessRunJob,
        | "startedAt"
        | "finishedAt"
        | "lastHeartbeatAt"
        | "lastProcessSeenAt"
        | "cancelRequestedAt"
        | "result"
        | "errorMessage"
      >
    > = {},
  ): void {
    record.job = harnessRunJobSchema.parse({
      ...record.job,
      status,
      ...updates,
    });
    this.#notify(record);
  }

  #startHeartbeat(record: HarnessRunJobRecord): void {
    this.#stopHeartbeat(record);
    record.heartbeatTimer = setInterval(() => {
      if (isTerminalJobStatus(record.job.status)) {
        this.#stopHeartbeat(record);
        return;
      }

      const heartbeatAt = this.#clock();
      record.job = harnessRunJobSchema.parse({
        ...record.job,
        lastHeartbeatAt: heartbeatAt,
        lastProcessSeenAt: heartbeatAt,
      });
      this.#notify(record);
    }, harnessJobHeartbeatIntervalMs);
  }

  #stopHeartbeat(record: HarnessRunJobRecord): void {
    if (record.heartbeatTimer !== null) {
      clearInterval(record.heartbeatTimer);
      record.heartbeatTimer = null;
    }
  }

  #notify(record: HarnessRunJobRecord): void {
    for (const subscriber of record.subscribers) {
      subscriber();
    }
  }

  #scheduleCleanup(record: HarnessRunJobRecord): void {
    if (record.cleanupTimer !== null) {
      clearTimeout(record.cleanupTimer);
    }

    record.cleanupTimer = setTimeout(() => {
      this.#jobs.delete(record.job.id);
    }, this.#ttlMs);
  }
}

function matchSmokeRecordPath(pathname: string): string | null {
  const match = /^\/harnesses\/([^/]+)\/smoke$/u.exec(pathname);

  if (match === null) {
    return null;
  }

  const kind = decodeURIComponent(match[1] ?? "").trim();
  return kind.length === 0 ? null : kind;
}

function matchModelCatalogPath(pathname: string): string | null {
  const match = /^\/harnesses\/([^/]+)\/models$/u.exec(pathname);

  if (match === null) {
    return null;
  }

  const kind = decodeURIComponent(match[1] ?? "").trim();
  return kind.length === 0 ? null : kind;
}

function matchRunJobPath(pathname: string): string | null {
  const match = /^\/runs\/([^/]+)$/u.exec(pathname);

  if (match === null) {
    return null;
  }

  const id = decodeURIComponent(match[1] ?? "").trim();
  return id.length === 0 ? null : id;
}

function matchRunJobEventsPath(pathname: string): string | null {
  const match = /^\/runs\/([^/]+)\/events$/u.exec(pathname);

  if (match === null) {
    return null;
  }

  const id = decodeURIComponent(match[1] ?? "").trim();
  return id.length === 0 ? null : id;
}

function readSinceCursor(url: URL): number {
  const raw = url.searchParams.get("since");

  if (raw === null || raw.trim().length === 0) {
    return 0;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isTerminalJobStatus(status: HarnessRunJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function bridgeCapabilities(config: HarnessBridgeConfig): HarnessBridgeCapability[] {
  const capabilities: HarnessBridgeCapability[] = ["run_jobs", "heartbeat"];

  if (config.workspaceDir !== null) {
    capabilities.push("repository_snapshot_git_archive");
  }

  return capabilities;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireHarnessAuth(header: string | undefined, config: HarnessBridgeConfig): void {
  if (config.token.length === 0) {
    throw new Response("GREENROOM_HARNESS_TOKEN is not configured", { status: 503 });
  }

  const expected = `Bearer ${config.token}`;

  if (header === undefined || header.trim().length === 0) {
    throw new Response("Missing bearer token", { status: 401 });
  }

  if (header !== expected) {
    throw new Response("Invalid bearer token", { status: 403 });
  }
}

if (import.meta.main) {
  const config = readHarnessBridgeConfig();
  const app = createHarnessBridgeApp(config);

  Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
  });

  console.log(`Greenroom harness bridge listening on http://${config.host}:${config.port}`);

  // Startup harness CLI detection: probe installed harness CLIs and
  // record their versions without blocking readiness or crashing the bridge.
  void app.detector
    .probe()
    .then((detection) => {
      for (const harness of detection.harnesses) {
        console.log(
          harness.found
            ? `Detected ${harness.label} CLI at ${harness.path ?? harness.command}` +
                `${harness.version === null ? "" : ` (${harness.version})`}` +
                `${harness.recommendSmoke ? " — version changed since last verified run; smoke test recommended" : ""}`
            : `${harness.label} CLI was not detected${harness.message === null ? "" : `: ${harness.message}`}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.warn(
        `Harness CLI detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}
