import type { AddressInfo, Server } from "node:net";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerMock } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
}));

vi.mock("node:net", () => ({
  createServer: createServerMock,
}));

import {
  chooseServicePorts,
  chooseLoopbackPort,
  findAvailableLoopbackPort,
  loopbackHost,
} from "./ports";

type ListenOutcome = { kind: "available"; allocatedPort: number } | { kind: "occupied" };

interface MockServer {
  address: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  listen: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

const outcomes: ListenOutcome[] = [];
const servers: MockServer[] = [];

beforeEach(() => {
  outcomes.splice(0);
  servers.splice(0);
  createServerMock.mockReset();
  createServerMock.mockImplementation(createMockServer);
});

describe("port allocation", () => {
  it("uses the preferred loopback port when it is available", async () => {
    queueAvailablePort(51_000);

    await expect(chooseLoopbackPort(49_331)).resolves.toBe(49_331);

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(servers[0]?.listen).toHaveBeenCalledWith(49_331, loopbackHost);
    expect(outcomes).toHaveLength(0);
  });

  it("selects an available replacement when the preferred port is occupied", async () => {
    queueOccupiedPort();
    queueAvailablePort(51_001);

    await expect(chooseLoopbackPort(49_331)).resolves.toBe(51_001);

    expect(createServerMock).toHaveBeenCalledTimes(2);
    expect(servers[0]?.listen).toHaveBeenCalledWith(49_331, loopbackHost);
    expect(servers[1]?.listen).toHaveBeenCalledWith(0, loopbackHost);
    expect(outcomes).toHaveLength(0);
  });

  it("uses the default loopback host for ephemeral allocation", async () => {
    queueAvailablePort(51_001);

    await expect(findAvailableLoopbackPort()).resolves.toBe(51_001);

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(servers[0]?.listen).toHaveBeenCalledWith(0, loopbackHost);
    expect(outcomes).toHaveLength(0);
  });

  it("skips reserved preferred and dynamically allocated candidates", async () => {
    queueAvailablePort(51_001);
    queueAvailablePort(51_002);

    await expect(chooseLoopbackPort(49_331, loopbackHost, new Set([49_331, 51_001]))).resolves.toBe(
      51_002,
    );

    expect(createServerMock).toHaveBeenCalledTimes(2);
    expect(servers.every((server) => server.listen.mock.calls[0]?.[0] === 0)).toBe(true);
    expect(outcomes).toHaveLength(0);
  });

  it("returns distinct ports for all supervised services", async () => {
    queueAvailablePort(49_331);
    queueAvailablePort(51_001);
    queueAvailablePort(51_002);
    queueAvailablePort(51_003);

    const ports = await chooseServicePorts(loopbackHost, {
      api: 49_331,
      bridge: 49_331,
      mcp: 49_331,
      web: 49_331,
    });

    expect(ports).toEqual({
      api: 49_331,
      bridge: 51_003,
      mcp: 51_001,
      web: 51_002,
    });
    expect(new Set([ports.api, ports.bridge, ports.mcp, ports.web]).size).toBe(4);
    expect(createServerMock).toHaveBeenCalledTimes(4);
    expect(outcomes).toHaveLength(0);
  });
});

function queueAvailablePort(allocatedPort: number): void {
  outcomes.push({ kind: "available", allocatedPort });
}

function queueOccupiedPort(): void {
  outcomes.push({ kind: "occupied" });
}

function createMockServer(): Server {
  const outcome = outcomes.shift();

  if (outcome === undefined) {
    throw new Error("No mocked listen outcome was queued");
  }

  const listeners = new Map<string, (...args: unknown[]) => void>();
  const server: MockServer = {
    address: vi.fn(
      (): AddressInfo => ({
        address: loopbackHost,
        family: "IPv4",
        port: outcome.kind === "available" ? outcome.allocatedPort : 0,
      }),
    ),
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
      return server;
    }),
    listen: vi.fn(() => {
      if (outcome.kind === "occupied") {
        const error = Object.assign(new Error("Port is occupied"), { code: "EADDRINUSE" });
        listeners.get("error")?.(error);
      } else {
        listeners.get("listening")?.();
      }

      return server;
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return server;
    }),
  };
  servers.push(server);

  return server as unknown as Server;
}
