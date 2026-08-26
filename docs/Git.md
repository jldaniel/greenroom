# Git And Diff Behavior

Greenroom's Git package is local-only. It shells out to the Git CLI with an
argument array through `Bun.spawn`; it does not interpolate user input through a
shell and every command receives an explicit repository path through `git -C`.

## Repository Identity

Repository detection requires an absolute path inside a Git worktree. Detection
records:

- the canonical worktree root
- the canonical Git common directory
- an identity key equal to the common directory

The common directory is used so linked worktrees and normal worktrees have a
stable local identity without writing to the reviewed repository.

## Ref And Commit Support

Supported committed review inputs are local branches, tags, remote-tracking refs
already present in the local repository, full SHAs, abbreviated SHAs, and other
resolvable local refs. The package resolves review inputs to commit SHAs before
diff generation so revision snapshots can store stable endpoints.

Commit search is offline and uses local `git log` data. It supports message grep
queries and direct SHA/abbreviated SHA lookup.

## Base Detection

Default base detection is best-effort and never fetches from a network remote.
The priority order is:

1. the current or selected branch's configured upstream, if present
2. `origin/HEAD`, if the local remote-tracking symbolic ref exists
3. local remote-tracking `origin/main` or `origin/master`
4. local `main` or `master`

Greenroom computes the merge-base between the selected head and the first
candidate with a valid merge-base. Users can override the base through the
custom review creation flow.

## Diff Generation

Committed diffs are generated with local `git diff --patch`, rename/copy
detection, no color, no external diff drivers, and resolved commit SHAs. The
parser returns structured files, hunks, and lines for:

- added, deleted, and modified text files
- mode-only changes
- renames with old/new path metadata and similarity when Git reports it
- binary file markers without rendering binary contents
- no-newline markers

Diff summaries are derived from the structured diff: file count, additions,
deletions, binary count, and rename count.

## Worktree Reviews

Default review creation is worktree-aware. Greenroom records:

- the current `HEAD` SHA
- a staged diff hash from `git diff --cached HEAD`
- an unstaged tracked-file diff hash from `git diff`

The review diff itself is generated as `git diff <base>`, where `<base>` is the
detected default merge-base or, when no candidate exists because the checkout is
already on the default branch, the current `HEAD`. This produces one structured
snapshot containing committed changes since the base plus staged and unstaged
tracked-file changes.

### Untracked Files

Untracked files are excluded from worktree reviews. The worktree snapshot is
built from `git diff` output, which only sees tracked content: Greenroom does
not run `git add`, does not write index state,
and does not create commits or branches in reviewed repositories. A brand-new
file therefore does not appear in the diff, the file tree, or AI run context
until it is staged or committed.

This stays deliberate for now because including untracked files would require
an explicit policy for file discovery, binary/size limits, and ignore handling
without mutating the reviewed repository. The exclusion is surfaced in the
review creation page and the workspace file tree. To review a new file today,
`git add` it and refresh the review.

Refresh compares the stored revision endpoint/fingerprint against the current
repository state. If it changed, Greenroom stores a new revision and remaps
thread anchors using path/rename metadata, line text similarity, nearby context,
and line-number proximity. Low-confidence matches remain visible as outdated
threads anchored to their original revision context.

## Whole Repository Reviews

Whole repository reviews compare a selected committed head against Git's stable
empty tree object:

```text
4b825dc642cb6eb9a060e54bf8d69288fbee4904
```

Greenroom uses `git diff <empty-tree> <head-sha> --`, so every tracked file at
the selected committed head is represented as an added file. This mode does not
include untracked, ignored, staged-only, or unstaged worktree changes. It also
does not create temporary repositories, branches, commits, refs, or index state
in the reviewed repository.

Refresh resolves the stored head ref again and compares the new head commit
against the same empty tree object. If the ref moved, Greenroom stores a new
revision and uses the existing anchor remapping machinery.

## Known Limits

- The parser targets standard Git patch output. Extremely unusual path quoting
  is handled for common quoted paths, but exhaustive C-style escape decoding is
  not currently supported.
- Default branch detection only uses refs already present locally. It never
  fetches, updates remotes, creates branches, commits, or mutates reviewed
  repositories.
- Submodules and combined merge diffs are not modeled yet.
