import { describe, expect, it } from "vitest";

import { ServiceSupervisor } from "./supervisor";
import type { ProcessCommand, ServiceLogEntry, ServiceStatus } from "./types";

describe("service supervisor", () => {
  it("redacts token-shaped values from stored logs and statuses", () => {
    const supervisor = new ServiceSupervisor();
    const statuses: ServiceStatus[] = [];

    supervisor.on("status", (entry) => {
      statuses.push(entry);
    });

    supervisor.markFailed(
      "api",
      "startup failed with GREENROOM_API_TOKEN=grt_supersecret and Bearer abcdef123456",
    );

    expect(statuses.at(-1)?.message).toBe(
      "startup failed with GREENROOM_API_TOKEN=[redacted-token] and Bearer [redacted]",
    );
    expect(supervisor.getLogs()[0]?.message).toBe(
      "startup failed with GREENROOM_API_TOKEN=[redacted-token] and Bearer [redacted]",
    );
  });

  it("redacts service environment secrets from child process output", async () => {
    const supervisor = new ServiceSupervisor();
    const secret = "plain-local-secret";
    const stdoutLog = waitForLog(
      supervisor,
      (entry) => entry.service === "mcp" && entry.stream === "stdout",
    );
    const command: ProcessCommand = {
      name: "mcp",
      command: process.execPath,
      args: ["-e", `console.log(${JSON.stringify(`api token ${secret}`)})`],
      cwd: process.cwd(),
      env: {
        GREENROOM_API_TOKEN: secret,
      },
      readyUrl: "http://127.0.0.1:0/health",
      url: "http://127.0.0.1:0/mcp",
    };

    supervisor.start(command);
    const entry = await stdoutLog;
    await supervisor.stopAll();

    expect(entry.message).toBe("api token [redacted]");
    expect(
      supervisor
        .getLogs()
        .map((log) => log.message)
        .join("\n"),
    ).not.toContain(secret);
  });
});

function waitForLog(
  supervisor: ServiceSupervisor,
  predicate: (entry: ServiceLogEntry) => boolean,
): Promise<ServiceLogEntry> {
  return new Promise((resolve) => {
    supervisor.on("log", (entry) => {
      if (predicate(entry)) {
        resolve(entry);
      }
    });
  });
}
