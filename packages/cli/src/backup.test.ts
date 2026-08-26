import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backupDatabase, backupFileName, resolveBackupDestination } from "./backup";

const now = new Date(2026, 6, 1, 15, 4, 5); // 2026-07-01 15:04:05 local time

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "greenroom-cli-backup-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("backupFileName", () => {
  it("produces a timestamped sqlite file name", () => {
    expect(backupFileName(now)).toBe("greenroom-backup-20260701-150405.sqlite");
  });
});

describe("resolveBackupDestination", () => {
  it("defaults to a timestamped file under <dataDir>/backups", () => {
    const destination = resolveBackupDestination({
      destination: null,
      dataDir: "/data/greenroom",
      now,
      isDirectory: () => false,
    });

    expect(destination).toBe(
      join("/data/greenroom", "backups", "greenroom-backup-20260701-150405.sqlite"),
    );
  });

  it("places the timestamped file inside an existing directory destination", () => {
    const destination = resolveBackupDestination({
      destination: "/backups",
      dataDir: "/data/greenroom",
      now,
      isDirectory: (path) => path === "/backups",
    });

    expect(destination).toBe(join("/backups", "greenroom-backup-20260701-150405.sqlite"));
  });

  it("treats a trailing separator as a directory destination", () => {
    const destination = resolveBackupDestination({
      destination: `/not-yet-created${sep}`,
      dataDir: "/data/greenroom",
      now,
      isDirectory: () => false,
    });

    expect(destination).toBe(join("/not-yet-created", "greenroom-backup-20260701-150405.sqlite"));
  });

  it("uses an explicit file path as-is, resolving relative paths", () => {
    const absolute = resolveBackupDestination({
      destination: "/backups/copy.sqlite",
      dataDir: "/data/greenroom",
      now,
      isDirectory: () => false,
    });
    const relative = resolveBackupDestination({
      destination: "copy.sqlite",
      dataDir: "/data/greenroom",
      now,
      isDirectory: () => false,
    });

    expect(absolute).toBe("/backups/copy.sqlite");
    expect(relative).toBe(resolve("copy.sqlite"));
  });
});

describe("backupDatabase", () => {
  it("creates a consistent snapshot readable by SQLite", () => {
    const databasePath = join(workDir, "greenroom.sqlite");
    const source = new Database(databasePath);
    source.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    source.exec("INSERT INTO notes (body) VALUES ('hello'), ('world')");
    source.close();

    const destination = join(workDir, "out", "backup.sqlite");
    backupDatabase(databasePath, destination);

    expect(existsSync(destination)).toBe(true);
    const copy = new Database(destination, { readonly: true });
    const rows = copy.query("SELECT body FROM notes ORDER BY id").all() as Array<{
      body: string;
    }>;
    copy.close();
    expect(rows.map((row) => row.body)).toEqual(["hello", "world"]);
  });

  it("refuses to overwrite an existing destination", () => {
    const databasePath = join(workDir, "greenroom.sqlite");
    new Database(databasePath).close();
    const destination = join(workDir, "existing.sqlite");
    mkdirSync(workDir, { recursive: true });
    new Database(destination).close();

    expect(() => backupDatabase(databasePath, destination)).toThrow(
      "Backup destination already exists",
    );
  });

  it("fails clearly when the database file is missing", () => {
    expect(() =>
      backupDatabase(join(workDir, "missing.sqlite"), join(workDir, "b.sqlite")),
    ).toThrow("Database file not found");
  });
});
