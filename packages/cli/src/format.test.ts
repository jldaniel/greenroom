import { describe, expect, it } from "vitest";

import { formatConfigTable, formatServiceTable } from "./format";

describe("formatServiceTable", () => {
  it("renders aligned columns with dashes for missing values", () => {
    const table = formatServiceTable([
      {
        name: "api",
        state: "running",
        port: 49331,
        pid: 4242,
        url: "http://127.0.0.1:49331",
      },
      { name: "web", state: "starting", port: null, pid: null, url: null },
    ]);

    expect(table).toBe(
      [
        "SERVICE  STATE     PORT   PID   URL",
        "api      running   49331  4242  http://127.0.0.1:49331",
        "web      starting  -      -     -",
      ].join("\n"),
    );
  });
});

describe("formatConfigTable", () => {
  it("renders key, source, and value columns", () => {
    const table = formatConfigTable([
      { key: "server.port", source: "env (GREENROOM_PORT)", value: "50123" },
      { key: "server.host", source: "default", value: "(default)" },
    ]);

    expect(table).toBe(
      [
        "KEY          SOURCE                VALUE",
        "server.port  env (GREENROOM_PORT)  50123",
        "server.host  default               (default)",
      ].join("\n"),
    );
  });
});
