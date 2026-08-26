/** Minimal hand-rolled flag parser for the `greenroom` CLI. */

export class CliUsageError extends Error {}

export type FlagKind = "string" | "boolean";

export type FlagSpec = Record<string, FlagKind>;

export interface ParsedCommandArgs {
  flags: Map<string, string | true>;
  positionals: string[];
}

/**
 * Parses `--flag value`, `--flag=value`, and boolean `--flag` arguments
 * against a per-command spec. Unknown flags and missing values throw
 * {@link CliUsageError}; everything else is collected as a positional.
 */
export function parseCommandArgs(argv: readonly string[], spec: FlagSpec): ParsedCommandArgs {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const kind = spec[name];

    if (kind === undefined) {
      throw new CliUsageError(`Unknown flag: --${name}`);
    }

    if (kind === "boolean") {
      if (equalsIndex !== -1) {
        throw new CliUsageError(`Flag --${name} does not take a value`);
      }

      flags.set(name, true);
      continue;
    }

    if (equalsIndex !== -1) {
      const value = arg.slice(equalsIndex + 1);

      if (value.trim() === "") {
        throw new CliUsageError(`Expected a value for --${name}`);
      }

      flags.set(name, value);
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      throw new CliUsageError(`Expected a value for --${name}`);
    }

    flags.set(name, next);
    index += 1;
  }

  return { flags, positionals };
}

export function readStringFlag(parsed: ParsedCommandArgs, name: string): string | null {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : null;
}

export function readBooleanFlag(parsed: ParsedCommandArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

export function expectNoPositionals(parsed: ParsedCommandArgs, command: string): void {
  const extra = parsed.positionals[0];

  if (extra !== undefined) {
    throw new CliUsageError(`Unexpected argument for greenroom ${command}: ${extra}`);
  }
}
