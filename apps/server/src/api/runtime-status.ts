import {
  isProcessAlive,
  readRuntimeStateFile,
  runtimeStateFilePath,
  type RuntimeStateFile,
  type ServiceName,
  type ServiceStatus,
} from "@greenroom/supervisor";

import { resolveAppDataDir, type GreenroomEnvironment } from "../config/paths";

/**
 * Supervised-service status API.
 *
 * The `greenroom up` supervisor runs in a separate process from the API, so
 * the API cannot query it directly. Instead of an authenticated push channel,
 * the supervisor writes `runtime-state.json` into the app data dir on every
 * status change and the API reads that file here. This was chosen as the
 * simplest reliable option: it needs no extra wiring or credentials, survives
 * API restarts, and the data never leaves the local machine. Staleness is
 * detected by checking whether the recorded supervisor PID is still alive.
 *
 * The response carries per-service data ({name, state, url, pid, lastExit,
 * message}) so the web Settings page can display supervised service health.
 */

export type RuntimeStatusReason = "ok" | "no-state-file" | "supervisor-not-running";

export interface RuntimeServiceStatusResource {
  name: ServiceName;
  state: ServiceStatus["state"];
  port: number | null;
  pid: number | null;
  url: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastExit: { exitCode: number | null; signal: string | null } | null;
  message: string | null;
}

export interface RuntimeStatusResource {
  supervised: boolean;
  reason: RuntimeStatusReason;
  updatedAt: string | null;
  supervisor: { pid: number; startedAt: string } | null;
  dataDir: string;
  services: RuntimeServiceStatusResource[];
}

export async function readRuntimeStatusResource(
  env: GreenroomEnvironment,
): Promise<RuntimeStatusResource> {
  const dataDir = resolveAppDataDir(env);
  const state = await readRuntimeStateFile(runtimeStateFilePath(dataDir));

  if (state === null) {
    return {
      supervised: false,
      reason: "no-state-file",
      updatedAt: null,
      supervisor: null,
      dataDir,
      services: [],
    };
  }

  if (!isProcessAlive(state.supervisorPid)) {
    return {
      supervised: false,
      reason: "supervisor-not-running",
      updatedAt: state.updatedAt,
      supervisor: null,
      dataDir,
      services: [],
    };
  }

  return {
    supervised: true,
    reason: "ok",
    updatedAt: state.updatedAt,
    supervisor: { pid: state.supervisorPid, startedAt: state.startedAt },
    dataDir,
    services: state.services.map((service) => toServiceResource(service, state)),
  };
}

function toServiceResource(
  service: ServiceStatus,
  state: RuntimeStateFile,
): RuntimeServiceStatusResource {
  const hasExited = service.exitCode !== null || service.signal !== null;

  return {
    name: service.name,
    state: service.state,
    port: state.ports?.[service.name] ?? null,
    pid: service.pid,
    url: service.url,
    startedAt: service.startedAt,
    stoppedAt: service.stoppedAt,
    lastExit: hasExited ? { exitCode: service.exitCode, signal: service.signal } : null,
    message: service.message,
  };
}
