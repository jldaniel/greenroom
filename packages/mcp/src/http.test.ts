import { describe, expect, it } from "vitest";

import {
  handleGreenroomMcpHttpRequest,
  parseGreenroomMcpHttpServerConfig,
  type GreenroomMcpHttpServerConfig,
} from "./http";

const config: GreenroomMcpHttpServerConfig = {
  host: "127.0.0.1",
  port: 49332,
  path: "/mcp",
  apiBaseUrl: "http://greenroom-api.test",
};

async function json(response: Response): Promise<unknown> {
  return response.json();
}

function postMcp(
  body: unknown,
  headers: Record<string, string> = {},
  requestConfig: GreenroomMcpHttpServerConfig = config,
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");

  return handleGreenroomMcpHttpRequest(
    requestConfig,
    new Request("http://greenroom-mcp.test/mcp", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

const toolsCallMessage = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "greenroom_list_reviews",
    arguments: {},
  },
};

describe("Greenroom MCP HTTP endpoint", () => {
  it("serves health metadata without advertising any fallback token", async () => {
    const response = await handleGreenroomMcpHttpRequest(
      config,
      new Request("http://greenroom-mcp.test/health"),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      mcpPath: "/mcp",
      apiBaseUrl: "http://greenroom-api.test",
    });
    expect(body).not.toHaveProperty("fallbackTokenConfigured");
  });

  it("handles token-free MCP capability requests", async () => {
    const initialized = await postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const listedTools = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    expect(initialized.status).toBe(200);
    expect(await json(initialized)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "greenroom" },
      },
    });
    expect(await json(listedTools)).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "greenroom_list_reviews" }),
        ]),
      },
    });
  });

  it("rejects unauthenticated API-backed calls with HTTP 401", async () => {
    const response = await postMcp(toolsCallMessage);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(await json(response)).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32000,
        message: expect.stringContaining("Authorization bearer token"),
      },
    });
  });

  it("never falls back to a server-side environment token", async () => {
    const parsed = parseGreenroomMcpHttpServerConfig({
      GREENROOM_API_TOKEN: "grt_server_env_secret",
      GREENROOM_API_BASE_URL: "http://greenroom-api.test",
    });

    // The env token no longer reaches the config at all.
    expect(parsed).not.toHaveProperty("apiToken");

    const response = await postMcp(toolsCallMessage, {}, parsed);

    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000 },
    });
  });

  it("returns 401 for batches containing unauthenticated API-backed calls", async () => {
    const response = await postMcp([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      toolsCallMessage,
    ]);

    expect(response.status).toBe(401);

    const body = (await json(response)) as unknown[];

    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 1, result: expect.anything() });
    expect(body[1]).toMatchObject({ id: 3, error: { code: -32000 } });
  });

  it("forwards the caller's explicit bearer token to the API", async () => {
    const seenAuthorizations: Array<string | null> = [];
    const fetchMock = (input: string, init?: RequestInit): Promise<Response> => {
      seenAuthorizations.push(new Headers(init?.headers).get("authorization"));

      expect(input).toContain("http://greenroom-api.test/api/reviews");

      return Promise.resolve(
        new Response(JSON.stringify({ reviews: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    const response = await postMcp(
      toolsCallMessage,
      { authorization: "Bearer grt_caller_token" },
      { ...config, fetch: fetchMock },
    );

    expect(response.status).toBe(200);
    expect(seenAuthorizations).toEqual(["Bearer grt_caller_token"]);
    expect(await json(response)).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: expect.anything(),
    });
  });

  it("allows token-free reads of non-secret concept resources", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: {
        uri: "greenroom://concepts/review-model",
      },
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        contents: [
          {
            uri: "greenroom://concepts/review-model",
            text: expect.stringContaining("greenroom.mcp.concept.v1"),
          },
        ],
      },
    });
  });

  describe("cross-origin protection", () => {
    it("rejects cross-origin POST requests from non-allowlisted origins", async () => {
      const response = await postMcp(toolsCallMessage, {
        origin: "https://evil.example",
        authorization: "Bearer grt_stolen_token",
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await json(response)).toMatchObject({ error: "origin_forbidden" });
    });

    it("rejects preflight requests from non-allowlisted origins", async () => {
      const response = await handleGreenroomMcpHttpRequest(
        config,
        new Request("http://greenroom-mcp.test/mcp", {
          method: "OPTIONS",
          headers: {
            origin: "https://evil.example",
            "access-control-request-method": "POST",
          },
        }),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("never serves a wildcard or unsolicited CORS header", async () => {
      const health = await handleGreenroomMcpHttpRequest(
        config,
        new Request("http://greenroom-mcp.test/health"),
      );
      const rpc = await postMcp({ jsonrpc: "2.0", id: 1, method: "initialize" });

      expect(health.headers.get("access-control-allow-origin")).toBeNull();
      expect(rpc.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("echoes only explicitly allowlisted origins", async () => {
      const allowingConfig: GreenroomMcpHttpServerConfig = {
        ...config,
        allowedOrigins: ["https://tools.example"],
      };

      const preflight = await handleGreenroomMcpHttpRequest(
        allowingConfig,
        new Request("http://greenroom-mcp.test/mcp", {
          method: "OPTIONS",
          headers: {
            origin: "https://tools.example",
            "access-control-request-method": "POST",
          },
        }),
      );

      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://tools.example");
      expect(preflight.headers.get("vary")).toBe("Origin");

      // Allowlisting an origin does not waive authentication.
      const unauthenticated = await postMcp(
        toolsCallMessage,
        { origin: "https://tools.example" },
        allowingConfig,
      );

      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("access-control-allow-origin")).toBe(
        "https://tools.example",
      );

      // Other origins remain blocked.
      const blocked = await postMcp(
        toolsCallMessage,
        { origin: "https://other.example" },
        allowingConfig,
      );

      expect(blocked.status).toBe(403);
      expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("parses the allowed-origin allowlist from the environment", () => {
      const parsed = parseGreenroomMcpHttpServerConfig({
        GREENROOM_MCP_ALLOWED_ORIGINS: " https://a.example, https://b.example ,",
      });

      expect(parsed.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    });
  });
});
