import { loadGreenroomEnvironment } from "@greenroom/server/config/file";
import { resolveAppDataDir, resolveDatabasePath } from "@greenroom/server/config/paths";

import { CliUsageError, parseCommandArgs, readStringFlag } from "../args";
import { backupDatabase, resolveBackupDestination } from "../backup";

/**
 * `greenroom db backup [dest]`: snapshots the SQLite database with
 * `VACUUM INTO` (via bun:sqlite), which is transactionally consistent even
 * while services are running. The database location follows the same
 * resolution as the server: env vars > greenroom.toml > data-dir default.
 */
export function runDbBackup(args: readonly string[]): number {
  const parsed = parseCommandArgs(args, { "data-dir": "string" });
  const extraPositional = parsed.positionals[1];

  if (extraPositional !== undefined) {
    throw new CliUsageError(`Unexpected argument for greenroom db backup: ${extraPositional}`);
  }

  const dataDirFlag = readStringFlag(parsed, "data-dir");
  const env =
    dataDirFlag === null ? process.env : { ...process.env, GREENROOM_DATA_DIR: dataDirFlag };
  const loaded = loadGreenroomEnvironment(env);
  const databasePath = resolveDatabasePath(loaded.env);
  const destination = resolveBackupDestination({
    destination: parsed.positionals[0] ?? null,
    dataDir: resolveAppDataDir(loaded.env),
    now: new Date(),
  });

  backupDatabase(databasePath, destination);
  console.log(`Backed up ${databasePath}`);
  console.log(`       to ${destination}`);
  console.log("(snapshot created with SQLite VACUUM INTO; safe while services are running)");
  return 0;
}
