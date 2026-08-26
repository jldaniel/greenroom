import { type FormEvent, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, FolderGit2, GitPullRequestArrow, LoaderCircle, Plus } from "lucide-react";

import type { Repository } from "@greenroom/schemas";

import {
  useCreateReview,
  usePreviewReview,
  useRegisterRepository,
  useRepositories,
} from "../api/hooks";
import { formatDateTime } from "../utils";
import { ApiErrorBanner, EmptyState, LoadingBlock } from "./Feedback";
import {
  deriveQuickReviewNoChanges,
  describeQuickReviewError,
  type QuickReviewNotice,
} from "./repositoryRegistryUtils";

export function RepositoryRegistryPanel() {
  const repositories = useRepositories();
  const registerRepository = useRegisterRepository();
  const [rootPath, setRootPath] = useState("");
  const [displayName, setDisplayName] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedRoot = rootPath.trim();
    const trimmedName = displayName.trim();

    if (trimmedRoot.length === 0) {
      return;
    }

    registerRepository.mutate(
      {
        rootPath: trimmedRoot,
        ...(trimmedName.length > 0 ? { displayName: trimmedName } : {}),
      },
      {
        onSuccess: () => {
          setRootPath("");
          setDisplayName("");
        },
      },
    );
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Repositories</h1>
        <p className="mt-1 text-sm text-muted">Registered local Git worktrees</p>
      </div>

      <form className="rounded-lg border border-line bg-surface p-4" onSubmit={handleSubmit}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-normal text-muted">
              Root path
            </span>
            <input
              className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="/Users/you/code/project"
              value={rootPath}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-normal text-muted">Name</span>
            <input
              className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
              value={displayName}
            />
          </label>
          <button
            className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-surface transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-muted"
            disabled={registerRepository.isPending || rootPath.trim().length === 0}
            type="submit"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add
          </button>
        </div>
        {registerRepository.error === null ? null : (
          <div className="mt-4">
            <ApiErrorBanner error={registerRepository.error} />
          </div>
        )}
      </form>

      {repositories.isLoading ? <LoadingBlock label="Loading repositories" /> : null}
      {repositories.error === null ? null : <ApiErrorBanner error={repositories.error} />}
      {repositories.data !== undefined && repositories.data.length === 0 ? (
        <EmptyState title="No repositories" body="Add an absolute local worktree path." />
      ) : null}
      {repositories.data === undefined || repositories.data.length === 0 ? null : (
        <div className="grid gap-3">
          {repositories.data.map((repository) => (
            <RepositoryRow key={repository.id} repository={repository} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One-click default review from the Dashboard: the row action
 * previews the default worktree review (the server detects the base ref from
 * upstream/default-branch candidates), skips creation when there are no
 * changes, and otherwise creates the review and jumps to its workspace.
 * Custom ranges stay on the Create Review page.
 */
function RepositoryRow({ repository }: { repository: Repository }) {
  const navigate = useNavigate();
  const previewReview = usePreviewReview();
  const createReview = useCreateReview();
  const [notice, setNotice] = useState<{ notice: QuickReviewNotice; error: unknown } | null>(null);
  const isPending = previewReview.isPending || createReview.isPending;

  const handleQuickReview = () => {
    setNotice(null);

    previewReview.mutate(
      { repositoryId: repository.id },
      {
        onSuccess: (preview) => {
          const noChanges = deriveQuickReviewNoChanges(preview);

          if (noChanges !== null) {
            setNotice({ notice: noChanges, error: null });
            return;
          }

          createReview.mutate(
            { repositoryId: repository.id },
            {
              onSuccess: (created) => {
                void navigate({
                  to: "/reviews/$reviewId",
                  params: { reviewId: created.review.displayId },
                });
              },
              onError: (error) => setNotice({ notice: describeQuickReviewError(error), error }),
            },
          );
        },
        onError: (error) => setNotice({ notice: describeQuickReviewError(error), error }),
      },
    );
  };

  return (
    <article className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderGit2 aria-hidden="true" className="size-4 text-accent-ink" />
            <h2 className="truncate font-medium">{repository.displayName}</h2>
          </div>
          <p className="mt-1 truncate text-sm text-muted">{repository.rootPath}</p>
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1 text-xs text-muted sm:text-right">
          <dt>Default</dt>
          <dd className="min-w-0 break-words text-ink">
            {repository.defaultBranchCandidate ?? "None"}
          </dd>
          <dt>Updated</dt>
          <dd className="text-ink">{formatDateTime(repository.updatedAt)}</dd>
        </dl>
      </div>
      <div className="mt-3">
        <button
          aria-label={`Review current changes in ${repository.displayName}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-muted-surface disabled:cursor-not-allowed disabled:text-muted"
          disabled={isPending}
          onClick={handleQuickReview}
          type="button"
        >
          {isPending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <GitPullRequestArrow aria-hidden="true" className="size-4" />
          )}
          Review current changes
        </button>
      </div>
      {notice === null ? null : (
        <div className="mt-3">
          <QuickReviewRowNotice error={notice.error} notice={notice.notice} />
        </div>
      )}
    </article>
  );
}

function QuickReviewRowNotice({ notice, error }: { notice: QuickReviewNotice; error: unknown }) {
  if (notice.kind === "auth") {
    // Central 401 handling: keep the connect/reconnect prompt
    // instead of flattening auth failures to a sentence.
    return <ApiErrorBanner error={error} />;
  }

  if (notice.kind === "no_changes") {
    return (
      <p
        className="break-words rounded-md border border-line bg-muted-surface px-3 py-2 text-sm text-muted"
        role="status"
      >
        {notice.message}
      </p>
    );
  }

  return (
    <p
      className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger-ink"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{notice.message}</span>
    </p>
  );
}
