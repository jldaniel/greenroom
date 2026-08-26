/**
 * Links into the repository docs. The public GitHub repository is the
 * distribution channel; this base is kept in one place so every in-app
 * documentation link resolves against the same repository.
 */
const docsRepositoryBaseUrl = "https://github.com/jldaniel/greenroom/blob/main";

export function docsUrl(pathWithAnchor: string): string {
  return `${docsRepositoryBaseUrl}/${pathWithAnchor}`;
}

/** Worktree review untracked-file exclusion rationale. */
export const untrackedFilesDocsPath = "docs/Git.md#untracked-files";
