import {
  isProcessAlive,
  readRuntimeStateFile,
  runtimeStateFilePath,
  type RuntimeStateFile,
} from "@greenroom/supervisor";
import type { RuntimeStatusResource } from "@greenroom/server/api/runtime-status";

import { expectNoPositionals, parseCommandArgs, readBooleanFlag, readStringFlag } from "../args";
import { resolveApiToken, resolveCliDataDir } from "../context";
import { formatServiceTable, type ServiceStatusRow } from "../format";

const probeTimeoutMs = 3_000;

type ApiProbe =
  | { kind: "status-endpoint"; resource: RuntimeStatusResource }
  | { kind: "health"; ok: boolean }
  | { kind: "unreachable" }
  | { kind: "skipped" };

/**
 * `greenroom status`: reports supervised service state from the runtime state
 * file, cross-checked with a live probe of the API's `/api/runtime/status`
 * endpoint (falling back to unauthenticated `/health` when no token is
 * available). Exits nonzero when nothing is running.
 */
export async function runStatus(args: readonly string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { "data-dir": "string", json: "boolean" });
  expectNoPositionals(parsed, "status");

  const dataDir = resolveCliDataDir(readStringFlag(parsed, "data-dir"));
  const statePath = runtimeStateFilePath(dataDir);
  const state = await readRuntimeStateFile(statePath);

  if (state === null) {
    console.error(`Greenroom is not running (no runtime state file in ${dataDir}).`);
    return 1;
  }

  if (!isProcessAlive(state.supervisorPid)) {
    console.error(
      `Greenroom is not running (stale state file from supervisor pid ${state.supervisorPid}).`,
    );
    console.error("Run `greenroom down` to clean it up.");
    return 1;
  }

  const probe = await probeApi(state, dataDir);
  const rows = serviceRows(state, probe);

  if (readBooleanFlag(parsed, "json")) {
    console.log(
      JSON.stringify(
        {
          supervisorPid: state.supervisorPid,
          startedAt: state.startedAt,
          dataDir: state.dataDir,
          probe: probe.kind,
          services: rows,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatServiceTable(rows));
    console.log("");
    console.log(`Supervisor: pid ${state.supervisorPid}, started ${state.startedAt}`);
    console.log(`Data dir:   ${state.dataDir}`);
    console.log(`API probe:  ${describeProbe(probe)}`);
  }

  return rows.some((row) => row.state === "running") ? 0 : 1;
}

async function probeApi(state: RuntimeStateFile, dataDir: string): Promise<ApiProbe> {
  const apiBaseUrl = state.urls?.api ?? null;

  if (apiBaseUrl === null) {
    return { kind: "skipped" };
  }

  const token = await resolveApiToken(dataDir);

  if (token !== null) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/runtime/status`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(probeTimeoutMs),
      });

      if (response.ok) {
        return {
          kind: "status-endpoint",
          resource: (await response.json()) as RuntimeStatusResource,
        };
      }
    } catch {
      return { kind: "unreachable" };
    }
  }

  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    return { kind: "health", ok: response.ok };
  } catch {
    return { kind: "unreachable" };
  }
}

function serviceRows(state: RuntimeStateFile, probe: ApiProbe): ServiceStatusRow[] {
  if (probe.kind === "status-endpoint" && probe.resource.supervised) {
    return probe.resource.services.map((service) => ({
      name: service.name,
      state: service.state,
      port: service.port,
      pid: service.pid,
      url: service.url,
    }));
  }

  return state.services.map((service) => ({
    name: service.name,
    state: service.state,
    port: state.ports?.[service.name] ?? null,
    pid: service.pid,
    url: service.url,
  }));
}

function describeProbe(probe: ApiProbe): string {
  switch (probe.kind) {
    case "status-endpoint":
      return "ok (GET /api/runtime/status)";
    case "health":
      return probe.ok ? "ok (GET /health; no API token for the status endpoint)" : "unhealthy";
    case "unreachable":
      return "unreachable";
    case "skipped":
      return "skipped (no API URL recorded yet)";
  }
}
