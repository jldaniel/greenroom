import {
  isProcessAlive,
  readRuntimeStateFile,
  removeRuntimeStateFile,
  runtimeStateFilePath,
} from "@greenroom/supervisor";

import { expectNoPositionals, parseCommandArgs, readStringFlag } from "../args";
import { delay, resolveCliDataDir } from "../context";

const stopTimeoutMs = 30_000;
const pollIntervalMs = 250;

/**
 * `greenroom down`: signals the `greenroom up` supervisor found through the
 * runtime state file with SIGTERM (its handler stops all services), waits for
 * it to exit, and cleans up stale state files from crashed supervisors.
 */
export async function runDown(args: readonly string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { "data-dir": "string" });
  expectNoPositionals(parsed, "down");

  const dataDir = resolveCliDataDir(readStringFlag(parsed, "data-dir"));
  const statePath = runtimeStateFilePath(dataDir);
  const state = await readRuntimeStateFile(statePath);

  if (state === null) {
    console.error(`Greenroom is not running (no runtime state file in ${dataDir}).`);
    return 1;
  }

  if (!isProcessAlive(state.supervisorPid)) {
    await removeRuntimeStateFile(statePath);
    console.log(
      `Removed stale runtime state (supervisor pid ${state.supervisorPid} is no longer running).`,
    );
    return 0;
  }

  console.log(`Stopping Greenroom (supervisor pid ${state.supervisorPid})...`);
  process.kill(state.supervisorPid, "SIGTERM");

  const deadline = Date.now() + stopTimeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(state.supervisorPid)) {
      // The supervisor removes its own state file on clean shutdown; clear
      // any leftover just in case.
      await removeRuntimeStateFile(statePath);
      console.log("Greenroom stopped.");
      return 0;
    }

    await delay(pollIntervalMs);
  }

  console.error(
    `Supervisor pid ${state.supervisorPid} did not exit within ${stopTimeoutMs / 1000}s; sending SIGKILL.`,
  );
  console.error("Supervised services may need manual cleanup.");
  process.kill(state.supervisorPid, "SIGKILL");
  await removeRuntimeStateFile(statePath);
  return 1;
}
