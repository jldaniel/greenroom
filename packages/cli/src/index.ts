#!/usr/bin/env bun
import { CliUsageError } from "./args";
import { runConfig } from "./commands/config";
import { runDbBackup } from "./commands/db";
import { runDown } from "./commands/down";
import { runHarnessCommand } from "./commands/harness";
import { runStatus } from "./commands/status";
import { runTokenCreate } from "./commands/token";
import { runUp } from "./commands/up";

export const greenroomCliHelp = `Usage: greenroom <command> [options]

Commands:
  up                    Start the Greenroom services and supervise them in
                        the foreground (Ctrl-C stops everything). By default
                        the built web app is served by the API process
                        (built first when missing); --dev runs the Vite dev
                        server with HMR instead
                          --data-dir <path>  App data directory
                          --dev              Vite dev server + HMR for the web app
                          --host <host>      Bind host (default: 127.0.0.1)
                          --verbose          Mirror service logs to stdout
  down                  Stop a running \`greenroom up\` instance
  status                Show supervised service state (nonzero exit when
                        nothing is running); --json for machine output
  token create          Mint an API token against the running API
                          --name <name>      Token name
                          --scopes <list>    Comma-separated scopes
                                             (default: read,comment:write)
  harness install-pi    Install the managed Pi coding agent (pinned version)
                        into <data dir>/tools/pi for API-key users without a
                        harness CLI; detection picks it up on the next up
  config                Print the resolved configuration and value sources
                          --path             Print only the greenroom.toml path
                          --json             Print the full resource as JSON
  db backup [dest]      Snapshot the SQLite database (VACUUM INTO) to a
                        timestamped file (default: <data dir>/backups/)
  help                  Show this help

Most commands accept --data-dir; otherwise GREENROOM_DATA_DIR or the platform
app-data default is used.
`;

export async function runGreenroomCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(greenroomCliHelp);
      return command === undefined ? 1 : 0;
    case "up":
      return runUp(rest);
    case "down":
      return runDown(rest);
    case "status":
      return runStatus(rest);
    case "token": {
      const [subcommand, ...tokenArgs] = rest;

      if (subcommand !== "create") {
        throw new CliUsageError(
          `Unknown token subcommand: ${subcommand ?? "(none)"}. Try \`greenroom token create\`.`,
        );
      }

      return runTokenCreate(tokenArgs);
    }
    case "harness":
      return runHarnessCommand(rest);
    case "config":
      return runConfig(rest);
    case "db": {
      const [subcommand, ...dbArgs] = rest;

      if (subcommand !== "backup") {
        throw new CliUsageError(
          `Unknown db subcommand: ${subcommand ?? "(none)"}. Try \`greenroom db backup\`.`,
        );
      }

      return runDbBackup(dbArgs);
    }
    default:
      throw new CliUsageError(`Unknown command: ${command}`);
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runGreenroomCli(Bun.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error("Run `greenroom help` for usage.");
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }

    process.exitCode = 1;
  }
}
