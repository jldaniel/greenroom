import { createGreenroomHttpClient, type GreenroomHttpClientOptions } from "./client";
import {
  createGreenroomMcpServer,
  type JsonRpcErrorResponse,
  type JsonRpcResponse,
} from "./server";

export const defaultMcpHttpHost = "127.0.0.1";
export const defaultMcpHttpPort = 49332;
export const defaultMcpHttpPath = "/mcp";

export interface GreenroomMcpHttpEnvironment {
  [key: string]: string | undefined;
  GREENROOM_API_BASE_URL?: string;
  GREENROOM_MCP_HOST?: string;
  GREENROOM_MCP_PORT?: string;
  GREENROOM_MCP_ALLOWED_ORIGINS?: string;
}

export interface GreenroomMcpHttpServerConfig {
  host: string;
  port: number;
  path: string;
  apiBaseUrl: string;
  /**
   * Browser origins allowed to make cross-origin requests. Empty by default:
   * requests carrying an `Origin` header are rejected with 403 unless the
   * origin is explicitly allowlisted here. There is no wildcard support.
   */
  allowedOrigins?: readonly string[];
  fetch?: GreenroomHttpClientOptions["fetch"];
}

export interface StartedGreenroomMcpHttpServer {
  host: string;
  port: number;
  url: string;
  path: string;
  server: ReturnType<typeof Bun.serve>;
  stop: () => void;
}

export function parseGreenroomMcpHttpServerConfig(
  env: GreenroomMcpHttpEnvironment = Bun.env,
): GreenroomMcpHttpServerConfig {
  return {
    host: readString(env.GREENROOM_MCP_HOST, defaultMcpHttpHost),
    port: parsePort(readString(env.GREENROOM_MCP_PORT, String(defaultMcpHttpPort))),
    path: defaultMcpHttpPath,
    apiBaseUrl: readString(env.GREENROOM_API_BASE_URL, "http://127.0.0.1:49331"),
    allowedOrigins: parseAllowedOrigins(env.GREENROOM_MCP_ALLOWED_ORIGINS),
  };
}

export function startGreenroomMcpHttpServer(
  config: GreenroomMcpHttpServerConfig,
): StartedGreenroomMcpHttpServer {
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: (request) => handleGreenroomMcpHttpRequest(config, request),
  });
  const host = server.hostname ?? config.host;
  const port = server.port ?? config.port;

  return {
    host,
    port,
    url: `http://${host}:${port}`,
    path: config.path,
    server,
    stop: () => server.stop(),
  };
}

export async function handleGreenroomMcpHttpRequest(
  config: GreenroomMcpHttpServerConfig,
  request: Request,
): Promise<Response> {
  const origin = request.headers.get("origin");

  // Cross-origin requests are rejected outright unless the origin is
  // explicitly allowlisted. No wildcard: a browser page must never be able to
  // drive local MCP tools.
  if (origin !== null && !isAllowedOrigin(origin, config.allowedOrigins ?? [])) {
    return jsonResponse(
      { error: "origin_forbidden", message: "Request origin is not allowed" },
      403,
    );
  }

  const response = await routeGreenroomMcpHttpRequest(config, request);

  if (origin !== null) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.append("vary", "Origin");
  }

  return response;
}

async function routeGreenroomMcpHttpRequest(
  config: GreenroomMcpHttpServerConfig,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: new Headers({
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
        "access-control-max-age": "600",
      }),
    });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      status: "ok",
      mcpPath: config.path,
      apiBaseUrl: config.apiBaseUrl,
    });
  }

  if (request.method === "GET" && url.pathname === "/") {
    return jsonResponse({
      name: "greenroom-mcp",
      endpoints: {
        health: "/health",
        jsonRpc: config.path,
      },
    });
  }

  if (url.pathname !== config.path) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      allow: "POST, OPTIONS",
    });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    return jsonResponse(jsonRpcError(null, -32700, "Invalid JSON-RPC request body"), 400);
  }

  const requestToken = readBearerToken(request.headers);

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return jsonResponse(jsonRpcError(null, -32600, "JSON-RPC batch must not be empty"), 400);
    }

    const results = await Promise.all(
      payload.map((message) => handleJsonRpcMessage(config, message, requestToken)),
    );
    const responses = results
      .map((result) => result.response)
      .filter((response): response is JsonRpcResponse => response !== null);
    const unauthorized = results.some((result) => result.unauthorized);

    if (responses.length === 0) {
      return new Response(null, { status: 204, headers: responseHeaders() });
    }

    return jsonResponse(
      responses,
      unauthorized ? 401 : 200,
      unauthorized ? unauthorizedHeaders() : {},
    );
  }

  const result = await handleJsonRpcMessage(config, payload, requestToken);

  if (result.response === null) {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }

  if (result.unauthorized) {
    return jsonResponse(result.response, 401, unauthorizedHeaders());
  }

  return jsonResponse(result.response);
}

interface JsonRpcHandlingResult {
  response: JsonRpcResponse | null;
  unauthorized: boolean;
}

async function handleJsonRpcMessage(
  config: GreenroomMcpHttpServerConfig,
  message: unknown,
  token: string | null,
): Promise<JsonRpcHandlingResult> {
  if (requiresApiToken(message) && token === null) {
    return {
      response: jsonRpcError(
        jsonRpcId(message),
        -32000,
        "Authorization bearer token is required for Greenroom MCP API calls",
      ),
      unauthorized: true,
    };
  }

  const client = createGreenroomHttpClient({
    baseUrl: config.apiBaseUrl,
    token: token ?? "",
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
  });
  const server = createGreenroomMcpServer({ client });

  try {
    return { response: await server.handleMessage(message), unauthorized: false };
  } catch (error) {
    return {
      response: jsonRpcError(
        jsonRpcId(message),
        -32600,
        error instanceof Error ? error.message : "Invalid JSON-RPC request",
      ),
      unauthorized: false,
    };
  }
}

function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin);
}

function parseAllowedOrigins(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function unauthorizedHeaders(): Record<string, string> {
  return { "www-authenticate": 'Bearer realm="greenroom-mcp"' };
}

function requiresApiToken(message: unknown): boolean {
  return (
    isJsonRpcObject(message) &&
    (message.method === "tools/call" ||
      (message.method === "resources/read" && !isTokenFreeResourceRead(message)))
  );
}

function isTokenFreeResourceRead(message: { params?: unknown }): boolean {
  if (
    typeof message.params !== "object" ||
    message.params === null ||
    Array.isArray(message.params)
  ) {
    return false;
  }

  const uri = (message.params as { uri?: unknown }).uri;

  return typeof uri === "string" && uri.startsWith("greenroom://concepts/");
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function jsonRpcId(message: unknown): string | number | null {
  if (!isJsonRpcObject(message)) {
    return null;
  }

  return typeof message.id === "string" || typeof message.id === "number" || message.id === null
    ? message.id
    : null;
}

function isJsonRpcObject(message: unknown): message is {
  id?: unknown;
  method?: unknown;
  params?: unknown;
} {
  return typeof message === "object" && message !== null && !Array.isArray(message);
}

function readString(value: string | undefined, fallback: string): string {
  const normalized = readOptionalString(value);

  return normalized ?? fallback;
}

function readOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535 || String(port) !== value.trim()) {
    throw new Error("MCP HTTP port must be an integer between 1 and 65535");
  }

  return port;
}

function readBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");

  if (authorization === null) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return readOptionalString(token);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(headers),
  });
}

function responseHeaders(headers: Record<string, string> = {}): Headers {
  return new Headers({
    "content-type": "application/json",
    ...headers,
  });
}

if (import.meta.main) {
  try {
    const config = parseGreenroomMcpHttpServerConfig();
    const runtime = startGreenroomMcpHttpServer(config);
    console.log(
      `Greenroom MCP HTTP listening at ${runtime.url}${runtime.path} using API ${config.apiBaseUrl}`,
    );

    const stop = () => {
      runtime.stop();
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to start Greenroom MCP HTTP");
    process.exit(1);
  }
}
