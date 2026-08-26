import {
  reviewRangeSchema,
  type ReviewRange,
  type ReviewRangeKind,
  type ReviewRefInput,
  type ReviewRefKind,
  type WorktreeFingerprint,
} from "@greenroom/schemas";

import { runGit, tryRunGit } from "./command";
import { emptyTreeSha, getWorktreeFingerprint } from "./diff";
import {
  getCurrentBranch,
  getUpstreamBranch,
  resolveGitRef,
  type GitRefKind,
  type ResolvedGitRef,
} from "./refs";

export type BaseCandidateReason =
  | "tracked_upstream"
  | "remote_head"
  | "remote_default_name"
  | "local_default_name"
  | "explicit_base";

export interface GitBaseCandidate {
  ref: string;
  sha: string;
  reason: BaseCandidateReason;
  displayName: string;
}

export interface MergeBaseResult {
  head: ResolvedGitRef;
  baseCandidate: GitBaseCandidate;
  mergeBaseSha: string;
}

export interface NormalizedReviewRange {
  range: ReviewRange;
  baseSha: string;
  headSha: string;
  baseRefDisplay: string;
  headRefDisplay: string;
  mergeBase: MergeBaseResult | null;
}

export interface NormalizedWorktreeReviewRange extends NormalizedReviewRange {
  worktreeFingerprint: WorktreeFingerprint;
}

export class GitRangeError extends Error {
  readonly code: "base_not_found" | "merge_base_not_found";

  constructor(code: "base_not_found" | "merge_base_not_found", message: string) {
    super(message);
    this.name = "GitRangeError";
    this.code = code;
  }
}

export async function detectDefaultBranchCandidates(
  repositoryPath: string,
  options: { timeoutMs?: number } = {},
): Promise<GitBaseCandidate[]> {
  const candidateRefs: Array<{ ref: string; reason: BaseCandidateReason }> = [];
  const currentBranch = await getCurrentBranch(repositoryPath, options);

  if (currentBranch !== null) {
    const upstream = await getUpstreamBranch(repositoryPath, currentBranch, options);

    if (upstream !== null) {
      candidateRefs.push({ ref: upstream, reason: "tracked_upstream" });
    }
  }

  const remoteHead = await readRemoteHead(repositoryPath, options);

  if (remoteHead !== null) {
    candidateRefs.push({ ref: remoteHead, reason: "remote_head" });
  }

  candidateRefs.push(
    { ref: "origin/main", reason: "remote_default_name" },
    { ref: "origin/master", reason: "remote_default_name" },
    { ref: "main", reason: "local_default_name" },
    { ref: "master", reason: "local_default_name" },
  );

  return resolveCandidates(repositoryPath, candidateRefs, options);
}

export async function detectMergeBase(
  repositoryPath: string,
  options: { timeoutMs?: number; headRef?: string; baseRef?: string } = {},
): Promise<MergeBaseResult> {
  const head = await resolveGitRef(repositoryPath, options.headRef ?? "HEAD", options);

  if (options.baseRef !== undefined) {
    const base = await resolveGitRef(repositoryPath, options.baseRef, options);
    const mergeBaseSha = await mergeBase(repositoryPath, base.sha, head.sha, options.timeoutMs);

    return {
      head,
      baseCandidate: {
        ref: options.baseRef,
        sha: base.sha,
        reason: "explicit_base",
        displayName: base.displayName,
      },
      mergeBaseSha,
    };
  }

  const candidates = await mergeBaseCandidatesForHead(repositoryPath, head, options);

  for (const candidate of candidates) {
    const result = await tryMergeBase(repositoryPath, candidate.sha, head.sha, options.timeoutMs);

    if (result !== null) {
      return {
        head,
        baseCandidate: candidate,
        mergeBaseSha: result,
      };
    }
  }

  throw new GitRangeError("base_not_found", "No upstream or default branch merge-base was found");
}

export async function constructDefaultReviewRange(
  repositoryPath: string,
  options: { timeoutMs?: number; headRef?: string } = {},
): Promise<NormalizedReviewRange> {
  const mergeBaseResult = await detectMergeBase(repositoryPath, options);
  const headRef = reviewRefInputFromResolved(mergeBaseResult.head);
  const baseDisplay = `merge-base(${mergeBaseResult.baseCandidate.displayName}, ${headRef.displayName ?? headRef.value})`;
  const range = reviewRangeSchema.parse({
    kind: "default_branch",
    baseRef: {
      kind: "commit",
      value: mergeBaseResult.mergeBaseSha,
      displayName: baseDisplay,
    },
    headRef,
  });

  return {
    range,
    baseSha: mergeBaseResult.mergeBaseSha,
    headSha: mergeBaseResult.head.sha,
    baseRefDisplay: baseDisplay,
    headRefDisplay: headRef.displayName ?? headRef.value,
    mergeBase: mergeBaseResult,
  };
}

export async function constructDefaultWorktreeReviewRange(
  repositoryPath: string,
  options: { timeoutMs?: number } = {},
): Promise<NormalizedWorktreeReviewRange> {
  const head = await resolveGitRef(repositoryPath, "HEAD", options);
  const mergeBaseResult = await detectWorktreeMergeBase(repositoryPath, options);
  const baseSha = mergeBaseResult?.mergeBaseSha ?? head.sha;
  const baseDisplay =
    mergeBaseResult === null
      ? `HEAD (${head.sha.slice(0, 7)})`
      : `merge-base(${mergeBaseResult.baseCandidate.displayName}, HEAD)`;
  const worktreeFingerprint = await getWorktreeFingerprint(repositoryPath, options);
  const headRef: ReviewRefInput = {
    kind: "worktree",
    value: "HEAD+worktree",
    displayName: "HEAD + worktree",
  };
  const range = reviewRangeSchema.parse({
    kind: "worktree",
    baseRef: {
      kind: "commit",
      value: baseSha,
      displayName: baseDisplay,
    },
    headRef,
  });

  return {
    range,
    baseSha,
    headSha: worktreeFingerprint.headSha,
    baseRefDisplay: baseDisplay,
    headRefDisplay: headRef.displayName ?? headRef.value,
    mergeBase: mergeBaseResult,
    worktreeFingerprint,
  };
}

export async function constructReviewRange(
  repositoryPath: string,
  input: {
    baseRef: string;
    headRef: string;
    kind?: ReviewRangeKind;
    timeoutMs?: number;
  },
): Promise<NormalizedReviewRange> {
  const base = await resolveGitRef(repositoryPath, input.baseRef, input);
  const head = await resolveGitRef(repositoryPath, input.headRef, input);
  const kind =
    input.kind ?? (await inferReviewRangeKind(repositoryPath, base, head, input.timeoutMs));
  const range = reviewRangeSchema.parse({
    kind,
    baseRef: reviewRefInputFromResolved(base),
    headRef: reviewRefInputFromResolved(head),
  });

  return {
    range,
    baseSha: base.sha,
    headSha: head.sha,
    baseRefDisplay: range.baseRef.displayName ?? range.baseRef.value,
    headRefDisplay: range.headRef.displayName ?? range.headRef.value,
    mergeBase: null,
  };
}

export async function constructWholeRepositoryReviewRange(
  repositoryPath: string,
  input: { headRef: string; timeoutMs?: number },
): Promise<NormalizedReviewRange> {
  const head = await resolveGitRef(repositoryPath, input.headRef, input);
  const headRef: ReviewRefInput =
    input.headRef === "HEAD"
      ? {
          kind: "ref",
          value: "HEAD",
          displayName: "HEAD",
        }
      : reviewRefInputFromResolved(head);
  const baseRef: ReviewRefInput = {
    kind: "empty_tree",
    value: emptyTreeSha,
    displayName: "empty repository",
  };
  const range = reviewRangeSchema.parse({
    kind: "whole_repository",
    baseRef,
    headRef,
  });

  return {
    range,
    baseSha: emptyTreeSha,
    headSha: head.sha,
    baseRefDisplay: baseRef.displayName ?? baseRef.value,
    headRefDisplay: headRef.displayName ?? headRef.value,
    mergeBase: null,
  };
}

async function detectWorktreeMergeBase(
  repositoryPath: string,
  options: { timeoutMs?: number },
): Promise<MergeBaseResult | null> {
  try {
    return await detectMergeBase(repositoryPath, { ...options, headRef: "HEAD" });
  } catch (error) {
    if (error instanceof GitRangeError && error.code === "base_not_found") {
      return null;
    }

    throw error;
  }
}

async function mergeBaseCandidatesForHead(
  repositoryPath: string,
  head: ResolvedGitRef,
  options: { timeoutMs?: number },
): Promise<GitBaseCandidate[]> {
  const candidateRefs: Array<{ ref: string; reason: BaseCandidateReason }> = [];

  if (head.kind === "branch") {
    const upstream = await getUpstreamBranch(repositoryPath, head.displayName, options);

    if (upstream !== null) {
      candidateRefs.push({ ref: upstream, reason: "tracked_upstream" });
    }
  }

  const defaultCandidates = await detectDefaultBranchCandidates(repositoryPath, options);
  const headFilteredDefaults = defaultCandidates.filter((candidate) => candidate.sha !== head.sha);
  const explicitCandidates = await resolveCandidates(repositoryPath, candidateRefs, options);

  return uniqueCandidates([...explicitCandidates, ...headFilteredDefaults]);
}

async function resolveCandidates(
  repositoryPath: string,
  candidateRefs: readonly { ref: string; reason: BaseCandidateReason }[],
  options: { timeoutMs?: number },
): Promise<GitBaseCandidate[]> {
  const candidates: GitBaseCandidate[] = [];

  for (const candidate of candidateRefs) {
    try {
      const resolved = await resolveGitRef(repositoryPath, candidate.ref, options);
      candidates.push({
        ref: candidate.ref,
        sha: resolved.sha,
        reason: candidate.reason,
        displayName: resolved.displayName,
      });
    } catch {
      // Candidate detection is best-effort and must stay offline.
    }
  }

  return uniqueCandidates(candidates);
}

async function readRemoteHead(
  repositoryPath: string,
  options: { timeoutMs?: number },
): Promise<string | null> {
  const result = await tryRunGit({
    repositoryPath,
    args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    timeoutMs: options.timeoutMs,
  });

  return result === null ? null : result.stdout.trim();
}

async function inferReviewRangeKind(
  repositoryPath: string,
  base: ResolvedGitRef,
  head: ResolvedGitRef,
  timeoutMs: number | undefined,
): Promise<ReviewRangeKind> {
  if (base.kind === "branch" && head.kind === "branch") {
    return "branch_to_branch";
  }

  if (
    base.kind === "tag" ||
    head.kind === "tag" ||
    base.kind === "remote" ||
    head.kind === "remote"
  ) {
    return "tag_or_ref";
  }

  if (base.kind === "commit" && head.kind === "commit") {
    const ancestor = await isAncestor(repositoryPath, base.sha, head.sha, timeoutMs);
    return ancestor ? "same_branch_slice" : "commit_to_commit";
  }

  return "custom";
}

async function isAncestor(
  repositoryPath: string,
  baseSha: string,
  headSha: string,
  timeoutMs: number | undefined,
): Promise<boolean> {
  const result = await runGit({
    repositoryPath,
    args: ["merge-base", "--is-ancestor", baseSha, headSha],
    timeoutMs,
    expectedExitCodes: [0, 1],
  });

  return result.exitCode === 0;
}

async function mergeBase(
  repositoryPath: string,
  baseSha: string,
  headSha: string,
  timeoutMs: number | undefined,
): Promise<string> {
  const result = await tryMergeBase(repositoryPath, baseSha, headSha, timeoutMs);

  if (result === null) {
    throw new GitRangeError(
      "merge_base_not_found",
      `No merge-base was found between ${baseSha} and ${headSha}`,
    );
  }

  return result;
}

async function tryMergeBase(
  repositoryPath: string,
  baseSha: string,
  headSha: string,
  timeoutMs: number | undefined,
): Promise<string | null> {
  const result = await tryRunGit({
    repositoryPath,
    args: ["merge-base", baseSha, headSha],
    timeoutMs,
  });

  return result === null ? null : result.stdout.trim();
}

function reviewRefInputFromResolved(resolved: ResolvedGitRef): ReviewRefInput {
  const value = resolved.input === "HEAD" ? resolved.sha : resolved.input;
  const input: ReviewRefInput = {
    kind: reviewRefKindFromGitKind(resolved.kind),
    value,
  };

  if (resolved.displayName !== value) {
    input.displayName = resolved.displayName;
  }

  return input;
}

function reviewRefKindFromGitKind(kind: GitRefKind): ReviewRefKind {
  if (kind === "branch" || kind === "tag" || kind === "commit") {
    return kind;
  }

  return "ref";
}

function uniqueCandidates(candidates: readonly GitBaseCandidate[]): GitBaseCandidate[] {
  const seen = new Set<string>();
  const unique: GitBaseCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.ref}\0${candidate.sha}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  return unique;
}
