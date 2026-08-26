# MCP Setup

Greenroom includes a dependency-free MCP adapter in `packages/mcp`. It exposes
local review data through the HTTP API, so external clients need the API base URL
and a scoped bearer token.

`greenroom up` (and the Docker image) already runs the HTTP MCP endpoint at
`http://127.0.0.1:49332/mcp`; connecting a client is a matter of minting a
token and pasting a config. The fastest path is the **"Connect a coding
agent" card** on Settings → Connections: it mints a scoped token inline
(default scopes `read`, `comment:write`) and emits three ready-to-paste
configs pre-filled with the token and the real endpoint — a `claude mcp add`
command for Claude Code, a generic stdio `mcpServers` JSON block, and a
streamable-HTTP `mcpServers` JSON block. The sections below document the same
setups by hand.

## Token

Create a token with the Connect card, in Settings → Tokens, with
`greenroom token create --name "Agent" --scopes read,comment:write`, or with
the admin API. Recommended scopes depend on the workflow:

| Workflow                | Scopes                                    |
| ----------------------- | ----------------------------------------- |
| Read-only review        | `read`                                    |
| Commenting reviewer     | `read`, `comment:write`                   |
| Triage assistant        | `read`, `comment:write`, `thread:resolve` |
| Review creator/operator | `read`, `review:write`, `comment:write`   |

## Stdio Server

The stdio server talks to a running Greenroom API (start one with
`greenroom up`, or `bun run server:dev` for API-only development) and needs a
Greenroom checkout, since MCP clients spawn it with Bun:

```sh
bun --cwd packages/mcp src/stdio.ts
```

Environment:

| Variable                 | Required | Default                  |
| ------------------------ | -------- | ------------------------ |
| `GREENROOM_API_TOKEN`    | Yes      | None                     |
| `GREENROOM_API_BASE_URL` | No       | `http://127.0.0.1:49331` |

Example client configuration (the common `mcpServers` JSON shape, as emitted
by the Connect card):

```json
{
  "mcpServers": {
    "greenroom": {
      "command": "bun",
      "args": ["--cwd", "/absolute/path/to/greenroom/packages/mcp", "src/stdio.ts"],
      "env": {
        "GREENROOM_API_BASE_URL": "http://127.0.0.1:49331",
        "GREENROOM_API_TOKEN": "<greenroom-api-token>"
      }
    }
  }
}
```

## HTTP JSON-RPC Server

`greenroom up`, `greenroom up --dev`, and the Docker image already supervise
this server; start it manually only for standalone setups:

```sh
bun --cwd packages/mcp src/http.ts
```

Environment:

| Variable                        | Required | Default                     |
| ------------------------------- | -------- | --------------------------- |
| `GREENROOM_API_BASE_URL`        | No       | `http://127.0.0.1:49331`    |
| `GREENROOM_MCP_HOST`            | No       | `127.0.0.1`                 |
| `GREENROOM_MCP_PORT`            | No       | `49332`                     |
| `GREENROOM_MCP_ALLOWED_ORIGINS` | No       | None (all origins rejected) |

The endpoint is `POST /mcp`. API-backed MCP calls (`tools/call` and
non-concept `resources/read`) require the request's
`Authorization: Bearer <token>` header; unauthenticated requests receive HTTP
401 with a JSON-RPC error. There is no server-side fallback token: the
endpoint ignores `GREENROOM_API_TOKEN`, so every client must send its own
scoped bearer token.

Cross-origin browser access is denied by default. Requests carrying an
`Origin` header are rejected with HTTP 403 unless the origin appears in
`GREENROOM_MCP_ALLOWED_ORIGINS` (a comma-separated list of exact origins);
allowlisted origins are echoed back individually — wildcard CORS is never
served. Non-browser clients (Claude Code, curl, stdio bridges) are unaffected
because they do not send an `Origin` header.

Example:

```sh
curl -sS http://127.0.0.1:49332/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $GREENROOM_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The Compose setup exposes this endpoint at `http://localhost:49332/mcp`.

Claude Code can register the HTTP endpoint directly (the Connect card emits
this pre-filled):

```sh
claude mcp add --transport http greenroom http://127.0.0.1:49332/mcp \
  --header "Authorization: Bearer <greenroom-api-token>"
```

Clients that support streamable HTTP in `mcpServers` JSON can use (also
emitted by the Connect card):

```json
{
  "mcpServers": {
    "greenroom": {
      "type": "http",
      "url": "http://127.0.0.1:49332/mcp",
      "headers": {
        "Authorization": "Bearer <greenroom-api-token>"
      }
    }
  }
}
```

## Tools

Review resources include a visible `displayId` such as `GR-1`. Use that value as
`reviewId` in lookup tools and resources, and as `reviewDisplayId` in the write
tools whose request bodies carry that field (`greenroom_create_thread`,
`greenroom_create_handoff`, `greenroom_report_attempted_fix`). Threads and
Spotlight Views carry their
own globally unique refs — `GT-12` (`thread.shortRef`) and `SV-3`
(`view.displayRef`) — which resolve alone as `threadRef` / `viewRef` without a
review id. Display refs are the only accepted identifiers; opaque IDs such as
`review_1` are not accepted anywhere and no longer appear in responses.

The table below is generated from the tool definitions in
`packages/mcp/src/tools.ts`. Regenerate it with `bun run docs:mcp`; a unit test
fails when it drifts.

<!-- BEGIN GENERATED: mcp-tools (bun run docs:mcp) -->

| Tool                                          | Arguments                                                                                              | Description                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `greenroom_list_reviews`                      | optional `state`                                                                                       | List local Greenroom review PR summaries, defaulting to open reviews.                        |
| `greenroom_get_review`                        | `reviewId`                                                                                             | Read review metadata, refs, current revision, and stats.                                     |
| `greenroom_get_diff`                          | `reviewId`, optional `revisionId`                                                                      | Read the current or selected structured review diff.                                         |
| `greenroom_list_changed_files`                | `reviewId`, optional `revisionId`, optional `cursor`, optional `limit`                                 | List changed files for the current review revision with pagination.                          |
| `greenroom_read_diff_file`                    | `reviewId`, `path`, optional `revisionId`, optional `cursor`, optional `limit`                         | Read one changed file diff by repository-relative path with hunk pagination.                 |
| `greenroom_search_diff`                       | `reviewId`, `query`, optional `path`, optional `revisionId`, optional `cursor`, optional `limit`       | Search current diff paths, hunk headers, and line content with pagination.                   |
| `greenroom_get_anchor_registry`               | `reviewId`, optional `path`, optional `revisionId`, optional `cursor`, optional `limit`                | Read stable changed-line anchor keys for the current revision.                               |
| `greenroom_get_existing_threads`              | `reviewId`, optional `status`, optional `path`, optional `cursor`, optional `limit`                    | Read summarized existing review threads with optional status and path filters.               |
| `greenroom_get_spotlight_views`               | `reviewId`, optional `cursor`, optional `limit`                                                        | Read Spotlight View summaries with intent, health, and associated files, with pagination.    |
| `greenroom_get_view_diff`                     | `viewRef`, optional `path`, optional `cursor`, optional `limit`                                        | Read a Spotlight View diff with file or hunk pagination.                                     |
| `greenroom_get_view`                          | `viewRef`                                                                                              | Read one Spotlight View with its lit regions by global ref.                                  |
| `greenroom_get_line_membership`               | `reviewId`                                                                                             | Read Spotlight View membership for every changed line in the current diff.                   |
| `greenroom_get_thread`                        | `threadRef`                                                                                            | Read one thread with its comments by global ref.                                             |
| `greenroom_create_thread`                     | `reviewDisplayId`, `type`, optional `severity`, `source`, `anchor`, optional `anchors`, `firstComment` | Create an attributed anchored thread through the local API.                                  |
| `greenroom_reply_to_thread`                   | `threadRef`, optional `parentCommentId`, `authorKind`, `authorDisplayName`, `body`                     | Reply to an existing Greenroom review thread.                                                |
| `greenroom_resolve_thread`                    | `threadRef`                                                                                            | Mark a review thread resolved.                                                               |
| `greenroom_dismiss_thread`                    | `threadRef`                                                                                            | Mark a review thread dismissed.                                                              |
| `greenroom_create_handoff`                    | `reviewDisplayId`, `threadRefs`, optional `desiredOutcome`                                             | Create a selected-thread handoff bundle with anchors, comments, and snippets.                |
| `greenroom_report_attempted_fix`              | optional `reviewDisplayId`, `source`, optional `threadRefs`, `summary`, optional `metadata`            | Record an external attempted-fix event without mutating repository files.                    |
| `greenroom_report_progress`                   | `runId`, `message`, optional `completedUnits`, optional `totalUnits`, optional `phase`                 | Report run-scoped workflow progress during long harness runs; counts as run activity.        |
| `greenroom_submit_review_findings_draft`      | `runId`, `draft`                                                                                       | Validate a run-scoped built-in review findings draft without creating durable threads.       |
| `greenroom_submit_spotlight_outline_draft`    | `runId`, `draft`                                                                                       | Validate a run-scoped Spotlight outline draft without creating durable Spotlight records.    |
| `greenroom_submit_spotlight_membership_draft` | `runId`, `draft`                                                                                       | Validate a run-scoped Spotlight membership draft without creating durable Spotlight records. |
| `greenroom_submit_teaching_draft`             | `runId`, `draft`                                                                                       | Validate a run-scoped Teaching draft without creating durable Teaching records or threads.   |

<!-- END GENERATED: mcp-tools -->

`greenroom_report_attempted_fix` records an audit event only. It does not apply
patches or mutate reviewed repositories.

## MCP-First Draft Tools

Greenroom built-in workflows grant run-scoped MCP access to harnesses. Grants
are revoked as soon as the run reaches a terminal state (completed, failed, or
cancelled) or pauses for user input, and each grant token carries a hard
expiry derived from the run's absolute timeout budget plus a small grace
window, so a grant can never outlive its run — even if the server crashes
before revocation, the token expires on its own, and startup reconciliation
fails stranded runs and revokes their grants (see
[Harness.md](Harness.md#startup-recovery)). Those grants expose read tools
plus one draft submission tool that matches the approved workflow:

| Draft tool                                    | Workflow output mode      |
| --------------------------------------------- | ------------------------- |
| `greenroom_submit_review_findings_draft`      | `builtin_review_findings` |
| `greenroom_submit_spotlight_outline_draft`    | `spotlight_outline`       |
| `greenroom_submit_spotlight_membership_draft` | `spotlight_membership`    |
| `greenroom_submit_teaching_draft`             | `teaching_draft`          |

Draft tools validate shape and scope before Greenroom persists anything.
Built-in review findings become threads only after validation and, by default,
explicit draft approval. Spotlight membership persists only to Spotlight
storage after plan approval. Teaching output is stored as workflow output and
can be promoted to threads by the user.

The Spotlight MCP tools are read-only in v1. External clients can inspect Views,
View-scoped diffs, and cross-View line membership, but Stage Manager write APIs
for creating or editing Views are intentionally not exposed through MCP yet.

The tool payloads mirror the HTTP API schemas in [API.md](API.md) and shared
types in `packages/schemas`. For section comments, keep `anchor` as the primary
display/navigation anchor and send `anchors` with every changed diff line the
thread should reference.

## Resources

The lists below are generated from the resource definitions in
`packages/mcp/src/resources.ts`. Regenerate them with `bun run docs:mcp`.

<!-- BEGIN GENERATED: mcp-resources (bun run docs:mcp) -->

The adapter advertises these concrete resources:

- `greenroom://concepts/review-model` - Small versioned overview of Greenroom review, revision, diff, and thread terms.
- `greenroom://concepts/anchors` - Small versioned overview of stable changed-line anchor keys.
- `greenroom://concepts/spotlight` - Small versioned overview of Spotlight Views and coverage.
- `greenroom://concepts/teaching` - Small versioned overview of Teaching draft outputs.

And these resource templates:

- `greenroom://reviews/{reviewId}/manifest` - Small review manifest with repository display metadata and resource map.
- `greenroom://reviews/{reviewId}/diff-summary` - Current revision diff summary without inline file hunks.
- `greenroom://reviews/{reviewId}/files` - Current revision changed-file summaries with path-scoped resource links.
- `greenroom://reviews/{reviewId}/files/{path}` - Current revision structured diff scoped to one changed file path.
- `greenroom://reviews/{reviewId}/anchors/{path}` - Stable changed-line anchor registry scoped to one file path.
- `greenroom://reviews/{reviewId}/threads` - Review thread summaries without direct mutation.
- `greenroom://reviews/{reviewId}/spotlight/views` - Spotlight Views with health state and associated files.
- `greenroom://reviews/{reviewId}/spotlight/coverage` - Current revision Spotlight coverage gaps as changed-line anchors.
- `greenroom://runs/{runId}/instructions` - Run-scoped harness instructions when orchestration endpoints are available.
- `greenroom://runs/{runId}/output-schema` - Run-scoped expected draft output contract when orchestration endpoints exist.
- `greenroom://runs/{runId}/consent-scope` - Run-scoped consent and approved scope when orchestration endpoints exist.
- `greenroom://runs/{runId}/validation-errors` - Run-scoped validation issues when orchestration endpoints exist.
- `greenroom://threads/{threadRef}` - One thread with comments, addressed by global ref such as GT-12.
- `greenroom://spotlight/views/{viewRef}` - One Spotlight View with lit regions, addressed by global ref such as SV-3.
- `greenroom://spotlight/views/{viewRef}/diff` - Current structured diff scoped to one Spotlight View.
- `greenroom://reviews/{reviewId}/handoff?threadRefs={threadRefs}` - Selected-thread handoff bundle with anchors, comments, and snippets.

<!-- END GENERATED: mcp-resources -->

For handoff resources, pass comma-separated thread refs, for example:

```text
greenroom://reviews/GR-1/handoff?threadRefs=GT-1,GT-4
```

Threads and Spotlight Views resolve by global ref alone:

```text
greenroom://threads/GT-12
greenroom://spotlight/views/SV-3
greenroom://spotlight/views/SV-3/diff
```

## First AI-Assisted Review

1. Start Greenroom with `bun run greenroom -- up` (or Docker Compose).
2. Create a token with `read`, `comment:write`, and optionally
   `thread:resolve` — the Settings → Connections "Connect a coding agent"
   card mints one and emits the matching client config.
3. Register a local repository and create or open a review.
4. Configure the external MCP client with one of the configs above.
5. Ask the client to call `greenroom_list_reviews` for open reviews, then
   `greenroom_get_diff` and `greenroom_get_existing_threads` for the target
   review; fetch one full thread by global ref with `greenroom_get_thread`.
6. If Spotlight Views exist, call `greenroom_get_spotlight_views` and
   `greenroom_get_view_diff` to review one intent-coherent lens at a time.
7. Let the client create attributed threads or replies through the MCP tools.
8. For a fix handoff, call `greenroom_create_handoff` with selected thread refs
   such as `GT-1`, then report the attempt with `greenroom_report_attempted_fix`.

MCP-compatible clients can discover Greenroom's current workflow prompts with
`prompts/list` and retrieve their executable text with `prompts/get`.
