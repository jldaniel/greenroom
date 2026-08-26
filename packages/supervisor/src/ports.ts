import { createServer } from "node:net";

export const loopbackHost = "127.0.0.1";

export interface PreferredPorts {
  api: number;
  bridge: number;
  mcp: number;
  web: number;
}

export const defaultPreferredPorts: PreferredPorts = {
  api: 49331,
  // Matches the harness bridge's own GREENROOM_HARNESS_PORT default.
  bridge: 49343,
  mcp: 49332,
  web: 5173,
};

export interface ServicePorts {
  api: number;
  bridge: number;
  mcp: number;
  web: number;
}

export async function chooseServicePorts(
  host = loopbackHost,
  preferred: PreferredPorts = defaultPreferredPorts,
): Promise<ServicePorts> {
  const reserved = new Set<number>();
  const api = await chooseLoopbackPort(preferred.api, host, reserved);
  reserved.add(api);
  const mcp = await chooseLoopbackPort(preferred.mcp, host, reserved);
  reserved.add(mcp);
  const web = await chooseLoopbackPort(preferred.web, host, reserved);
  reserved.add(web);
  const bridge = await chooseLoopbackPort(preferred.bridge, host, reserved);

  return { api, bridge, mcp, web };
}

export async function chooseLoopbackPort(
  preferredPort: number,
  host = loopbackHost,
  reserved: ReadonlySet<number> = new Set(),
): Promise<number> {
  assertValidTcpPort(preferredPort);

  if (!reserved.has(preferredPort) && (await isLoopbackPortAvailable(preferredPort, host))) {
    return preferredPort;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await findAvailableLoopbackPort(host);

    if (!reserved.has(port)) {
      return port;
    }
  }

  throw new Error("Unable to allocate a loopback port for Greenroom services");
}

export async function isLoopbackPortAvailable(port: number, host = loopbackHost): Promise<boolean> {
  assertValidTcpPort(port);

  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }

      reject(error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(true);
      });
    });
    server.listen(port, host);
  });
}

export async function findAvailableLoopbackPort(host = loopbackHost): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        if (typeof address === "object" && address !== null) {
          resolve(address.port);
          return;
        }

        reject(new Error("Unable to read allocated loopback port"));
      });
    });
    server.listen(0, host);
  });
}

function assertValidTcpPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
}
