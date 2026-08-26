import { describe, expect, it } from "vitest";

import {
  CliUsageError,
  expectNoPositionals,
  parseCommandArgs,
  readBooleanFlag,
  readStringFlag,
} from "./args";

describe("parseCommandArgs", () => {
  it("parses string flags in both --flag value and --flag=value forms", () => {
    const parsed = parseCommandArgs(["--data-dir", "/tmp/gr", "--host=0.0.0.0"], {
      "data-dir": "string",
      host: "string",
    });

    expect(readStringFlag(parsed, "data-dir")).toBe("/tmp/gr");
    expect(readStringFlag(parsed, "host")).toBe("0.0.0.0");
    expect(parsed.positionals).toEqual([]);
  });

  it("parses boolean flags and collects positionals", () => {
    const parsed = parseCommandArgs(["backups/", "--verbose"], { verbose: "boolean" });

    expect(readBooleanFlag(parsed, "verbose")).toBe(true);
    expect(parsed.positionals).toEqual(["backups/"]);
  });

  it("returns null and false for absent flags", () => {
    const parsed = parseCommandArgs([], { name: "string", json: "boolean" });

    expect(readStringFlag(parsed, "name")).toBeNull();
    expect(readBooleanFlag(parsed, "json")).toBe(false);
  });

  it("rejects unknown flags", () => {
    expect(() => parseCommandArgs(["--nope"], {})).toThrow(CliUsageError);
    expect(() => parseCommandArgs(["--nope"], {})).toThrow("Unknown flag: --nope");
  });

  it("rejects missing values for string flags", () => {
    expect(() => parseCommandArgs(["--name"], { name: "string" })).toThrow(
      "Expected a value for --name",
    );
    expect(() =>
      parseCommandArgs(["--name", "--json"], { name: "string", json: "boolean" }),
    ).toThrow("Expected a value for --name");
    expect(() => parseCommandArgs(["--name="], { name: "string" })).toThrow(
      "Expected a value for --name",
    );
  });

  it("rejects values passed to boolean flags", () => {
    expect(() => parseCommandArgs(["--json=1"], { json: "boolean" })).toThrow(
      "Flag --json does not take a value",
    );
  });

  it("rejects unexpected positionals through expectNoPositionals", () => {
    const parsed = parseCommandArgs(["extra"], {});

    expect(() => expectNoPositionals(parsed, "status")).toThrow(
      "Unexpected argument for greenroom status: extra",
    );
    expect(() => expectNoPositionals(parseCommandArgs([], {}), "status")).not.toThrow();
  });
});
