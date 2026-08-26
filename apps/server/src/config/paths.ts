import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface GreenroomEnvironment {
  [key: string]: string | undefined;
  GREENROOM_DATA_DIR?: string;
  GREENROOM_DB_PATH?: string;
  GREENROOM_BOOTSTRAP_ADMIN_TOKEN?: string;
  GREENROOM_HOST?: string;
  GREENROOM_LOG_LEVEL?: string;
  GREENROOM_PORT?: string;
  GREENROOM_SETUP_TOKEN_ENDPOINT?: string;
  GREENROOM_WEB_DIST?: string;
  HOME?: string;
  XDG_DATA_HOME?: string;
}

export const defaultDatabaseFileName = "greenroom.sqlite";

export function resolveAppDataDir(env: GreenroomEnvironment = process.env): string {
  if (env.GREENROOM_DATA_DIR !== undefined && env.GREENROOM_DATA_DIR.trim() !== "") {
    return env.GREENROOM_DATA_DIR;
  }

  const home = env.HOME ?? homedir();

  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Greenroom");
  }

  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "greenroom");
}

export function resolveDatabasePath(env: GreenroomEnvironment = process.env): string {
  if (env.GREENROOM_DB_PATH !== undefined && env.GREENROOM_DB_PATH.trim() !== "") {
    return env.GREENROOM_DB_PATH;
  }

  return join(resolveAppDataDir(env), defaultDatabaseFileName);
}

export function databaseParentDirectory(databasePath: string): string | null {
  if (databasePath === ":memory:") {
    return null;
  }

  return dirname(databasePath);
}
