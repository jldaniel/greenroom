import {
  installManagedPi,
  managedToolsDir,
  piNpmPackageName,
  piNpmPinnedVersion,
} from "@greenroom/harness/pi-install";

import { CliUsageError, expectNoPositionals, parseCommandArgs, readStringFlag } from "../args";
import { resolveBunPath, resolveCliDataDir } from "../context";

/**
 * `greenroom harness install-pi`: installs the pinned Pi coding
 * agent CLI into the Greenroom-managed tools directory (`<data dir>/tools/pi`)
 * so API-key users without Claude Code or Codex can run harness workflows.
 * The bridge detects the managed binary automatically on the next
 * `greenroom up` (managed path first, then the user PATH).
 */
export async function runHarnessInstallPi(args: readonly string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { "data-dir": "string" });
  expectNoPositionals(parsed, "harness install-pi");

  const env = process.env;
  const dataDir = resolveCliDataDir(readStringFlag(parsed, "data-dir"), env);
  const toolsDir = managedToolsDir(dataDir);

  try {
    const result = await installManagedPi({
      toolsDir,
      bunPath: resolveBunPath(env),
      env,
      log: (line) => console.log(line),
    });

    console.log("");
    console.log(`Pi ${result.version} is installed and managed by Greenroom.`);
    console.log(`  Package: ${result.packageName}@${result.pinnedVersion} (pinned)`);
    console.log(`  Binary:  ${result.binaryPath}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Export a provider API key before starting Greenroom, e.g.:");
    console.log("       export ANTHROPIC_API_KEY=...   (or OPENAI_API_KEY, GEMINI_API_KEY, ...)");
    console.log(
      "  2. Optionally pick a model with GREENROOM_PI_MODEL (e.g. anthropic/claude-sonnet-4-5)",
    );
    console.log("     or a provider with GREENROOM_PI_PROVIDER.");
    console.log(
      "  3. Restart `greenroom up`; the harness bridge will detect the managed Pi install.",
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Pi install failed");
    console.error(
      `You can retry with \`greenroom harness install-pi\` (installs ${piNpmPackageName}@${piNpmPinnedVersion}).`,
    );
    return 1;
  }
}

export function runHarnessCommand(args: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (subcommand !== "install-pi") {
    throw new CliUsageError(
      `Unknown harness subcommand: ${subcommand ?? "(none)"}. Try \`greenroom harness install-pi\`.`,
    );
  }

  return runHarnessInstallPi(rest);
}
