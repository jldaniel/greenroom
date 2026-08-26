import { readConfigFileResource, type ConfigFileKeyStatus } from "@greenroom/server/api/config-api";

import { expectNoPositionals, parseCommandArgs, readBooleanFlag } from "../args";
import { formatConfigTable, type ConfigKeyRow } from "../format";

/**
 * `greenroom config`: prints the resolved configuration — the greenroom.toml
 * path, each editable key's effective source (env var > file > default), and
 * its value. `--path` prints just the file path for editing.
 */
export function runConfig(args: readonly string[]): number {
  const parsed = parseCommandArgs(args, { path: "boolean", json: "boolean" });
  expectNoPositionals(parsed, "config");

  const resource = readConfigFileResource(process.env);

  if (readBooleanFlag(parsed, "path")) {
    console.log(resource.path);
    return 0;
  }

  if (readBooleanFlag(parsed, "json")) {
    console.log(JSON.stringify(resource, null, 2));
    return 0;
  }

  console.log(`Config file: ${resource.path}${resource.exists ? "" : " (not created yet)"}`);

  if (resource.fileError !== null) {
    console.log("");
    console.log("The config file could not be parsed:");

    for (const issue of resource.fileError.issues) {
      console.log(`  ${issue.path}: ${issue.message}`);
    }
  }

  console.log("");
  console.log(formatConfigTable(resource.keys.map(toConfigRow)));
  console.log("");
  console.log("Precedence per key: env var > greenroom.toml > default.");
  return 0;
}

export function toConfigRow(status: ConfigFileKeyStatus): ConfigKeyRow {
  return {
    key: status.key,
    source: status.source === "env" ? `env (${status.envVar})` : status.source,
    value: describeValue(status),
  };
}

function describeValue(status: ConfigFileKeyStatus): string {
  if (status.source === "env") {
    return status.secret ? "(set, hidden)" : (status.envValue ?? "(set)");
  }

  if (status.source === "file") {
    const value = status.fileValue;
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  return "(default)";
}
