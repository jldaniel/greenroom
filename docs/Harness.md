# Harness Backend

Greenroom can use a local coding harness as the backend for Teaching,
Spotlight, and built-in AI review. The API calls a host-side HTTP bridge; the
bridge spawns the user's installed harness CLI and returns schema-bound JSON.

## CLI-First Development

For normal development, start the supervised runtime (see `docs/CLI.md`):

```sh
bun run greenroom -- up
```

`greenroom up` starts and supervises the harness bridge, local API, and HTTP
MCP server, and serves the web app. It generates (and persists) a bridge
token, starts the bridge process, and passes the matching
`GREENROOM_HARNESS_BASE_URL`/`GREENROOM_HARNESS_TOKEN` pair to the API — no
manual env matching or separate bridge terminal. See `docs/CLI.md` → "Harness
bridge supervision". You should be able to open Settings, register a
repository, and create a review without manually starting `server:dev`,
`web:dev`, or the MCP HTTP server; the Settings "App status" panel shows
per-service health from `GET /api/runtime/status`.

Harness-backed profiles need a bridge. Setting `GREENROOM_HARNESS_BASE_URL`
(and `GREENROOM_HARNESS_TOKEN`) in the environment before `greenroom up` opts
out of bridge supervision and keeps your own user-managed bridge. If no
bridge is configured, repository registration, review creation, MCP reads,
mock profiles, and non-harness workflows still work; harness workflow
approval is blocked until the bridge is reachable.

## Supported Harness Kinds

| Kind          | CLI      | Status                                                                                                                                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claude-code` | `claude` | Full workflow support (Teaching, Spotlight, built-in review) through the bridge preset.                                                                                                                      |
| `pi`          | `pi`     | Full workflow support; Greenroom-managed install available (see [Pi Fallback](#pi-fallback-managed-install)).                                                                                                |
| `codex`       | `codex`  | Full workflow support through an isolated, ephemeral, read-only Codex app-server session with run-scoped Greenroom MCP access.                                                                             |

The mock provider needs no bridge at all and is seeded automatically when no
harness CLI is detected.

## Advanced Bridge Mode

Running the bridge manually is only needed for standalone setups (for example
a bare `server:dev` without the supervisor, or a bridge on another host);
`greenroom up` otherwise handles it.

Claude Code preset (`harness:claude` sets `GREENROOM_HARNESS_KIND=claude-code`):

```sh
export GREENROOM_HARNESS_TOKEN="$(openssl rand -hex 24)"
bun run harness:claude
```

Then start the API with the matching token:

```sh
GREENROOM_HARNESS_BASE_URL=http://127.0.0.1:49343 \
GREENROOM_HARNESS_TOKEN=<same-token> \
bun run server:dev
```

For Docker Compose, use `http://host.docker.internal:49343` as the API-side
base URL and configure `GREENROOM_HARNESS_PATH_MAP_JSON` on the bridge so
container paths such as `/worktrees/project` map to host paths.

Check readiness through the API:

```text
GET /api/harness/status
```

Advanced raw command mode remains available by setting
`GREENROOM_HARNESS_COMMAND` and `GREENROOM_HARNESS_ARGS_JSON`; raw command env
takes precedence over named presets.

## Harness CLI Detection

At startup (and on demand) the bridge probes for installed harness CLIs — the
same binaries the harness kind presets invoke (`claude` for `claude-code`,
`codex` for `codex`, `pi` for `pi`), resolved against the same PATH the bridge
forwards to spawned harness processes. For the `pi` kind, the Greenroom-managed
install (`<data dir>/tools/pi/node_modules/.bin/pi`, probed when
`GREENROOM_HARNESS_TOOLS_DIR` is set — `greenroom up` sets it to
`<data dir>/tools`) is checked before the user PATH. Each probe runs the CLI's
version command with a short timeout; a missing binary, non-zero exit, or
timeout is reported as not-found without ever crashing the bridge.

Detection is exposed on the bridge as an authenticated endpoint:

- `GET /harnesses` — detected CLIs with `found`, resolved `path`, `version`,
  `probedAt`, and re-smoke recommendation fields. Add `?refresh=true` to force
  a fresh probe instead of the cached startup snapshot.
- `POST /harnesses/{kind}/smoke` — records a successful smoke run: the
  currently detected version becomes the verified version for that kind.

The API passes detection through `GET /api/harness/status` as a
`detectedHarnesses` array (kind, label, command, found, path, version,
`lastVerifiedVersion`, `recommendSmoke`, probedAt, message). When the bridge is
unconfigured, unreachable, or predates detection, `detectedHarnesses` is empty
and the existing `configured`/`healthy` behavior is unchanged.

### Version Tracking And Re-Smoke Recommendation

The bridge persists the last verified version per harness kind in
`harness-versions.json` under `GREENROOM_HARNESS_STATE_DIR` (`greenroom up`
sets this to `<data dir>/harness`; without a state dir the bridge tracks
versions in memory for the lifetime of the process). The first time a CLI is
seen, its version is recorded as the baseline. When a later probe detects a
different version, the payload reports `recommendSmoke: true` together with
the old (`lastVerifiedVersion`) and new (`version`) values until a successful
smoke run is recorded through `POST /harnesses/{kind}/smoke`.

`POST /api/harness/setup-smoke` runs a real smoke test: alongside host-side
CLI and skill checks, it launches a minimal harness run through the bridge
(structured stdout, no MCP access, no repository access, OS temp dir as the
working directory) and reports `status: "passed"` only when the harness
returns a valid `setup_smoke_report`. A passed smoke automatically calls the
bridge's `POST /harnesses/{kind}/smoke` endpoint, marking the detected CLI
version verified and clearing the re-smoke recommendation. The CLI and skill
checks are informational — a containerized API with a host-side bridge can
pass the smoke even when the CLI is not visible to the API process.

## Pi Fallback (Managed Install)

Greenroom's AI backend is harness-first: your installed Claude Code or Codex
subscription is the default. For users without one, **Pi** is the API-key
fallback: a small open-source coding agent CLI
([`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent),
bin `pi`) that talks to model providers directly with an API key.

Install the Greenroom-managed copy:

```sh
greenroom harness install-pi
```

This installs the pinned version (`@mariozechner/pi-coding-agent@0.73.1`, see
`piNpmPinnedVersion` in `packages/schemas/src/harness.ts`) into
`<data dir>/tools/pi` via `bun add`, without touching your global environment
or PATH. Detection probes the managed binary first, so the bridge finds it on
the next `greenroom up`. When `greenroom up` detects no harness CLI at all, it
prints a one-line hint pointing at this command, and the web app's first-run
setup wizard shows it as a copyable fallback with a re-check button
(`docs/CLI.md` → "First run"). Re-running the command
refreshes the install in place; a `pi` already on your PATH is used as a
fallback when no managed install exists.

### API keys and model selection

Pi reads provider API keys from the environment. Export one before starting
`greenroom up` — the bridge forwards these variables to the Pi subprocess:

- `ANTHROPIC_API_KEY` (or `ANTHROPIC_OAUTH_TOKEN`) — Anthropic
- `OPENAI_API_KEY` — OpenAI
- `GEMINI_API_KEY` — Google
- Also forwarded: `GOOGLE_CLOUD_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`,
  `DEEPSEEK_API_KEY`, `ZAI_API_KEY`

Model selection, in precedence order:

1. `GREENROOM_PI_MODEL` — full model pattern, e.g.
   `anthropic/claude-sonnet-4-5`.
2. `GREENROOM_PI_PROVIDER` — provider name; Pi picks that provider's default
   model.
3. Otherwise Greenroom infers the provider from whichever API key variable is
   set (Anthropic, then OpenAI, then Google, then the rest in the order
   above).

Any additional environment variables a run needs can be forwarded with the
general `GREENROOM_HARNESS_ENV_ALLOWLIST` mechanism.

### How Pi runs differ from Claude Code

Pi has no MCP client and no `--json-schema` flag, so the `pi` preset runs
`pi -p --mode json --no-session` with the prompt on stdin, appends the output
JSON schema to the system prompt, and parses the schema-bound draft from Pi's
structured stdout (the final assistant message of the JSONL event stream).
Built-in tools are limited to the read-only set (`read`, `grep`, `find`, `ls`)
for MCP-scoped runs and disabled entirely otherwise — the bridge already
discards output whenever a run mutates the repository. Pi participates in the
same detection, version-tracking, and setup-smoke wiring as the other kinds
(`POST /harnesses/pi/smoke`, `/api/harness/setup-smoke` with `kind: "pi"`).

## Greenroom Skill Package

Greenroom ships a harness skill package (`packages/harness/skills/greenroom`,
version pinned in `packages/schemas/src/harness.ts`) that teaches a harness
CLI the Greenroom workflow rules: concept primer, MCP usage, anchor rules,
output examples, repair behavior, and read-only safety.

- Claude Code and Codex use `managed_package` mode: the API can check and
  install the skill into the CLI's skills directory —
  `~/.claude/skills/greenroom` for Claude Code (`CLAUDE_CONFIG_DIR` respected)
  and `~/.codex/skills/greenroom` for Codex (`CODEX_HOME` respected); override
  with `GREENROOM_HARNESS_SKILLS_DIR` or a per-kind
  `GREENROOM_HARNESS_<KIND>_SKILLS_DIR`.
- Pi uses `inline_prompt` mode: it receives the Greenroom instructions inline
  with each run's prompt, so there is nothing to install.

Endpoints: `GET /api/harness/skills/{kind}` reports the skill status
(`current`, `outdated`, `missing`, `unsupported`, or `unknown` with
diagnostics) and `POST /api/harness/skills/{kind}/install` (admin scope)
installs or refreshes it. The Settings harness panel surfaces the same
check-and-install action per detected CLI.

## Profiles

Create profiles with `provider: "harness"` and one of these workflow types:

- `teaching`
- `spotlight`
- `builtin_review`

The `model` field selects the model used for the run. Non-secret harness
settings, including the optional reasoning level, go under `modelSettings.harness`:

```json
{
  "harness": {
    "kind": "claude-code",
    "reasoningLevel": "high",
    "idleTimeoutMs": 300000
  }
}
```

Settings loads model choices from `GET /api/harness/models/:kind`. Pi and
Codex report their installed/account model catalogs live; Claude Code uses a
Greenroom-maintained alias catalog because the CLI does not expose a stable
machine-readable model-list command. Reasoning choices update when the model
changes. Leaving reasoning at **Harness default** omits the override.

Profiles with `model` equal to their harness kind (`claude-code`, `pi`, or
`codex`) use the harness default model.

Codex runs use the existing file-based CLI login when `auth.json` is present.
Trusted automation may instead provide `CODEX_ACCESS_TOKEN`; Greenroom forwards
it only to the isolated Codex app-server process.

Do not store harness auth or API keys in profile fields.

Tracing can be enabled per profile with `contextPreferences.tracingEnabled` or
`contextPreferences.tracing.enabled`. Tracing remains redacted and disabled by
default; endpoint/exporter configuration is still driven by environment
variables documented in `docs/Environment.md`.

On a fresh database, default profiles are seeded from harness detection at
first API startup: the API asks the bridge which harness CLIs are installed
(short timeout) and seeds Teaching, Spotlight, and built-in AI
review profiles for every detected kind (for example `Default teaching
(Claude Code)`). When no CLI is detected — or the bridge is disabled or
unreachable — mock Teaching and Spotlight profiles are seeded instead, with a
description explaining why and how to switch to a harness. A database that
contains only that mock fallback retries harness seeding on the next startup,
so installing a harness CLI and restarting `greenroom up` upgrades to harness
profiles automatically.

To skip detection, set an explicit override before first startup:

```sh
GREENROOM_DEFAULT_AI_BACKEND=harness:claude-code   # or harness:<kind>, or mock
```

## Built-In Review

Built-in review is a durable workflow-run path:

1. `POST /api/reviews/:reviewId/builtin-review/consent` builds the exact
   consent summary and changed-file scope. With `"start": true` (one-click
   consent, the default profile mode) the same request also approves the
   consent and calls the bridge; profiles with
   `privacy.consentMode: "two_step"` reject `start` and require step 2.
2. `POST /api/builtin-review/runs/:runId/approve` calls the bridge
   (two-step mode).
3. The API validates every finding and anchor key.
4. By default, valid findings wait for draft approval (in both consent modes).
5. `POST /api/builtin-review/runs/:runId/approve-draft` creates normal
   Greenroom threads with `builtin_reviewer` source attribution.

Unknown anchor keys, invalid output, subprocess failure, timeout, or repository
fingerprint changes fail the run without creating threads from invalid output.

Profiles can explicitly enable automatic thread creation with
`contextPreferences.autoCreateThreads: true`. The default remains
draft-approval gated.

## Spotlight And Teaching

Spotlight and Teaching use the same MCP-first harness contract:

- Spotlight outline/refine workflows produce validated draft View outlines.
- Spotlight membership workflows persist validated View membership to Spotlight
  storage only after approved plan context.
- Teaching generate workflows persist structured output in `workflow_runs`.
- Teaching follow-up workflows reuse the original approved scope and return a
  scoped answer.

Large reviews are passed to harnesses as summaries and MCP resource/tool
instructions. Prompts instruct the harness to use path-scoped MCP reads instead
of embedding the full diff.

## Operational Safeguards

Harness-backed workflows use the generic workflow orchestrator. Approved runs
are queued when the active run count reaches
`GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS` (default `1`). Each run also has an
API-side timeout budget; see [Timeouts](#timeouts).

### Startup Recovery

On server startup the orchestrator reconciles runs left behind by a previous
process. Runs persisted as `queued` never started executing, so they are
re-enqueued as before. Runs persisted as `running` or `repairing` lost their
in-process execution state and cannot be resumed; they are failed through the
normal failure path — an "interrupted by a server restart" error message, a
`failure` run event, and an audit record — so the UI shows a terminal state,
and they remain retryable through the normal retry endpoint. Their run-scoped
MCP grant tokens are revoked as part of that failure. Startup also revokes any
grant whose run already reached a terminal state without a recorded
revocation, and every run-scoped grant carries a hard expiry derived from the
run's absolute timeout budget (see [MCP.md](MCP.md#mcp-first-draft-tools)), so
no read-scope credential can outlive its run even without a restart.

### Repair Loop

When harness output fails validation with recoverable issues, the orchestrator
generates a repair prompt and retries, up to `GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS`
(config file key `workflows.maxRepairAttempts`, default `2`; `0` disables the
loop). A workflow definition's own `repairPolicy` overrides the configured
limit. Repair progress is first-class run status: the run record's metadata
carries `repairAttemptCount`, `maxRepairAttempts`, and a `repairAttempts`
history with the issue codes that triggered each attempt (derive it with
`workflowRunRepairProgressFromMetadata` from `@greenroom/schemas`), each
`repair_attempt` run event reports "attempt N of M", and
`GET /api/workflow-runs/:runId/diagnostics` returns `repairAttempts` plus
`maxRepairAttempts`. The web run-status display renders
"Repairing output — attempt N of M" with the per-attempt issue codes while a
repair is in progress and after the run finishes.

### Timeouts

Timeout defaults are documented here and only here; other docs point at this
section.

| Setting                                                                  | Scope                                                                                                                                       | Default                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `workflows.idleTimeoutMs` / `GREENROOM_WORKFLOW_IDLE_TIMEOUT_MS`         | API-side idle timeout. If no activity is observed for this long, the orchestrator aborts the run with an idle-timeout failure.              | `300000`                               |
| `workflows.absoluteTimeoutMs` / `GREENROOM_WORKFLOW_ABSOLUTE_TIMEOUT_MS` | API-side absolute backstop for a whole workflow run, even if activity keeps arriving.                                                       | `3600000`                              |
| Profile `modelSettings.harness.idleTimeoutMs`                            | Optional per-profile idle timeout override for harness-backed runs.                                                                         | Harness kind default, usually `300000` |
| `GREENROOM_HARNESS_TIMEOUT_MS` (bridge process)                          | Bridge-local subprocess backstop when a request omits `timeoutMs`; not the primary run liveness control.                                    | `3600000`                              |
| `GREENROOM_HARNESS_TIMEOUT_MS` (API process)                             | Default requested bridge subprocess timeout when a workflow run request omits `timeoutMs`; short control requests still use a 10s HTTP cap. | `3600000`                              |

Observed activity updates last-activity telemetry when the API receives harness
stream events, run-scoped MCP resource reads, or `greenroom_report_progress`
calls. The orchestrator fails a run whose observed activity stalls for longer
than the idle timeout, uses the absolute cap as the hard backstop, and passes
that cap to the bridge as `timeoutBudgetMs` on every harness run request. The
bridge still applies its own subprocess timeout and kill escalation, but fixed
per-invocation budgets are no longer the primary control for long reviews.

When a workflow times out, diagnostics report `budget_exceeded` and include the
last observed activity summary and age. Idle age remains visible so a quiet run
can be diagnosed without treating silence alone as failure.

When a bridge-side run times out, the bridge sends `SIGTERM` to the harness
process group (harness CLIs are spawned detached into their own group), waits
`GREENROOM_HARNESS_KILL_GRACE_MS`, then escalates to `SIGKILL` so
signal-ignoring children cannot outlive the run. Captured stdout/stderr are
hard-capped (`GREENROOM_HARNESS_MAX_STDOUT_CHARS`,
`GREENROOM_HARNESS_MAX_STDERR_CHARS`), so a runaway child cannot grow bridge
memory without bound.

When a run cannot launch the harness bridge, the workflow fails with an
actionable message that points to the current step and `GET /api/harness/status`.
Additional recorded MCP resource reads can be capped with
`GREENROOM_WORKFLOW_MAX_MCP_RESOURCE_READS`; progress reports are separately
rate-limited per run so a chatty harness cannot flood the event log.

## Repository Snapshot Workspaces

Harness profile settings include `modelSettings.harness.repositoryAccessMode`.
The default is `mcp_only`, which keeps code/context reads routed through the
Greenroom MCP contract. `snapshot_readonly` is an explicit opt-in for committed
revisions: it allows the bridge to prepare an isolated read-only view of tracked
repository files at the approved `headSha`. Worktree or uncommitted revisions
remain MCP-only.

Archive workspaces are prepared with `git archive` under
`GREENROOM_HARNESS_WORKSPACE_DIR`; `greenroom up` sets this to
`<data dir>/harness-workspaces`. The archive contains tracked files at the
approved commit, omits untracked/ignored local files, and does not mutate the
source repository's `.git` metadata. The bridge records a
`.greenroom-workspace.json` marker in each workspace so cleanup and stale
reaping can identify Greenroom-owned directories. Stale archive workspaces are
eligible for removal after `GREENROOM_HARNESS_WORKSPACE_STALE_GRACE_MS`; caps
are configured with `GREENROOM_HARNESS_WORKSPACE_MAX_ACTIVE` and
`GREENROOM_HARNESS_WORKSPACE_MAX_BYTES`.

Snapshot execution has an operational kill switch. Set
`GREENROOM_HARNESS_SNAPSHOT_ENABLED=false` on the bridge to stop advertising
repository snapshot capability; the API client will reject new snapshot runs
before sending their request payload. Rolling back to MCP-only behavior also
works by changing harness profiles back to `mcp_only`.

Preset tool policy follows the same access mode. In `mcp_only`, Claude Code
and Pi built-in filesystem tools are disabled and the process runs from a
non-repository temp directory. In `snapshot_readonly`, Claude Code gets only
read/list/search built-ins and Pi gets `read,grep,find,ls`; write, edit, bash,
and mutation tools remain unavailable.

## Privacy

The API sends the bridge a per-run MCP token but does not persist the plaintext
token. Workflow events, run errors, bridge diagnostics, harness stderr tails,
and optional workflow JSONL logs are redacted before server-side persistence or
logging. Redaction covers `Authorization` and `Bearer` values, Greenroom
`grt_...` tokens, common provider key prefixes, configured secret-like
environment values, and secret-like metadata keys.

Harness transcripts are persisted by default. Every bridge run stores the
redacted prompt, final harness output, and stderr tail in
SQLite, keyed to the workflow run. Normalized harness stream events are also
persisted incrementally while the run is active, so timeout, crash, and cancel
diagnostics can show partial output captured before the child was stopped.
Redaction runs before persistence, each field is truncated at a hard per-field
cap, and the store is bounded by configurable retention caps
(`workflows.transcripts.{enabled,maxAgeDays,maxTotalBytes}` in `greenroom.toml`,
or the matching `GREENROOM_TRANSCRIPTS_*` env vars) that evict the oldest
transcripts and stream events first. Full transcripts are readable per run via
`GET /api/workflow-runs/{runId}/transcripts`; normalized harness events are
readable through `GET /api/workflow-runs/{runId}/events?since=0` and streamable
from the same route with `stream=1`. All transcript data can be purged with
`POST /api/workflow-transcripts/purge` or the Settings "Run transcripts"
control. Profiles opt out by setting `privacy.persistTranscript: false`, which
skips both final transcript and incremental event persistence for their runs.

## Troubleshooting

- `GET /api/harness/status` shows `configured: false`: set both
  `GREENROOM_HARNESS_BASE_URL` and `GREENROOM_HARNESS_TOKEN` in the API (or
  `greenroom up`) process environment.
- `healthy: false`: confirm the bridge process is running, the API can reach the
  bridge URL, and the bridge token values match.
- `availableKinds` is empty: confirm the requested CLI is installed on the host
  and visible to the bridge process.
- `detectedHarnesses` shows `found: false` for an installed CLI: the binary is
  not on the PATH the bridge process sees, or its version command failed — the
  entry's `message` carries the probe diagnostic.
- `recommendSmoke: true`: the detected CLI version differs from the last
  verified version; run a setup smoke test for that harness kind (see
  [Harness CLI Detection](#harness-cli-detection)).
- Workflow approval returns "Provider harness is not configured": the profile is
  harness-backed but the API started without bridge environment variables.
- Workflow fails after launch: inspect workflow events and redacted workflow
  logs. Common causes are invalid structured output, unknown anchor keys,
  timeout, bridge subprocess failure, or repository fingerprint changes.
- Docker path mismatches: set `GREENROOM_HARNESS_PATH_MAP_JSON` on the host
  bridge so container worktree paths map to host filesystem paths.
