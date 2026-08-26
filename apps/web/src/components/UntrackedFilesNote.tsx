import { docsUrl, untrackedFilesDocsPath } from "../docsLinks";

/**
 * Muted note surfacing that worktree reviews exclude untracked files.
 * Shown on the review creation page's default (worktree) flow and
 * under the workspace file tree for worktree reviews.
 */
export function UntrackedFilesNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      Untracked files are excluded from worktree reviews.{" "}
      <a
        className="underline decoration-line underline-offset-2 hover:text-ink"
        href={docsUrl(untrackedFilesDocsPath)}
        rel="noreferrer"
        target="_blank"
      >
        Why?
      </a>
    </p>
  );
}
