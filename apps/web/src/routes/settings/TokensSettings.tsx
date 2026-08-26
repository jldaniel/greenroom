import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { CapabilityScope, CapabilityTokenPublic } from "@greenroom/schemas";

import type { GreenroomApiTokenStatus } from "../../api/client";
import { useCreateToken, useRevokeToken, useTokens } from "../../api/hooks";
import { ApiErrorBanner, EmptyState, LoadingBlock } from "../../components/Feedback";
import { PlaintextTokenNotice } from "./settingsShared";
import { formatTimestamp } from "./settingsUtils";

export const scopeOptions: Array<{ value: CapabilityScope; label: string }> = [
  { value: "read", label: "Read" },
  { value: "comment:write", label: "Comment" },
  { value: "thread:resolve", label: "Resolve" },
  { value: "review:write", label: "Review" },
  { value: "admin", label: "Admin" },
];

/**
 * Tokens section: create scoped capability tokens and manage the
 * existing ones. Browser-token connection lives in Connections.
 */
export function TokensSettings({ tokenStatus }: { tokenStatus: GreenroomApiTokenStatus }) {
  const enabled = tokenStatus.source !== "missing";
  const [createdPlaintextToken, setCreatedPlaintextToken] = useState<string | null>(null);
  const [createTokenName, setCreateTokenName] = useState("MCP reviewer");
  const [selectedScopes, setSelectedScopes] = useState<CapabilityScope[]>([
    "read",
    "comment:write",
  ]);
  const tokens = useTokens(enabled);
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();
  const activeTokenCount = useMemo(
    () => tokens.data?.filter((token) => token.revokedAt === null).length ?? 0,
    [tokens.data],
  );
  const isCreateDisabled =
    createTokenName.trim().length === 0 || selectedScopes.length === 0 || createToken.isPending;

  async function handleCreateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await createToken.mutateAsync({
      name: createTokenName.trim(),
      scopes: selectedScopes,
    });

    setCreatedPlaintextToken(created.plaintextToken);
    setCreateTokenName("MCP reviewer");
    setSelectedScopes(["read", "comment:write"]);
  }

  function toggleScope(scope: CapabilityScope) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : [...current, scope],
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Capability tokens</h2>
            <p className="text-sm text-muted">{activeTokenCount} active</p>
          </div>

          {createdPlaintextToken === null ? null : (
            <PlaintextTokenNotice
              token={createdPlaintextToken}
              onDismiss={() => setCreatedPlaintextToken(null)}
            />
          )}

          {tokens.isLoading ? <LoadingBlock label="Loading tokens" /> : null}
          {tokens.error === null ? null : <ApiErrorBanner error={tokens.error} />}
          {revokeToken.error === null ? null : <ApiErrorBanner error={revokeToken.error} />}
          {tokens.data !== undefined && tokens.data.length === 0 ? (
            <EmptyState title="No tokens" body="Create a scoped token for a local tool." />
          ) : null}
          {tokens.data === undefined || tokens.data.length === 0 ? null : (
            <div className="grid gap-3 md:grid-cols-2">
              {tokens.data.map((token) => (
                <TokenCard
                  key={token.id}
                  token={token}
                  onRevoke={() => revokeToken.mutate(token.id)}
                  isRevoking={revokeToken.isPending}
                />
              ))}
            </div>
          )}
        </section>

        <section className="h-fit rounded-lg border border-line bg-surface p-4">
          <div className="mb-4 flex items-center gap-2">
            <Plus aria-hidden="true" className="size-4 text-accent-ink" />
            <h2 className="text-sm font-semibold tracking-normal">Create token</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleCreateToken(event)}>
            <label className="block">
              <span className="text-xs font-medium uppercase text-muted">Name</span>
              <input
                value={createTokenName}
                onChange={(event) => setCreateTokenName(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase text-muted">Scopes</legend>
              <div className="grid grid-cols-2 gap-2">
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
              type="submit"
              disabled={isCreateDisabled || !enabled}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="size-4" />
              Create
            </button>
            {createToken.error === null ? null : <ApiErrorBanner error={createToken.error} />}
          </form>
        </section>
      </div>
    </div>
  );
}

function TokenCard({
  token,
  onRevoke,
  isRevoking,
}: {
  token: CapabilityTokenPublic;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const isRevoked = token.revokedAt !== null;

  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{token.name}</p>
          <p className="mt-1 truncate font-mono text-xs text-muted">{token.id}</p>
        </div>
        <span
          className={
            isRevoked
              ? "rounded-md bg-muted-surface px-2 py-1 text-xs font-medium text-muted"
              : "rounded-md bg-success-soft px-2 py-1 text-xs font-medium text-success-ink"
          }
        >
          {isRevoked ? "Revoked" : "Active"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {token.scopes.map((scope) => (
          <span
            key={scope}
            className="rounded-md border border-line bg-muted-surface px-2 py-1 text-xs text-ink"
          >
            {scope}
          </span>
        ))}
      </div>

      <dl className="mt-4 grid gap-2 text-xs text-muted">
        <div className="flex justify-between gap-3">
          <dt>Created</dt>
          <dd className="font-mono">{formatTimestamp(token.createdAt)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Last used</dt>
          <dd className="font-mono">{formatTimestamp(token.lastUsedAt)}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onRevoke}
        disabled={isRevoked || isRevoking}
        className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-danger/30 bg-surface px-3 text-sm font-medium text-danger-ink hover:bg-danger-soft disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        Revoke
      </button>
    </article>
  );
}
