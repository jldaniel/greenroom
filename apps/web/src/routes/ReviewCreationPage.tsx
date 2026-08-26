import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  RefreshCw,
} from "lucide-react";

import type { RepositoryId } from "@greenroom/schemas";

import type { CommitQuery, CreateReviewRequest, ReviewPreviewResponse } from "../api/client";
import {
  useBaseCandidates,
  useCommits,
  useCreateReview,
  usePreviewReview,
  useRefs,
  useRepositories,
} from "../api/hooks";
import { DiffSummary } from "../components/DiffSummary";
import { DiffViewer } from "../components/DiffViewer";
import { ApiErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { FileTree } from "../components/FileTree";
import { UntrackedFilesNote } from "../components/UntrackedFilesNote";
import { useFileTreeModel } from "../components/useFileTreeModel";
import { compactSha } from "../utils";

type CreationMode = "default" | "custom" | "whole_repository";

export function ReviewCreationPage() {
  const repositories = useRepositories();
  const navigate = useNavigate();
  const [repositoryId, setRepositoryId] = useState<RepositoryId | "">("");
  const [mode, setMode] = useState<CreationMode>("default");
  const [title, setTitle] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("HEAD");
  const [commitSearch, setCommitSearch] = useState("");
  const [preview, setPreview] = useState<{ key: string; data: ReviewPreviewResponse } | null>(null);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);

  const selectedRepositoryId = repositoryId === "" ? null : repositoryId;
  const baseCandidates = useBaseCandidates(selectedRepositoryId);
  const refs = useRefs(selectedRepositoryId, "all");
  const commitQuery = useMemo<CommitQuery>(() => {
    const query: CommitQuery = { limit: 20 };
    const search = commitSearch.trim();

    if (search.length > 0) {
      query.search = search;
    }

    return query;
  }, [commitSearch]);
  const commits = useCommits(selectedRepositoryId, commitQuery);
  const previewReview = usePreviewReview();
  const createReview = useCreateReview();
  const currentInput = buildReviewInput({ repositoryId, mode, title, baseRef, headRef });
  const currentPreviewKey = currentInput === null ? null : stableInputKey(currentInput);
  const previewIsCurrent = preview !== null && preview.key === currentPreviewKey;
  const previewFiles = previewIsCurrent ? preview.data.files : [];
  const previewFileTree = useFileTreeModel(previewFiles, selectedPreviewPath);
  const selectedPreviewFile =
    previewFiles.find((file) => file.path === selectedPreviewPath) ?? previewFiles[0] ?? null;

  useEffect(() => {
    if (repositoryId !== "" || repositories.data === undefined || repositories.data.length === 0) {
      return;
    }

    const firstRepository = repositories.data[0];

    if (firstRepository !== undefined) {
      setRepositoryId(firstRepository.id);
    }
  }, [repositories.data, repositoryId]);

  useEffect(() => {
    if (previewFiles.length === 0) {
      setSelectedPreviewPath(null);
      return;
    }

    if (!previewFiles.some((file) => file.path === selectedPreviewPath)) {
      setSelectedPreviewPath(previewFiles[0]?.path ?? null);
    }
  }, [previewFiles, selectedPreviewPath]);

  const handlePreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (currentInput === null || currentPreviewKey === null) {
      return;
    }

    previewReview.mutate(currentInput, {
      onSuccess: (data) => setPreview({ key: currentPreviewKey, data }),
    });
  };

  const handleCreate = () => {
    if (currentInput === null || !previewIsCurrent) {
      return;
    }

    createReview.mutate(currentInput, {
      onSuccess: (created) => {
        void navigate({
          to: "/reviews/$reviewId",
          params: { reviewId: created.review.displayId },
        });
      },
    });
  };

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Create Review</h1>
        <p className="mt-1 text-sm text-muted">
          Default worktree reviews, custom committed refs, or whole repository reviews
        </p>
      </div>

      <form
        className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
        onSubmit={handlePreview}
      >
        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border border-line bg-surface p-4">
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-normal text-muted">
                Repository
              </span>
              <select
                className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                onChange={(event) => setRepositoryId(event.target.value as RepositoryId)}
                value={repositoryId}
              >
                <option value="">Select repository</option>
                {repositories.data?.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.displayName}
                  </option>
                ))}
              </select>
            </label>
            {repositories.isLoading ? (
              <div className="mt-4">
                <LoadingBlock label="Loading repositories" />
              </div>
            ) : null}
            {repositories.error === null ? null : (
              <div className="mt-4">
                <ApiErrorBanner error={repositories.error} />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted-surface p-1">
              <button
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${
                  mode === "default" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
                onClick={() => setMode("default")}
                type="button"
              >
                <GitBranch aria-hidden="true" className="size-4" />
                Default
              </button>
              <button
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${
                  mode === "custom" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
                onClick={() => setMode("custom")}
                type="button"
              >
                <GitCompareArrows aria-hidden="true" className="size-4" />
                Custom
              </button>
              <button
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${
                  mode === "whole_repository"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
                onClick={() => setMode("whole_repository")}
                type="button"
              >
                <BookOpen aria-hidden="true" className="size-4" />
                Whole repo
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-normal text-muted">
                  Title
                </span>
                <input
                  className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Optional"
                  value={title}
                />
              </label>

              {mode === "custom" ? (
                <>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-normal text-muted">
                      Base ref
                    </span>
                    <input
                      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                      list="greenroom-ref-options"
                      onChange={(event) => setBaseRef(event.target.value)}
                      placeholder="main"
                      value={baseRef}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-normal text-muted">
                      Head ref
                    </span>
                    <input
                      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                      list="greenroom-ref-options"
                      onChange={(event) => setHeadRef(event.target.value)}
                      placeholder="feature/review"
                      value={headRef}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-normal text-muted">
                      Commit search
                    </span>
                    <input
                      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                      onChange={(event) => setCommitSearch(event.target.value)}
                      placeholder="Subject or SHA"
                      value={commitSearch}
                    />
                  </label>
                </>
              ) : mode === "whole_repository" ? (
                <>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-normal text-muted">
                      Head ref
                    </span>
                    <input
                      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                      list="greenroom-ref-options"
                      onChange={(event) => setHeadRef(event.target.value)}
                      placeholder="HEAD"
                      value={headRef}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-normal text-muted">
                      Commit search
                    </span>
                    <input
                      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none ring-accent/30 transition focus:ring-4"
                      onChange={(event) => setCommitSearch(event.target.value)}
                      placeholder="Subject or SHA"
                      value={commitSearch}
                    />
                  </label>
                </>
              ) : (
                <div className="rounded-md border border-line bg-canvas px-3 py-2">
                  <span className="text-xs font-medium uppercase tracking-normal text-muted">
                    Head
                  </span>
                  <p className="mt-1 text-sm text-ink">
                    Current HEAD + staged/unstaged tracked changes
                  </p>
                  <UntrackedFilesNote className="mt-1" />
                </div>
              )}

              <datalist id="greenroom-ref-options">
                {refs.data?.map((ref) => (
                  <option key={ref.fullName} value={ref.name}>
                    {ref.kind}
                  </option>
                ))}
                {commits.data?.map((commit) => (
                  <option key={commit.sha} value={commit.sha}>
                    {commit.shortSha} {commit.subject}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitCommitHorizontal aria-hidden="true" className="size-4 text-accent-ink" />
              Base candidates
            </div>
            <p className="mt-1 text-xs text-muted">Click a candidate to use it as the base ref</p>
            <div className="mt-3 space-y-2">
              {baseCandidates.isLoading ? <p className="text-sm text-muted">Loading</p> : null}
              {baseCandidates.error === null ? null : (
                <ApiErrorBanner error={baseCandidates.error} />
              )}
              {baseCandidates.data !== undefined && baseCandidates.data.length === 0 ? (
                <p className="text-sm text-muted">None detected</p>
              ) : null}
              {baseCandidates.data?.map((candidate) => (
                <button
                  aria-label={`Use ${candidate.displayName} as base ref`}
                  className="min-w-0 w-full rounded-md border border-line bg-canvas px-3 py-2 text-left text-sm transition hover:border-accent/60 hover:bg-muted-surface"
                  key={candidate.sha}
                  onClick={() => {
                    // Filling the base ref implies a custom range; switch
                    // modes so the filled input is visible.
                    setMode("custom");
                    setBaseRef(candidate.displayName);
                  }}
                  type="button"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-words font-medium">{candidate.displayName}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {compactSha(candidate.sha)}
                    </span>
                  </span>
                  <span className="mt-1 block break-words text-xs text-muted">
                    {candidate.reason}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-muted-surface disabled:cursor-not-allowed disabled:text-muted"
              disabled={currentInput === null || previewReview.isPending}
              type="submit"
            >
              <RefreshCw
                aria-hidden="true"
                className={`size-4 ${previewReview.isPending ? "animate-spin" : ""}`}
              />
              Preview
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-surface transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-muted"
              disabled={currentInput === null || !previewIsCurrent || createReview.isPending}
              onClick={handleCreate}
              type="button"
            >
              Create
            </button>
          </div>
          {previewReview.error === null ? null : <ApiErrorBanner error={previewReview.error} />}
          {createReview.error === null ? null : <ApiErrorBanner error={createReview.error} />}
        </div>

        <div className="min-w-0 space-y-4">
          {!previewIsCurrent ? (
            <EmptyState
              title="No current preview"
              body="Preview the selected refs before creating the review."
            />
          ) : (
            <>
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-words font-medium">{preview.data.title}</h2>
                    <p className="mt-1 break-words text-sm text-muted">
                      {preview.data.baseRefDisplay}..{preview.data.headRefDisplay}
                    </p>
                  </div>
                  <div className="text-xs text-muted sm:text-right">
                    <p>Base {compactSha(preview.data.baseSha)}</p>
                    <p>Head {compactSha(preview.data.headSha)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <DiffSummary summary={preview.data.diffSummary} />
                </div>
              </div>

              {previewFiles.length === 0 ? (
                <EmptyState title="No changed files" />
              ) : (
                <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
                  <FileTree
                    model={previewFileTree}
                    onSelect={setSelectedPreviewPath}
                    selectedPath={selectedPreviewFile?.path ?? null}
                  />
                  <DiffViewer file={selectedPreviewFile} mode="unified" />
                </div>
              )}
            </>
          )}
        </div>
      </form>
    </section>
  );
}

function buildReviewInput(input: {
  repositoryId: RepositoryId | "";
  mode: CreationMode;
  title: string;
  baseRef: string;
  headRef: string;
}): CreateReviewRequest | null {
  if (input.repositoryId === "") {
    return null;
  }

  const title = input.title.trim();
  const headRef = input.headRef.trim();
  const result: CreateReviewRequest = {
    repositoryId: input.repositoryId,
  };

  if (title.length > 0) {
    result.title = title;
  }

  if (input.mode === "custom") {
    const baseRef = input.baseRef.trim();

    if (baseRef.length === 0 || headRef.length === 0) {
      return null;
    }

    result.baseRef = baseRef;
    result.headRef = headRef;
    return result;
  }

  if (input.mode === "whole_repository") {
    if (headRef.length === 0) {
      return null;
    }

    result.comparisonMode = "whole_repository";
    result.headRef = headRef;
    return result;
  }

  return result;
}

function stableInputKey(input: CreateReviewRequest): string {
  return JSON.stringify({
    repositoryId: input.repositoryId,
    title: input.title ?? "",
    baseRef: input.baseRef ?? "",
    headRef: input.headRef ?? "",
    kind: input.kind ?? "",
    comparisonMode: input.comparisonMode ?? "",
  });
}
