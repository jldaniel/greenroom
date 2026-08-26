import { createGreenroomApiServices, createGreenroomApp, seedProfilesFromDetection } from "./api";
import { loadGreenroomEnvironment, resolveDatabasePath, type GreenroomEnvironment } from "./config";
import { openGreenroomDatabase, type GreenroomDatabase } from "./storage";

export const defaultServerHost = "127.0.0.1";
export const defaultServerPort = 49331;
export const defaultLogLevel = "info";
const providerRequestIdleTimeoutSeconds = 120;

export type ServerLogLevel = "debug" | "info" | "warn" | "error";

export type SetupTokenEndpointMode = "auto" | "enabled" | "disabled";

export interface ServerCliConfig {
  host: string;
  port: number;
  databasePath: string;
  logLevel: ServerLogLevel;
  allowedOrigins: string[];
  setupTokenEndpoint: SetupTokenEndpointMode;
  bootstrapAdminToken: string | null;
  webDistPath: string | null;
  help: boolean;
}

export interface StartedGreenroomServer {
  host: string;
  port: number;
  url: string;
  database: GreenroomDatabase;
  server: ReturnType<typeof Bun.serve>;
  stop: () => void;
}

export function parseServerCliArgs(
  argv: readonly string[] = Bun.argv.slice(2),
  env: GreenroomEnvironment = process.env,
): ServerCliConfig {
  const values = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      values.set("help", true);
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf("=");

    if (equalsIndex !== -1) {
      values.set(arg.slice(2, equalsIndex), arg.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg.slice(2), next);
    index += 1;
  }

  return {
    host: readString(values, "host", env.GREENROOM_HOST ?? defaultServerHost),
    port: parsePort(readString(values, "port", env.GREENROOM_PORT ?? String(defaultServerPort))),
    databasePath: readString(values, "database-path", resolveDatabasePath(env)),
    logLevel: parseLogLevel(
      readString(values, "log-level", env.GREENROOM_LOG_LEVEL ?? defaultLogLevel),
    ),
    allowedOrigins: parseOriginList(
      readString(values, "allowed-origins", env.GREENROOM_ALLOWED_ORIGINS ?? ""),
    ),
    setupTokenEndpoint: parseSetupTokenEndpointMode(
      readString(values, "setup-token-endpoint", env.GREENROOM_SETUP_TOKEN_ENDPOINT ?? "auto"),
    ),
    bootstrapAdminToken: normalizeBootstrapToken(env.GREENROOM_BOOTSTRAP_ADMIN_TOKEN),
    webDistPath: normalizeOptionalPath(
      readString(values, "web-dist", env.GREENROOM_WEB_DIST ?? ""),
    ),
    help: values.has("help"),
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");

  return (
    normalized === "localhost" || normalized === "::1" || /^127(\.\d{1,3}){3}$/u.test(normalized)
  );
}

export function resolveSetupTokenEndpointEnabled(
  mode: SetupTokenEndpointMode,
  host: string,
): boolean {
  if (mode === "enabled") {
    return true;
  }

  if (mode === "disabled") {
    return false;
  }

  return isLoopbackHost(host);
}

export async function startGreenroomServer(
  config: ServerCliConfig,
  env: GreenroomEnvironment = process.env,
): Promise<StartedGreenroomServer> {
  const database = openGreenroomDatabase({ databasePath: config.databasePath });
  const services = createGreenroomApiServices(database, { env });

  // Fresh-DB profile seeding from detected reality. `greenroom up`
  // starts the bridge before the API, so detection normally answers right
  // away; a short timeout keeps startup bounded when it cannot.
  const seeding = await seedProfilesFromDetection(services);

  if (seeding.outcome === "harness_detected") {
    console.log(
      `Seeded default AI profiles from detected harness CLIs: ${seeding.detectedKinds.join(", ")}`,
    );
  } else if (seeding.outcome === "mock_fallback" && seeding.created.length > 0) {
    console.warn(
      "No harness CLI detected (or the harness bridge was unreachable); seeded mock AI profiles. " +
        "Install a harness CLI such as Claude Code and restart Greenroom to seed harness profiles.",
    );
  }

  const setupTokenEndpointEnabled = resolveSetupTokenEndpointEnabled(
    config.setupTokenEndpoint,
    config.host,
  );

  if (config.bootstrapAdminToken !== null) {
    services.tokens.provision(config.bootstrapAdminToken, {
      name: "Pre-provisioned admin",
      scopes: ["admin"],
    });
  }

  if (!setupTokenEndpointEnabled && config.bootstrapAdminToken === null) {
    console.warn(
      "Setup token endpoint is disabled for this bind host and no GREENROOM_BOOTSTRAP_ADMIN_TOKEN is set; " +
        "clients cannot bootstrap authentication unless a token already exists.",
    );
  }

  const app = createGreenroomApp({
    services,
    allowedOrigins: config.allowedOrigins,
    setupTokenEndpointEnabled,
    webDistDir: config.webDistPath,
  });
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: providerRequestIdleTimeoutSeconds,
    fetch: app.fetch,
  });
  const host = server.hostname ?? config.host;
  const port = server.port ?? config.port;
  const url = `http://${host}:${port}`;

  return {
    host,
    port,
    url,
    database,
    server,
    stop: () => {
      server.stop();
      database.close();
    },
  };
}

export function serverCliHelp(): string {
  return `Usage: bun --cwd apps/server src/cli.ts [options]

Options:
  --host <host>             Bind host (default: ${defaultServerHost})
  --port <port>             Bind port (default: ${defaultServerPort})
  --database-path <path>    SQLite database path
  --log-level <level>       debug, info, warn, or error (default: ${defaultLogLevel})
  --allowed-origins <list>  Comma-separated extra browser origins allowed by CORS
  --web-dist <path>         Serve the built web app (Vite dist directory) from
                            this API process; unknown non-API GETs fall back to
                            the SPA index.html
  --setup-token-endpoint <mode>
                            auto, enabled, or disabled (default: auto, which
                            enables unauthenticated setup-token creation only
                            on loopback bind hosts)
  --help                    Show this help

Environment:
  GREENROOM_SETUP_TOKEN_ENDPOINT   Same values as --setup-token-endpoint
  GREENROOM_WEB_DIST               Same as --web-dist (config file key
                                   server.webDist)
  GREENROOM_BOOTSTRAP_ADMIN_TOKEN  Pre-provision this value as an admin token
                                   at startup (required for non-loopback binds
                                   on a fresh database)

Configuration file:
  Non-secret settings can live in greenroom.toml in the app data dir (or at
  GREENROOM_CONFIG_PATH). Precedence per key: env var > config file > default.
  See docs/Environment.md for the key reference.
`;
}

function readString(values: Map<string, string | true>, key: string, fallback: string): string {
  const value = values.get(key);

  if (value === undefined) {
    return fallback;
  }

  if (value === true || value.trim() === "") {
    throw new Error(`Expected a value for --${key}`);
  }

  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535 || String(port) !== value.trim()) {
    throw new Error("Server port must be an integer between 1 and 65535");
  }

  return port;
}

function parseLogLevel(value: string): ServerLogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  throw new Error("Log level must be one of debug, info, warn, or error");
}

function parseSetupTokenEndpointMode(value: string): SetupTokenEndpointMode {
  if (value === "auto" || value === "enabled" || value === "disabled") {
    return value;
  }

  throw new Error("Setup token endpoint mode must be one of auto, enabled, or disabled");
}

function normalizeBootstrapToken(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalPath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOriginList(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

if (import.meta.main) {
  try {
    // Env var > config file > built-in default, applied per key: the loader
    // overlays greenroom.toml values onto env vars that are not already set.
    const loaded = loadGreenroomEnvironment(process.env);
    const config = parseServerCliArgs(Bun.argv.slice(2), loaded.env);

    if (config.help) {
      console.log(serverCliHelp());
      process.exit(0);
    }

    const runtime = await startGreenroomServer(config, loaded.env);
    console.log(
      `Greenroom API listening at ${runtime.url} using ${runtime.database.path} (${config.logLevel})`,
    );

    const stop = () => {
      runtime.stop();
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Greenroom API";
    console.error(message);
    process.exit(1);
  }
}
