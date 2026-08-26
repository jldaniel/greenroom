import { mkdirSync } from "node:fs";

import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { storageSchema } from "../db/schema";
import {
  databaseParentDirectory,
  resolveDatabasePath,
  type GreenroomEnvironment,
} from "../config/paths";
import { runMigrations } from "./migrations";

export type GreenroomDrizzleDatabase = BunSQLiteDatabase<typeof storageSchema>;

export interface OpenDatabaseOptions {
  databasePath?: string;
  env?: GreenroomEnvironment;
  migrate?: boolean;
}

export interface GreenroomDatabase {
  path: string;
  sqlite: Database;
  db: GreenroomDrizzleDatabase;
  close: () => void;
}

export function openGreenroomDatabase(options: OpenDatabaseOptions = {}): GreenroomDatabase {
  const databasePath = options.databasePath ?? resolveDatabasePath(options.env);
  const parentDirectory = databaseParentDirectory(databasePath);

  if (parentDirectory !== null) {
    mkdirSync(parentDirectory, { recursive: true });
  }

  const sqlite = new Database(databasePath, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");

  if (options.migrate !== false) {
    runMigrations(sqlite);
  }

  return {
    path: databasePath,
    sqlite,
    db: drizzle(sqlite, { schema: storageSchema }),
    close: () => sqlite.close(),
  };
}
