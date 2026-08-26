import { runGit, tryRunGit } from "./command";

export type GitRefKind = "branch" | "tag" | "remote" | "ref" | "commit";

export interface GitRefListing {
  kind: Exclude<GitRefKind, "commit">;
  name: string;
  fullName: string;
  sha: string;
  objectType: string;
  lastCommitAt: string | null;
}

export interface ResolvedGitRef {
  input: string;
  kind: GitRefKind;
  sha: string;
  displayName: string;
  matchedRef: GitRefListing | null;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
}

export type GitRefResolutionErrorCode = "ref_not_found" | "ref_not_commit";

export class GitRefResolutionError extends Error {
  readonly code: GitRefResolutionErrorCode;
  readonly ref: string;

  constructor(code: GitRefResolutionErrorCode, ref: string, message: string) {
    super(message);
    this.name = "GitRefResolutionError";
    this.code = code;
    this.ref = ref;
  }
}

const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const REF_FORMAT = [
  "%(refname)",
  "%(refname:short)",
  "%(objectname)",
  "%(objecttype)",
  "%(committerdate:iso-strict)",
].join("%1f");
const COMMIT_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join("%x1f");

export async function listBranches(
  repositoryPath: string,
  options: { timeoutMs?: number } = {},
): Promise<GitRefListing[]> {
  return listRefs(repositoryPath, { ...options, prefixes: ["refs/heads"] });
}

export async function listTags(
  repositoryPath: string,
  options: { timeoutMs?: number } = {},
): Promise<GitRefListing[]> {
  return listRefs(repositoryPath, { ...options, prefixes: ["refs/tags"] });
}

export async function listRefs(
  repositoryPath: string,
  options: { timeoutMs?: number; prefixes?: readonly string[] } = {},
): Promise<GitRefListing[]> {
  const prefixes = options.prefixes ?? ["refs/heads", "refs/tags", "refs/remotes"];
  const result = await runGit({
    repositoryPath,
    args: ["for-each-ref", `--format=${REF_FORMAT}%1e`, ...prefixes],
    timeoutMs: options.timeoutMs,
  });

  return result.stdout
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map(parseRefRecord)
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function getCurrentBranch(
  repositoryPath: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const result = await runGit({
    repositoryPath,
    args: ["branch", "--show-current"],
    timeoutMs: options.timeoutMs,
  });
  const branch = result.stdout.trim();
  return branch.length === 0 ? null : branch;
}

export async function getUpstreamBranch(
  repositoryPath: string,
  branchName?: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const upstreamExpression = branchName === undefined ? "@{upstream}" : `${branchName}@{upstream}`;
  const result = await tryRunGit({
    repositoryPath,
    args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", upstreamExpression],
    timeoutMs: options.timeoutMs,
  });

  return result === null ? null : result.stdout.trim();
}

export async function resolveGitRef(
  repositoryPath: string,
  ref: string,
  options: { timeoutMs?: number } = {},
): Promise<ResolvedGitRef> {
  const result = await tryRunGit({
    repositoryPath,
    args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
    timeoutMs: options.timeoutMs,
  });

  if (result === null) {
    throw new GitRefResolutionError("ref_not_found", ref, `Git ref could not be resolved: ${ref}`);
  }

  const sha = result.stdout.trim();

  if (sha.length === 0) {
    throw new GitRefResolutionError("ref_not_commit", ref, `Git ref is not a commit: ${ref}`);
  }

  const refs = await listRefs(repositoryPath, options);
  const matchedRef = findMatchingRef(ref, sha, refs);
  const isCommitInput = isHexPrefix(ref);
  const kind = isCommitInput ? "commit" : (matchedRef?.kind ?? "ref");

  return {
    input: ref,
    kind,
    sha,
    displayName: isCommitInput ? ref : (matchedRef?.name ?? ref),
    matchedRef: matchedRef ?? null,
  };
}

export async function lookupCommit(
  repositoryPath: string,
  ref: string,
  options: { timeoutMs?: number } = {},
): Promise<GitCommit> {
  const resolved = await resolveGitRef(repositoryPath, ref, options);
  const result = await runGit({
    repositoryPath,
    args: ["show", "--no-patch", `--format=${COMMIT_FORMAT}`, resolved.sha],
    timeoutMs: options.timeoutMs,
  });

  return parseCommitRecord(result.stdout.trim());
}

export async function listCommits(
  repositoryPath: string,
  options: {
    timeoutMs?: number;
    baseRef?: string;
    headRef?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<GitCommit[]> {
  const limit = normalizedLimit(options.limit);
  const args = ["log", `--format=${COMMIT_FORMAT}`, `--max-count=${limit}`];

  if (options.search !== undefined && options.search.trim().length > 0) {
    args.push("--regexp-ignore-case", `--grep=${options.search.trim()}`);
  }

  if (options.baseRef !== undefined && options.headRef !== undefined) {
    const base = await resolveGitRef(repositoryPath, options.baseRef, options);
    const head = await resolveGitRef(repositoryPath, options.headRef, options);
    args.push(`${base.sha}..${head.sha}`);
  } else {
    args.push("--all");
  }

  const result = await runGit({ repositoryPath, args, timeoutMs: options.timeoutMs });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCommitRecord);
}

export async function searchCommits(
  repositoryPath: string,
  query: string,
  options: { timeoutMs?: number; limit?: number } = {},
): Promise<GitCommit[]> {
  const limit = normalizedLimit(options.limit);
  const commits = await listCommits(repositoryPath, {
    ...options,
    search: query,
    limit,
  });
  const results = new Map(commits.map((commit) => [commit.sha, commit]));

  if (isHexPrefix(query)) {
    try {
      const commit = await lookupCommit(repositoryPath, query, options);
      results.set(commit.sha, commit);
    } catch (error) {
      if (!(error instanceof GitRefResolutionError)) {
        throw error;
      }
    }
  }

  return [...results.values()].slice(0, limit);
}

function parseRefRecord(record: string): GitRefListing {
  const fields = record.split(FIELD_SEPARATOR);
  const [fullName, name, sha, objectType, rawLastCommitAt] = fields;

  if (
    fullName === undefined ||
    name === undefined ||
    sha === undefined ||
    objectType === undefined ||
    rawLastCommitAt === undefined
  ) {
    throw new Error(`Unable to parse Git ref record: ${record}`);
  }

  return {
    kind: refKindFromName(fullName),
    name,
    fullName,
    sha,
    objectType,
    lastCommitAt: rawLastCommitAt.length === 0 ? null : rawLastCommitAt,
  };
}

function parseCommitRecord(record: string): GitCommit {
  const fields = record.split(FIELD_SEPARATOR);
  const [sha, shortSha, authorName, authorEmail, authorDate, subject] = fields;

  if (
    sha === undefined ||
    shortSha === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    authorDate === undefined ||
    subject === undefined
  ) {
    throw new Error(`Unable to parse Git commit record: ${record}`);
  }

  return {
    sha,
    shortSha,
    authorName,
    authorEmail,
    authorDate,
    subject,
  };
}

function refKindFromName(fullName: string): Exclude<GitRefKind, "commit"> {
  if (fullName.startsWith("refs/heads/")) {
    return "branch";
  }

  if (fullName.startsWith("refs/tags/")) {
    return "tag";
  }

  if (fullName.startsWith("refs/remotes/")) {
    return "remote";
  }

  return "ref";
}

function findMatchingRef(
  input: string,
  sha: string,
  refs: readonly GitRefListing[],
): GitRefListing | undefined {
  return refs.find(
    (ref) =>
      ref.fullName === input ||
      ref.name === input ||
      (ref.sha === sha && (input === ref.sha || input === ref.sha.slice(0, input.length))),
  );
}

function isHexPrefix(value: string): boolean {
  return /^[0-9a-f]{4,64}$/iu.test(value);
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Commit search limits must be an integer between 1 and 500");
  }

  return limit;
}
