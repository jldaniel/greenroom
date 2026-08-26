import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ServiceStatus } from "./types";

/**
 * Supervisor runtime state file.
 *
 * The `greenroom up` CLI supervises the API/MCP/web processes from its own
 * process, so the API server cannot observe service status directly. The CLI
 * writes this JSON file into the app data dir (atomically, via
 * write-temp-then-rename) on every status change, and both `greenroom
 * down`/`greenroom status` and the API's `GET /api/runtime/status` endpoint
 * read it back. The file lives in the local app data dir and never leaves the
 * machine.
 */

export const runtimeStateFileName = "runtime-state.json";

export interface RuntimeStatePorts {
  api: number | null;
  bridge: number | null;
  mcp: number | null;
  web: number | null;
}

export interface RuntimeStateUrls {
  api: string | null;
  bridge: string | null;
  mcp: string | null;
  web: string | null;
}

export interface RuntimeStateFile {
  version: 1;
  supervisorPid: number;
  startedAt: string;
  updatedAt: string;
  dataDir: string;
  host: string;
  ports: RuntimeStatePorts | null;
  urls: RuntimeStateUrls | null;
  services: ServiceStatus[];
}

export function runtimeStateFilePath(dataDir: string): string {
  return join(dataDir, runtimeStateFileName);
}

export async function writeRuntimeStateFile(path: string, state: RuntimeStateFile): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function readRuntimeStateFile(path: string): Promise<RuntimeStateFile | null> {
  let payload: unknown;

  try {
    payload = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }

  return isRuntimeStateFile(payload) ? payload : null;
}

export async function removeRuntimeStateFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Reports whether a PID refers to a live process (EPERM counts as alive). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EPERM"
    );
  }
}

export function isRuntimeStateFile(value: unknown): value is RuntimeStateFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.version === 1 &&
    typeof candidate.supervisorPid === "number" &&
    Number.isInteger(candidate.supervisorPid) &&
    candidate.supervisorPid > 0 &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.dataDir === "string" &&
    typeof candidate.host === "string" &&
    (candidate.ports === null || isPortsRecord(candidate.ports)) &&
    (candidate.urls === null || isUrlsRecord(candidate.urls)) &&
    Array.isArray(candidate.services) &&
    candidate.services.every(isServiceStatusLike)
  );
}

function isPortsRecord(value: unknown): value is RuntimeStatePorts {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (["api", "bridge", "mcp", "web"] as const).every(
    (key) => candidate[key] === null || typeof candidate[key] === "number",
  );
}

function isUrlsRecord(value: unknown): value is RuntimeStateUrls {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (["api", "bridge", "mcp", "web"] as const).every(
    (key) => candidate[key] === null || typeof candidate[key] === "string",
  );
}

function isServiceStatusLike(value: unknown): value is ServiceStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" && typeof candidate.state === "string";
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
