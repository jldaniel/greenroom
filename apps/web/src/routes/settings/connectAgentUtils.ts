/**
 * Copy-paste MCP client configuration for the "Connect a coding agent" card.
 * The snippets mirror the two transports in `packages/mcp`
 * (documented in docs/MCP.md):
 *
 * - HTTP: `src/http.ts` serves JSON-RPC on POST /mcp and reads the API token
 *   from the request's `Authorization: Bearer` header.
 * - stdio: `src/stdio.ts` runs under Bun and reads `GREENROOM_API_TOKEN` /
 *   `GREENROOM_API_BASE_URL` from the environment.
 */

export interface AgentConnectionContext {
  /** Full MCP HTTP JSON-RPC endpoint, e.g. `http://127.0.0.1:49332/mcp`. */
  mcpHttpEndpoint: string;
  /** API origin the stdio server should call, e.g. `http://127.0.0.1:49331`. */
  apiBaseUrl: string;
  /** Minted plaintext token; the placeholder is used until one is minted. */
  token: string | null;
}

export const agentTokenPlaceholder = "<greenroom-api-token>";

/**
 * The stdio server runs from the Greenroom checkout; the browser cannot know
 * that path, so the snippet carries a placeholder the user must replace.
 */
export const mcpPackagePathPlaceholder = "/absolute/path/to/greenroom/packages/mcp";

/**
 * `claude mcp add` invocation for Claude Code, verified against the CLI:
 * `claude mcp add [options] <name> <commandOrUrl>` with `--transport http`
 * and `--header "Authorization: Bearer <token>"`.
 */
export function claudeMcpAddSnippet(context: AgentConnectionContext): string {
  return [
    "claude mcp add --transport http greenroom",
    context.mcpHttpEndpoint,
    `--header "Authorization: Bearer ${snippetToken(context)}"`,
  ].join(" ");
}

/** Generic stdio MCP server config (the common `mcpServers` JSON shape). */
export function stdioMcpConfigSnippet(context: AgentConnectionContext): string {
  return JSON.stringify(
    {
      mcpServers: {
        greenroom: {
          command: "bun",
          args: ["--cwd", mcpPackagePathPlaceholder, "src/stdio.ts"],
          env: {
            GREENROOM_API_BASE_URL: context.apiBaseUrl,
            GREENROOM_API_TOKEN: snippetToken(context),
          },
        },
      },
    },
    null,
    2,
  );
}

/** Streamable-HTTP MCP config for clients that support the `http` type. */
export function httpMcpConfigSnippet(context: AgentConnectionContext): string {
  return JSON.stringify(
    {
      mcpServers: {
        greenroom: {
          type: "http",
          url: context.mcpHttpEndpoint,
          headers: {
            Authorization: `Bearer ${snippetToken(context)}`,
          },
        },
      },
    },
    null,
    2,
  );
}

function snippetToken(context: AgentConnectionContext): string {
  const token = context.token?.trim();

  return token === undefined || token.length === 0 ? agentTokenPlaceholder : token;
}

/**
 * A real API origin for the stdio snippet: the supervised runtime's live API
 * URL when available, then the explicitly configured base URL, then the
 * page's own origin (the API serves the web bundle same-origin in
 * production).
 */
export function resolveAgentApiBaseUrl(input: {
  runtimeApiUrl: string | null;
  configuredBaseUrl: string | null;
  windowOrigin: string;
}): string {
  const base = input.runtimeApiUrl ?? input.configuredBaseUrl ?? input.windowOrigin;

  return base.replace(/\/+$/, "");
}
