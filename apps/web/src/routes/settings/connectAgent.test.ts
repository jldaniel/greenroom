import { describe, expect, it } from "vitest";

import {
  agentTokenPlaceholder,
  claudeMcpAddSnippet,
  httpMcpConfigSnippet,
  mcpPackagePathPlaceholder,
  resolveAgentApiBaseUrl,
  stdioMcpConfigSnippet,
  type AgentConnectionContext,
} from "./connectAgentUtils";

const context: AgentConnectionContext = {
  mcpHttpEndpoint: "http://127.0.0.1:49332/mcp",
  apiBaseUrl: "http://127.0.0.1:49331",
  token: "greenroom_tok.secret",
};

describe("claudeMcpAddSnippet", () => {
  it("emits the claude CLI shape: add [options] <name> <url> with a bearer header", () => {
    expect(claudeMcpAddSnippet(context)).toBe(
      'claude mcp add --transport http greenroom http://127.0.0.1:49332/mcp --header "Authorization: Bearer greenroom_tok.secret"',
    );
  });

  it("uses the placeholder until a token is minted", () => {
    expect(claudeMcpAddSnippet({ ...context, token: null })).toContain(
      `Bearer ${agentTokenPlaceholder}`,
    );
    expect(claudeMcpAddSnippet({ ...context, token: "  " })).toContain(
      `Bearer ${agentTokenPlaceholder}`,
    );
  });
});

describe("stdioMcpConfigSnippet", () => {
  it("emits valid JSON matching the packages/mcp stdio contract", () => {
    const parsed = JSON.parse(stdioMcpConfigSnippet(context)) as {
      mcpServers: { greenroom: { command: string; args: string[]; env: Record<string, string> } };
    };

    expect(parsed.mcpServers.greenroom).toEqual({
      command: "bun",
      args: ["--cwd", mcpPackagePathPlaceholder, "src/stdio.ts"],
      env: {
        GREENROOM_API_BASE_URL: "http://127.0.0.1:49331",
        GREENROOM_API_TOKEN: "greenroom_tok.secret",
      },
    });
  });
});

describe("httpMcpConfigSnippet", () => {
  it("emits a streamable-HTTP server entry with the bearer header", () => {
    const parsed = JSON.parse(httpMcpConfigSnippet(context)) as {
      mcpServers: { greenroom: { type: string; url: string; headers: Record<string, string> } };
    };

    expect(parsed.mcpServers.greenroom).toEqual({
      type: "http",
      url: "http://127.0.0.1:49332/mcp",
      headers: { Authorization: "Bearer greenroom_tok.secret" },
    });
  });
});

describe("resolveAgentApiBaseUrl", () => {
  it("prefers the supervised runtime API URL", () => {
    expect(
      resolveAgentApiBaseUrl({
        runtimeApiUrl: "http://127.0.0.1:50001",
        configuredBaseUrl: "http://configured",
        windowOrigin: "http://origin",
      }),
    ).toBe("http://127.0.0.1:50001");
  });

  it("falls back to the configured base URL, then the page origin", () => {
    expect(
      resolveAgentApiBaseUrl({
        runtimeApiUrl: null,
        configuredBaseUrl: "http://127.0.0.1:49331/",
        windowOrigin: "http://origin",
      }),
    ).toBe("http://127.0.0.1:49331");
    expect(
      resolveAgentApiBaseUrl({
        runtimeApiUrl: null,
        configuredBaseUrl: null,
        windowOrigin: "http://127.0.0.1:5173",
      }),
    ).toBe("http://127.0.0.1:5173");
  });
});
