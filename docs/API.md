# Local HTTP API

Greenroom exposes a local Hono API for repository registration, worktree-aware
default review creation, custom committed-ref review creation, structured
diffs, revision refresh, durable review threads, local capability-token
management, profiles, Spotlight Views, consent-gated teaching, selected-thread
handoff bundles, and external agent event reporting. API routes require bearer
tokens except `/health` and the loopback-only local setup token endpoint.

## Startup

Start the API from the root workspace:

```sh
bun run server:dev -- --host 127.0.0.1 --port 49331 --database-path /tmp/greenroom.sqlite --log-level info
```

The same command is available inside the server workspace:

```sh
bun --cwd apps/server src/cli.ts --host 127.0.0.1 --port 49331
```

Defaults:

| Option            | Environment variable  | Default                |
| ----------------- | --------------------- | ---------------------- |
| `--host`          | `GREENROOM_HOST`      | `127.0.0.1`            |
| `--port`          | `GREENROOM_PORT`      | `49331`                |
| `--database-path` | `GREENROOM_DB_PATH`   | Platform app data path |
| `--log-level`     | `GREENROOM_LOG_LEVEL` | `info`                 |

`GREENROOM_ALLOWED_ORIGINS` or `--allowed-origins` can add comma-separated
browser origins to the default loopback-only CORS policy.

Harness-backed profiles require the API to reach a host bridge:

```sh
GREENROOM_HARNESS_BASE_URL=http://127.0.0.1:49343 \
GREENROOM_HARNESS_TOKEN=<local-random-token> \
bun run server:dev
```

When unset, profiles with `provider: "harness"` can still be stored, but their
approval endpoints fail with a provider configuration error.

## Authentication

Mint a local admin token through the unauthenticated setup endpoint:

```sh
curl -sS -X POST http://127.0.0.1:49331/api/setup/tokens \
  -H 'content-type: application/json' \
  -d '{"name":"Local admin"}'
```

The response includes `plaintextToken` once. Greenroom stores only a SHA-256
hash of the token in SQLite. Setup tokens always carry `admin` scope.

The endpoint is gated (loopback-only by default):

- On non-loopback binds (unless `--setup-token-endpoint enabled` overrides
  the `auto` mode) the endpoint answers `403 forbidden`; pre-provision a
  token with `GREENROOM_BOOTSTRAP_ADMIN_TOKEN` instead.
- The first token can be minted by any client while the endpoint is enabled.
- After the first token exists (the `greenroom up` supervisor bootstraps one
  at startup), minting additionally requires the requesting client address to
  be loopback and answers `403 forbidden` otherwise (or when the address is
  unknown). This is safe on loopback because anything on localhost is already
  the trusted operator — it can read the data dir, run
  `greenroom token create`, or restart the server — while cross-origin
  browser requests (CSRF/DNS rebinding) are rejected by the Origin allowlist
  before the route runs. It is what lets a fresh browser mint its own token
  with one click after the supervisor bootstrap.

Send tokens with every protected request:

```sh
curl -H "Authorization: Bearer $GREENROOM_TOKEN" \
  http://127.0.0.1:49331/api/repositories
```

Scopes:

| Scope            | Allows                                                                            |
| ---------------- | --------------------------------------------------------------------------------- |
| `read`           | Repository, review, diff, thread, profile, OpenAPI, Spotlight, and teaching reads |
| `comment:write`  | Creating review threads, reply comments, and teaching promotions                  |
| `thread:resolve` | Resolving, dismissing, and reopening threads                                      |
| `review:write`   | Registering repositories, creating reviews, refreshing reviews                    |
| `admin`          | Token/profile management and all scoped operations                                |

Token management:

- `GET /api/tokens` lists token metadata without hashes or plaintext values.
- `POST /api/tokens` creates a token and returns `plaintextToken` once.
- `POST /api/tokens/:tokenId/revoke` marks a token revoked.
- Tokens may carry an optional `expiresAt` timestamp; expired tokens fail
  authentication exactly like revoked tokens and are swept (marked revoked) at
  server startup. Run-scoped workflow MCP grants always set an expiry from the
  run's timeout budget.
- Revoked or unknown tokens receive `401 unauthorized`.
- Valid tokens missing a required scope receive `403 forbidden`.

## Response Shape

Successful responses return resource wrappers such as `{ "repository": ... }`,
`{ "reviews": [...] }`, or `{ "files": [...] }`.

Errors return:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "issues": [{ "path": "rootPath", "message": "Paths must be absolute" }]
    }
  }
}
```

## Endpoints

| Method | Path                                                                       | Scope            | Purpose                                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/health`                                                                  | Public           | Returns API health and the SQLite database path.                                                                                                                                                                                           |
| `POST` | `/api/setup/tokens`                                                        | Setup only       | Mints a local admin token unauthenticated: loopback binds only; after the first token exists, loopback clients only.                                                                                                                       |
| `GET`  | `/api/openapi.json`                                                        | `read`           | Returns the generated OpenAPI 3.1 document.                                                                                                                                                                                                |
| `GET`  | `/api/config/file`                                                         | `admin`          | Reads the parsed `greenroom.toml`, its resolved path, and per-key env-override / effective-source context.                                                                                                                                 |
| `PUT`  | `/api/config/file`                                                         | `admin`          | Validates against the config-file schema and rewrites `greenroom.toml` (regenerated layout). Inline secrets are rejected; failures return per-key `validation_error` issues.                                                               |
| `GET`  | `/api/harness/status`                                                      | `read`           | Reports whether the harness bridge is configured, healthy, which harness kinds are available, and the bridge-detected harness CLIs (`detectedHarnesses`: found, path, version, `recommendSmoke` on version change; see `docs/Harness.md`). |
| `GET`  | `/api/harness/models/:kind`                                                | `read`           | Lists the models and per-model reasoning levels available to a harness-backed profile. Add `?refresh=true` to bypass the bridge catalog cache. |
| `GET`  | `/api/tokens`                                                              | `admin`          | Lists local capability tokens without hashes.                                                                                                                                                                                              |
| `POST` | `/api/tokens`                                                              | `admin`          | Creates a local capability token and returns its plaintext value once.                                                                                                                                                                     |
| `POST` | `/api/tokens/:tokenId/revoke`                                              | `admin`          | Revokes a local capability token.                                                                                                                                                                                                          |
| `GET`  | `/api/profiles`                                                            | `read`           | Lists local teaching/provider profiles without credentials.                                                                                                                                                                                |
| `POST` | `/api/profiles`                                                            | `admin`          | Creates a local profile.                                                                                                                                                                                                                   |
| `GET`  | `/api/profiles/:profileId`                                                 | `read`           | Reads a local profile.                                                                                                                                                                                                                     |
| `POST` | `/api/profiles/:profileId`                                                 | `admin`          | Updates a local profile.                                                                                                                                                                                                                   |
| `POST` | `/api/profiles/:profileId/delete`                                          | `admin`          | Deletes a local profile.                                                                                                                                                                                                                   |
| `GET`  | `/api/repositories`                                                        | `read`           | Lists registered repositories.                                                                                                                                                                                                             |
| `POST` | `/api/repositories`                                                        | `review:write`   | Registers a valid local Git worktree. Body: `rootPath`, optional `displayName`, optional `defaultBranchCandidate`.                                                                                                                         |
| `GET`  | `/api/repositories/:repositoryId/refs?kind=all\|branches\|tags`            | `read`           | Lists local refs.                                                                                                                                                                                                                          |
| `GET`  | `/api/repositories/:repositoryId/commits?search=&baseRef=&headRef=&limit=` | `read`           | Lists or searches local commits. Range queries require both `baseRef` and `headRef`.                                                                                                                                                       |
| `GET`  | `/api/repositories/:repositoryId/base-candidates`                          | `read`           | Returns local default base candidates with reason metadata.                                                                                                                                                                                |
| `GET`  | `/api/reviews?state=open\|closed\|all`                                     | `read`           | Lists reviews with repository and current revision metadata. Defaults to `open`.                                                                                                                                                           |
| `POST` | `/api/reviews/preview`                                                     | `read`           | Returns a worktree or committed-ref changed-file preview without persisting a review.                                                                                                                                                      |
| `POST` | `/api/reviews`                                                             | `review:write`   | Creates a worktree or committed-ref review and stores the first revision diff.                                                                                                                                                             |
| `GET`  | `/api/reviews/:reviewId`                                                   | `read`           | Reads one review with repository and current revision metadata.                                                                                                                                                                            |
| `GET`  | `/api/reviews/:reviewId/diff`                                              | `read`           | Reads the current revision structured diff.                                                                                                                                                                                                |
| `GET`  | `/api/reviews/:reviewId/revisions`                                         | `read`           | Lists revision snapshots for a review.                                                                                                                                                                                                     |
| `GET`  | `/api/reviews/:reviewId/revisions/:revisionId`                             | `read`           | Reads one revision snapshot with its structured diff.                                                                                                                                                                                      |
| `POST` | `/api/reviews/:reviewId/refresh`                                           | `review:write`   | Creates a new revision when refs or worktree fingerprints changed, or reuses the current revision.                                                                                                                                         |
| `GET`  | `/api/reviews/:reviewId/worktree-status`                                   | `read`           | Checks whether the current worktree fingerprint differs from the review's latest revision snapshot.                                                                                                                                        |
| `POST` | `/api/reviews/:reviewId/close`                                             | `review:write`   | Marks a review closed so it is hidden from default review lists.                                                                                                                                                                           |
| `POST` | `/api/reviews/:reviewId/reopen`                                            | `review:write`   | Reopens a closed review.                                                                                                                                                                                                                   |
| `GET`  | `/api/reviews/:reviewId/spotlight/views`                                   | `read`           | Lists Spotlight Views with health state, intent, order, and associated files.                                                                                                                                                              |
| `GET`  | `/api/spotlight/views/:viewRef`                                            | `read`           | Reads one Spotlight View with lit regions by global ref such as `SV-3`.                                                                                                                                         |
| `GET`  | `/api/spotlight/views/:viewRef/diff`                                       | `read`           | Reads the current structured diff scoped to one Spotlight View's associated files.                                                                                                                                                         |
| `GET`  | `/api/reviews/:reviewId/spotlight/coverage`                                | `read`           | Reads changed-line anchors that are not lit by any Spotlight View.                                                                                                                                                                         |
| `GET`  | `/api/reviews/:reviewId/spotlight/line-membership`                         | `read`           | Reads which Spotlight Views contain each changed line in the current diff.                                                                                                                                                                 |
| `POST` | `/api/reviews/:reviewId/spotlight/runs`                                    | `review:write`   | Creates a manual Spotlight generate, update, regenerate, or refine-this-View run; `start: true` also approves it.                                                                                                                          |
| `GET`  | `/api/reviews/:reviewId/spotlight/runs/:runId`                             | `read`           | Reads one Spotlight run, including context summary and pending outline when available.                                                                                                                                                     |
| `POST` | `/api/reviews/:reviewId/spotlight/runs/:runId/approve-context`             | `review:write`   | Approves displayed Spotlight context before provider planning or generation.                                                                                                                                                               |
| `POST` | `/api/reviews/:reviewId/spotlight/runs/:runId/refine`                      | `review:write`   | Refines a gated Spotlight outline with an ephemeral instruction.                                                                                                                                                                           |
| `POST` | `/api/reviews/:reviewId/spotlight/runs/:runId/approve-plan`                | `review:write`   | Approves a gated Spotlight outline and generates or updates View membership.                                                                                                                                                               |
| `POST` | `/api/reviews/:reviewId/handoff`                                           | `read`           | Creates a structured bundle for selected thread refs with metadata, anchors, snippets, and comments.                                                                                                                                       |
| `POST` | `/api/reviews/:reviewId/teaching/consent`                                  | `review:write`   | Creates a teaching workflow run with its scoped context; `start: true` also approves and executes it.                                                                                                                                      |
| `POST` | `/api/reviews/:reviewId/teaching/promote`                                  | `comment:write`  | Promotes a teaching point into a durable anchored review thread.                                                                                                                                                                           |
| `POST` | `/api/reviews/:reviewId/builtin-review/consent`                            | `review:write`   | Creates a built-in AI review workflow run with its consent summary; `start: true` also approves and executes it.                                                                                                                           |
| `GET`  | `/api/builtin-review/runs/:runId`                                          | `read`           | Reads a durable built-in AI review workflow run through the AI Review response shape.                                                                                                                                                      |
| `POST` | `/api/builtin-review/runs/:runId/approve`                                  | `comment:write`  | Approves context, calls the harness bridge, validates findings, and returns a validated draft or completed run.                                                                                                                            |
| `POST` | `/api/builtin-review/runs/:runId/approve-draft`                            | `comment:write`  | Creates review threads from a validated draft-gated built-in AI review run.                                                                                                                                                                |
| `GET`  | `/api/teaching/runs/:runId`                                                | `read`           | Reads a teaching workflow run through the Teaching response shape.                                                                                                                                                                         |
| `POST` | `/api/teaching/runs/:runId/approve`                                        | `review:write`   | Approves the displayed context and calls the configured provider or harness workflow.                                                                                                                                                      |
| `POST` | `/api/teaching/runs/:runId/follow-up`                                      | `review:write`   | Asks a follow-up question within the approved teaching run scope.                                                                                                                                                                          |
| `GET`  | `/api/workflow-runs/:runId/events`                                         | `read`           | Lists workflow events by default; with `?since=N` returns normalized persisted harness stream events; `?stream=1` serves those harness events as SSE.                                                                                      |
| `GET`  | `/api/workflow-runs/:runId/transcripts`                                    | `read`           | Lists redacted harness transcripts (prompt, output, stderr) stored for a workflow run.                                                                                                                                                     |
| `GET`  | `/api/workflow-runs/:runId/diagnostics`                                    | `read`           | Returns derived run diagnostics: failure category, failing step, exit code, redacted stderr tail, repair attempts.                                                                                                                         |
| `POST` | `/api/workflow-runs/:runId/progress`                                       | `read`           | Run-scoped draft actors report structured progress; records activity and a `harness_progress` event.                                                                                                                                       |
| `POST` | `/api/workflow-runs/:runId/recover-fingerprint`                            | `review:write`   | Recovers a `fingerprint_changed` failure: refreshes the review and starts a consented run on the new revision.                                                                                                                             |
| `POST` | `/api/workflow-transcripts/purge`                                          | `admin`          | Deletes all persisted workflow transcripts and returns the deleted count.                                                                                                                                                                  |
| `POST` | `/api/agent-events`                                                        | `comment:write`  | Records an external agent event such as an attempted fix without mutating reviewed repository files.                                                                                                                                       |
| `GET`  | `/api/reviews/:reviewId/threads`                                           | `read`           | Lists review threads with comments.                                                                                                                                                                                                        |
| `POST` | `/api/reviews/:reviewId/threads`                                           | `comment:write`  | Creates an anchored thread on one or more changed diff lines in the current revision.                                                                                                                                                      |
| `GET`  | `/api/threads/:threadRef`                                                  | `read`           | Reads a thread by global ref such as `GT-12`.                                                                                                                                                                   |
| `POST` | `/api/threads/:threadRef/comments`                                         | `comment:write`  | Adds a reply comment to a thread.                                                                                                                                                                                                          |
| `POST` | `/api/threads/:threadRef/resolve`                                          | `thread:resolve` | Marks a thread resolved.                                                                                                                                                                                                                   |
| `POST` | `/api/threads/:threadRef/dismiss`                                          | `thread:resolve` | Marks a thread dismissed.                                                                                                                                                                                                                  |
| `POST` | `/api/threads/:threadRef/reopen`                                           | `thread:resolve` | Reopens a resolved or dismissed thread.                                                                                                                                                                                                    |

Display refs are the only externally visible identifiers. Every entity type
carries a distinct, globally unique human ref: reviews use `GR-N`
(`review.displayId`), threads use `GT-N` (`thread.shortRef`), and Spotlight
Views use `SV-N` (`view.displayRef`). Route path parameters named `:reviewId`,
`:threadRef`, and `:viewRef` accept only these forms; anything else — including
internal database ids such as `review_<uuid>` — returns 404. Request bodies
that reference other entities use display-ref fields (`reviewDisplayId`,
`threadRef`, `viewRef`), and responses never contain opaque
review/thread/spotlight-view ids. Internal ids remain database primary keys
only and never cross the API boundary. Comments, revisions, profiles, and
workflow runs keep their opaque ids (`comment_…`, `revision_…`, `profile_…`,
`workflow_run_…`) — they have no display-ref scheme.

Thread and view refs resolve without a review ref via the top-level
`/api/threads/:threadRef` and `/api/spotlight/views/:viewRef` routes. All
three ref kinds are allocated from a monotonic sequence and never reused, so a
stale ref returns 404 rather than resolving to unrelated content.

Profiles support `provider: "harness"`, `provider: "mock"`, and
`provider: "custom"`. Harness profiles use `model` for the selected harness
model and store non-secret settings under `modelSettings.harness`, such as
`{ "kind": "claude-code", "reasoningLevel": "high", "idleTimeoutMs": 300000 }`.
Omitting `reasoningLevel` uses the harness/model default. Profiles whose
`model` equals the harness kind mean "use the harness default". The direct
`openai` provider is not supported; all AI runs go through the harness bridge.

## Configuration File Endpoints

`GET /api/config/file` and `PUT /api/config/file` (both `admin` scope) back
the Settings UI's server-configuration form. `GET` returns the parsed
`greenroom.toml` contents, the resolved file path, and a `keys` array with one
entry per editable key: its env-var equivalent, whether the effective value
comes from `env`, `file`, or `default`, the file value, and the raw env value
when an override is active. The UI uses `source: "env"` to warn that a file
edit will not take effect until the env var is unset. When the on-disk file is
malformed, `GET` reports per-key problems in `fileError` instead of failing so
the UI can overwrite the file.

`PUT` accepts `{ "config": { ... } }`, validates it against the strict config
file schema, and rewrites `greenroom.toml` with a regenerated layout (comments
in a hand-edited file are not preserved). Validation failures return `400`
`validation_error` with `details.issues` entries of `{ path, message }` keyed
by config key, for example `server.port`. Secret values never round-trip: the
bridge token is editable only as a `tokenEnv`/`tokenFile` reference, an inline
`bridge.token` value is rejected, and the `bridge.token` key status never
carries the env var's value. Config is read at server boot, so changes require
a restart; there is no hot reload.

## Practical Diff Limits

The v1 API returns a full structured diff for a revision in one JSON response.
Spotlight View diff reads also return the full current diff for the View's
associated files in one response. The browser workspace avoids rendering very
large files all at once by initially showing 1,200 diff lines when a file
exceeds 1,200 lines or 80 hunks, then letting the user load 600 more lines or
the full file.

This keeps the review surface responsive for medium and large local diffs, but
API-side file pagination and View-diff pagination are not currently available.
Exceptionally large single-file diffs can still spend noticeable time in local
Git diff generation, JSON transfer, and browser parsing before UI chunking
begins. Coverage for this behavior lives in
`tests/performance-reliability.test.ts`.

## Review Creation

Reviews have a `status` of `open` or `closed`. `GET /api/reviews` returns open
reviews by default. Pass `state=closed` to list closed reviews, or `state=all`
to list both open and closed reviews.

Preview a default worktree review before persisting it:

```json
{
  "repositoryId": "repo_1",
  "title": "Current worktree"
}
```

When `baseRef` is omitted, Greenroom reviews the current `HEAD` plus staged and
unstaged tracked-file changes against the detected default merge-base. If the
current checkout is already the default branch and no merge-base candidate is
available, the base is the current `HEAD`, so the review contains only tracked
staged and unstaged worktree changes. Untracked files are excluded.

`comparisonMode` is optional and defaults from `baseRef`: requests without
`baseRef` create worktree reviews and requests with `baseRef` create
committed-ref reviews. Send `"worktree"`, `"refs"`, or `"whole_repository"`
explicitly to override the default.

Preview a custom committed-ref review before persisting it:

```json
{
  "repositoryId": "repo_1",
  "title": "Feature review",
  "baseRef": "main",
  "headRef": "feature/review"
}
```

Preview a whole repository review before persisting it:

```json
{
  "repositoryId": "repo_1",
  "title": "Explore full codebase",
  "comparisonMode": "whole_repository",
  "headRef": "main"
}
```

Whole repository reviews compare the selected committed head, defaulting to
`HEAD`, against Git's empty tree object. They include tracked files at that
commit and exclude untracked, ignored, staged-only, and unstaged worktree
changes.

`POST /api/reviews/preview` returns the normalized range, base/head SHAs, diff
summary, optional worktree fingerprint, and changed files. It does not create a
review, revision, or diff rows.

Custom committed-ref review:

```json
{
  "repositoryId": "repo_1",
  "title": "Feature review",
  "baseRef": "main",
  "headRef": "feature/review"
}
```

### Internal `review.created` Event

Creating a review emits an in-process `review.created` event on the server's
internal API event bus (`apps/server/src/api/events.ts`). The
payload carries the created review, its repository, the initial revision
snapshot, and creator context (the API token id/name, or `internal` for direct
service-layer calls) — enough for a subscriber to enqueue a workflow run.

This is an internal extension point for auto-run-on-review-creation, not a
public API: no listener is registered by default, so review creation has no
additional side effects, and listener errors never fail the creating request.
A subscriber that enqueues a run must use the normal run-creation path, which
creates the run in `pending_consent`; the run stays inert until it is explicitly
approved, so auto-enqueued runs never bypass consent.

## Revisions And Refresh

`GET /api/reviews/:reviewId/revisions` returns snapshots in storage order with
their base SHA, nullable head SHA, optional worktree fingerprint, summary, and
refresh reason.

`POST /api/reviews/:reviewId/refresh` regenerates the review diff. If the
resolved committed refs or worktree fingerprint match the current revision, the
response has `reused: true` and no new rows are created. If they changed, the API
stores a new revision, makes it current, and best-effort remaps thread anchors.
Threads that cannot be remapped confidently keep their previous anchor and are
marked `outdated`.

`GET /api/reviews/:reviewId/worktree-status` (`read` scope) is a lightweight
dirtiness check for run-start surfaces. It compares the current worktree
fingerprint (HEAD SHA plus staged/unstaged diff hashes) with the review's
latest revision snapshot and returns
`{ reviewDisplayId, revisionId, applicable, dirty, snapshotFingerprint, currentFingerprint, checkedAt }`.
`dirty: true` means an AI run consented against the latest snapshot may fail
with `fingerprint_changed`, so the UI warns and offers a refresh before
starting. `applicable` is `false` (and `dirty` is `false`) for committed-range
and whole repository reviews, whose snapshots carry no worktree fingerprint.

## Thread Anchors

Thread creation accepts the shared `ThreadCreateInput` shape. The route
review ref must match the body `reviewDisplayId`, the primary `anchor` revision
must be
the review current revision, and every value in optional `anchors` must target
the same file in that revision. If `anchors` is omitted, the API stores a
single-line thread using `anchor`.

Each anchor must target an addition on the head side or a deletion on the base
side. Context lines are not valid thread anchors in v1. Multi-line responses
preserve `anchor` as the primary display/navigation anchor and include `anchors`
for the full selected line set.

See [Threads.md](Threads.md) for thread status, type, severity, source
attribution, short ref, and triage filter vocabulary.

See [MCP.md](MCP.md) for the external tool reference.

## Spotlight

Spotlight Views are review-global lenses over the current review diff. A View
has a title, description, intent tag, suggested `orderIndex`, health
(`current`, `drifted`, or `outdated`), associated files, and lit regions stored
as expanded thread anchors. Threads and comments remain review-global; a thread
created while a View is selected stores View provenance in source metadata but
uses ordinary anchors.

Read Views:

```http
GET /api/reviews/:reviewId/spotlight/views
GET /api/spotlight/views/:viewRef
GET /api/spotlight/views/:viewRef/diff
GET /api/reviews/:reviewId/spotlight/line-membership
```

`/spotlight/coverage` returns changed-line anchors that are not lit by any
View. Coverage is derived from current View membership; it is not stored as a
View.

Manual Spotlight operations are created with:

```json
{
  "type": "generate",
  "trigger": "manual",
  "gated": true,
  "revisionId": "revision_1",
  "profileId": "profile_2"
}
```

Run types are `generate`, `update`, `regenerate`, and `refine_view`.
Regenerate requires `"confirmed": true`; refine-this-View requires
`"targetViewId"`. Runs start in `pending_consent` when the selected profile
requires per-run consent. Gated runs then expose an outline for refinement and
approval before membership generation. Provider credentials stay in environment
variables and are not stored by Greenroom.

## Consent Modes

Each AI profile carries `privacy.consentMode`, which controls how run consent
is granted:

- `one_click` (default): the run-creation endpoints
  (`/teaching/consent`, `/builtin-review/consent`, `/spotlight/runs`) accept
  `"start": true`, which records the consent summary, approves it, and
  executes the run in one atomic request. The recorded consent summary and
  approved scope are identical to the two-step flow — one-click only removes
  the second request.
- `two_step`: the strict create-then-approve flow. `"start": true` is rejected
  with `409 conflict`, and the run must be approved through the matching
  approve endpoint after inspecting the returned scope.
- `trusted`: the run-creation endpoints start the run
  immediately, even without `"start": true`, and validated built-in review
  findings auto-create threads instead of stopping for draft approval.
  Trusted mode reduces clicks, not records: the consent summary, approved
  scope, and audit events are recorded exactly as in one-click mode, and run
  metadata records `consentMode: "trusted"`.

Draft approval before thread creation follows consent mode for trusted
profiles only: built-in review findings still land as drafts that require
explicit approval unless the profile is `trusted` or opts into
`contextPreferences.autoCreateThreads`. Invalid findings never create threads
in any mode.

## Run Diagnostics

`GET /api/workflow-runs/:runId/diagnostics` (`read` scope) returns
`{ "diagnostics": ... }` derived from the persisted run record, its event log,
and its redacted transcripts. It works for every workflow kind and run status;
for runs that did not fail the failure-specific fields are `null`/empty. The
payload contains:

- `failureCategory` and a human-readable `summary` (see the enum below).
- `failingStep`: the workflow step id and phase that was active when the run
  failed (`null` for non-failed runs).
- `exitCode`: the harness bridge process exit code, taken from the latest
  transcript or parsed from the failure record.
- `stderrTail`: the last lines of the redacted stderr from the persisted
  transcript. Always redacted; `null` when no transcript exists (for example
  when the profile sets `privacy.persistTranscript: false`).
- `validationIssues`: the accumulated validator issue list from failed and
  repaired draft attempts.
- `repairAttempts`: one entry per repair attempt with `attemptNumber`,
  `issueCodes`, and `timestamp`.
- `maxRepairAttempts`: the repair-attempt budget for the run (`null` when no
  repair ever started). Together with `repairAttempts` this renders
  "repair attempt N of M". Run detail/status responses expose the same
  progress directly: run `metadata` carries `repairAttemptCount`,
  `maxRepairAttempts`, and the `repairAttempts` history while a repair is in
  progress and after (default budget `2`; see
  `GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS` / `workflows.maxRepairAttempts`).
- `fingerprint`: `{ changed, consentedRevisionId, currentRevisionId }` so a
  fingerprint-change failure can be recovered against the review's current
  revision.
- `timeoutMs` / `timeoutBudgetMs`: the observed timeout and the API-side run
  budget when known.
- `transcripts` (metadata only, no content) and `transcriptsUrl` referencing
  `GET /api/workflow-runs/:runId/transcripts`.

`failureCategory` is machine-readable and `null` for runs that did not fail:

| Category              | Meaning                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bridge_down`         | The harness bridge was not configured, unreachable, or returned an HTTP error (connection refused, fetch failure).    |
| `invalid_output`      | The harness draft failed validation and repair attempts were exhausted, or the harness produced no structured output. |
| `unknown_anchor`      | The output referenced anchor keys that do not exist in the reviewed diff (`unknown-anchor-key` validator issues).     |
| `timeout`             | The run exceeded the workflow timeout budget or the bridge reported a harness command timeout (see Harness.md).       |
| `fingerprint_changed` | The repository worktree fingerprint changed while the harness ran, so the bridge discarded its output.                |
| `unknown`             | The run failed, but no known failure signature matched; `summary` falls back to the run's error message.              |

## Fingerprint-Change Recovery

`POST /api/workflow-runs/:runId/recover-fingerprint` (`review:write` scope) is
the one-action recovery for `fingerprint_changed` failures. In one atomic
request it refreshes the review to a new revision snapshot of the current
worktree state, then creates a new run of the same workflow kind, profile, and
harness whose consent summary references the **new** revision — the failed
run's consent scope is never reused. It returns `201` with
`{ run, started, consentMode, recoveredFromRunId, review, revision, reusedRevision }`.

Consent follows the profile's consent mode: for `one_click` and `trusted`
profiles the recovery request itself is the confirmation of the new scope, so
the run is approved and queued immediately (`started: true`, with
`approvedScope.revisionId` set to the new revision). For `two_step` profiles
the new run lands in `pending_consent` (`started: false`) and must be approved
through `POST /api/workflow-runs/:runId/approve` after inspecting the new
scope. Requests for runs that are not failed, or whose failure category is not
`fingerprint_changed`, are rejected with `409 conflict`.

## Profiles And Teaching

Create a mock teaching profile:

```json
{
  "name": "Mock teaching",
  "workflowType": "teaching",
  "provider": "mock",
  "model": "mock-teacher",
  "systemPrompt": "Explain this review.",
  "modelSettings": {},
  "allowedTools": [],
  "contextPreferences": {
    "includeQuiz": true
  },
  "privacy": {
    "persistTranscript": true,
    "consentMode": "one_click"
  }
}
```

`privacy.persistTranscript` defaults to `true`: redacted harness transcripts
are stored per workflow run with retention caps. Set it to `false` on a profile
to skip transcript persistence for that profile's runs.

Create a pending teaching run and inspect the scoped context before any provider
call:

```json
{
  "profileId": "profile_2",
  "revisionId": "revision_1",
  "scope": { "kind": "full_pr" },
  "maxApproximateTokens": 16000
}
```

`POST /api/reviews/:reviewId/teaching/consent` returns `{ "run": ... }` with
status `pending_consent`, the selected profile ID, scope, review/revision
metadata, files, hunks, approximate token count, and omitted files. Adding
`"start": true` (one-click consent) approves and executes the run in the same
request when the profile's `consentMode` allows it. A focused
View-scoped run uses:

```json
{
  "profileId": "profile_2",
  "revisionId": "revision_1",
  "scope": { "kind": "spotlight_view", "viewRef": "SV-1" },
  "maxApproximateTokens": 16000
}
```

View-scoped context includes lit regions, associated files, surrounding hunk
context, View title/health, and omitted region reporting. `scope` selects
either the Full PR or a single Spotlight View; there is no per-file selection.
Approve the displayed context with:

```http
POST /api/teaching/runs/:runId/approve
```

Follow-ups are scoped to the approved run:

```json
{
  "question": "What should I inspect first?"
}
```

Promote a teaching point into a thread:

```json
{
  "runId": "workflow_run_1",
  "title": "Missed concept",
  "body": "Track this as a durable review question.",
  "anchor": {
    "reviewDisplayId": "GR-1",
    "revisionId": "revision_1",
    "filePath": "src/index.ts",
    "oldFilePath": null,
    "side": "head",
    "lineNumber": 12,
    "lineType": "addition",
    "hunkId": null,
    "hunkHeader": "@@ -1,1 +1,2 @@",
    "contextBefore": [],
    "contextAfter": [],
    "originalLineText": "  return true;"
  }
}
```

Promotion creates a normal review thread with source kind `teaching`. The anchor
must target a changed line in the current revision. When a teaching run was
scoped to a Spotlight View, promotion source metadata includes the teaching run
ID, View ID, View title, and View health for provenance.

See [Teaching.md](Teaching.md) for privacy behavior, provider configuration,
and structured teaching output.

## Handoffs And Agent Events

Create a bundle for selected thread refs:

```json
{
  "reviewDisplayId": "GR-1",
  "threadRefs": ["GT-1", "GT-4"],
  "desiredOutcome": "Address the selected issues and report what changed."
}
```

`POST /api/reviews/:reviewId/handoff` returns `{ "handoff": ... }` with review,
repository, current revision, selected refs, desired outcome, each selected
thread, its anchor, relevant comments, and a compact snippet window around the
anchored line.

Record an attempted fix:

```json
{
  "reviewDisplayId": "GR-1",
  "eventType": "attempted_fix",
  "source": {
    "kind": "mcp_client",
    "displayName": "Codex",
    "clientName": "codex"
  },
  "threadRefs": ["GT-1"],
  "summary": "Attempted to replace the magic value with a named constant.",
  "metadata": {
    "workspace": "local"
  }
}
```

Agent events are audit records only. They do not apply patches, change thread
state, or mutate the reviewed repository.
