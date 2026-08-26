import { useState } from "react";
import { Bot, Check, Clipboard, KeyRound, LoaderCircle } from "lucide-react";

import type { CapabilityScope } from "@greenroom/schemas";

import { useCreateToken } from "../../api/hooks";
import { ApiErrorBanner } from "../../components/Feedback";
import {
  claudeMcpAddSnippet,
  httpMcpConfigSnippet,
  mcpPackagePathPlaceholder,
  stdioMcpConfigSnippet,
  type AgentConnectionContext,
} from "./connectAgentUtils";
import { scopeOptions } from "./TokensSettings";

/**
 * "Connect a coding agent" card: mints a scoped capability token
 * inline and renders copy-paste MCP configuration for Claude Code
 * (`claude mcp add ...`), generic stdio JSON, and streamable HTTP, pre-filled
 * with the minted token and the real MCP endpoint.
 */
export function ConnectAgentCard({
  apiBaseUrl,
  enabled,
  mcpHttpEndpoint,
}: {
  apiBaseUrl: string;
  enabled: boolean;
  mcpHttpEndpoint: string;
}) {
  const createToken = useCreateToken();
  const [tokenName, setTokenName] = useState("Coding agent");
  const [selectedScopes, setSelectedScopes] = useState<CapabilityScope[]>([
    "read",
    "comment:write",
  ]);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const context: AgentConnectionContext = { mcpHttpEndpoint, apiBaseUrl, token: mintedToken };
  const isMintDisabled =
    !enabled ||
    createToken.isPending ||
    tokenName.trim().length === 0 ||
    selectedScopes.length === 0;

  async function handleMintToken() {
    try {
      const created = await createToken.mutateAsync({
        name: tokenName.trim(),
        scopes: selectedScopes,
      });
      setMintedToken(created.plaintextToken);
    } catch {
      // The mutation error is rendered below the mint button.
    }
  }

  function toggleScope(scope: CapabilityScope) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : [...current, scope],
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Bot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-normal">Connect a coding agent</h2>
          <p className="mt-1 text-sm text-muted">
            Mint a scoped token, then paste one of the configs below into your MCP client. The token
            is embedded in the snippets and shown only until you leave this page.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)_auto] md:items-end">
        <label className="block">
          <span className="text-xs font-medium uppercase text-muted">Token name</span>
          <input
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <fieldset>
          <legend className="text-xs font-medium uppercase text-muted">Scopes</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {scopeOptions.map((scope) => (
              <label
                key={scope.value}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-muted-surface px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                  className="size-4"
                />
                <span>{scope.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={() => void handleMintToken()}
          disabled={isMintDisabled}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
        >
          {createToken.isPending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" className="size-4" />
          )}
          Mint token
        </button>
      </div>

      {createToken.error === null ? null : (
        <div className="mt-3">
          <ApiErrorBanner error={createToken.error} />
        </div>
      )}

      {mintedToken === null ? (
        <p className="mt-3 rounded-lg border border-line bg-muted-surface px-3 py-2 text-sm text-muted">
          No token minted yet; the snippets below carry a placeholder instead.
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          Token minted and filled into the snippets below. It is shown once; copy a snippet now. The
          token can be revoked any time from the Tokens section.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <SnippetBlock
          label="Claude Code"
          description="Registers the HTTP MCP endpoint with the claude CLI."
          snippet={claudeMcpAddSnippet(context)}
        />
        <SnippetBlock
          label="Generic stdio MCP server"
          description={`For clients that spawn stdio servers. Replace ${mcpPackagePathPlaceholder} with your Greenroom checkout.`}
          snippet={stdioMcpConfigSnippet(context)}
        />
        <SnippetBlock
          label="Streamable HTTP MCP"
          description="For clients that support HTTP MCP server entries."
          snippet={httpMcpConfigSnippet(context)}
        />
      </div>
    </section>
  );
}

function SnippetBlock({
  description,
  label,
  snippet,
}: {
  description: string;
  label: string;
  snippet: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted">{label}</p>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        <CopySnippetButton snippet={snippet} snippetLabel={label} />
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted-surface px-3 py-2 font-mono text-xs text-ink">
        {snippet}
      </pre>
    </div>
  );
}

function CopySnippetButton({ snippet, snippetLabel }: { snippet: string; snippetLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied; the snippet stays selectable as text.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={`Copy ${snippetLabel} configuration`}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-4 text-success-ink" />
      ) : (
        <Clipboard aria-hidden="true" className="size-4" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
