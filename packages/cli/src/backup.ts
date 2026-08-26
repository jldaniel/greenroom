import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { Database } from "bun:sqlite";

/**
 * SQLite backup for `greenroom db backup`.
 *
 * The copy is made with SQLite's `VACUUM INTO`, driven through `bun:sqlite`
 * (no external `sqlite3` binary required). `VACUUM INTO` writes a
 * transactionally consistent snapshot, so it is safe to run while the API is
 * serving requests against the same database.
 */

export function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `greenroom-backup-${stamp}.sqlite`;
}

export interface ResolveBackupDestinationOptions {
  destination: string | null;
  dataDir: string;
  now: Date;
  /** Injectable for tests; defaults to a real directory check. */
  isDirectory?: (path: string) => boolean;
}

/**
 * Resolves the backup target path: no argument backs up into
 * `<dataDir>/backups/<timestamped name>`; a directory argument gets the
 * timestamped name inside it; anything else is used as the file path.
 */
export function resolveBackupDestination(options: ResolveBackupDestinationOptions): string {
  const isDirectory = options.isDirectory ?? isExistingDirectory;
  const fileName = backupFileName(options.now);

  if (options.destination === null) {
    return join(options.dataDir, "backups", fileName);
  }

  const destination = isAbsolute(options.destination)
    ? options.destination
    : resolve(options.destination);

  if (options.destination.endsWith(sep) || isDirectory(destination)) {
    return join(destination, fileName);
  }

  return destination;
}

export function backupDatabase(databasePath: string, destination: string): void {
  if (!existsSync(databasePath)) {
    throw new Error(`Database file not found: ${databasePath}`);
  }

  if (existsSync(destination)) {
    throw new Error(`Backup destination already exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });

  const database = new Database(databasePath, { readonly: true });

  try {
    // VACUUM INTO takes a string literal; escape embedded single quotes.
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
