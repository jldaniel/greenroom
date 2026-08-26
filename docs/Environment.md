# Environment And Configuration

Greenroom configuration has three layers, applied per key:

1. **Built-in defaults** — sensible loopback-only values; a fresh install
   needs no configuration at all.
2. **`greenroom.toml` config file** — non-secret runtime settings (ports,
   bridge location, path maps, workflow limits) in the app data dir. See
   [Configuration File](#configuration-file) for the key reference.
3. **Environment variables** — reserved for secrets and per-process
   overrides. An env var that is set always wins over the file value.

Precedence per key: **environment variable > config file > built-in
default**. An env var that is set but empty is treated as unset and falls
through to the file value, with one exception: an empty
`GREENROOM_HARNESS_BASE_URL` explicitly disables the harness bridge and wins
over a `bridge.baseUrl` file value.

Caveat: the config file is consumed by the API server process only.
The host harness bridge (`packages/harness`) and the standalone MCP server
(`packages/mcp`) read their own environment variables directly; `pathMaps` is
resolved into `GREENROOM_HARNESS_PATH_MAP_JSON` in the server's resolved
environment, but a separately launched bridge process must still receive its
environment variables explicitly.

## App Data Root

Greenroom stores durable application state outside reviewed repositories. The
default app data root is resolved in this order:

1. `GREENROOM_DATA_DIR`, when set (must be a directory, not a SQLite file).
2. On macOS: `$HOME/Library/Application Support/Greenroom`.
3. On Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/greenroom`.

Windows is not a first-class target. Development and tests should prefer a
temporary `GREENROOM_DATA_DIR` instead of writing to a real user data
directory.

The app data root contains:

- `greenroom.sqlite` - the SQLite database (override with `GREENROOM_DB_PATH`).
- `greenroom.toml` - optional config file (override with `GREENROOM_CONFIG_PATH`).
- `api-token.json` - the admin token bootstrapped by `greenroom up`.
- `harness-bridge-token.json` - the persisted bridge token `greenroom up`
  auto-provisions (mode 0600).
- `harness/` - bridge state, currently detected CLI versions
  (`harness-versions.json`).
- `harness-workspaces/` - supervised bridge parent directory for per-run
  read-only repository snapshots.
- `tools/` - Greenroom-managed harness installs (`greenroom harness
install-pi` installs into `tools/pi`).
- `backups/` - default destination for `greenroom db backup`.
- `runtime-state.json` - supervised-service state written by `greenroom up`.
- `logs/`, `tmp/` - optional runtime logs and disposable temp files.

## Configuration File

Non-secret runtime configuration lives in `greenroom.toml` in the app data
root (default `$GREENROOM_DATA_DIR/greenroom.toml`; override the path with
`GREENROOM_CONFIG_PATH`). Docker deployments mount the same file into the
container's data directory (see `docs/Docker.md`).

A missing config file is fine; all defaults apply. A malformed or invalid
file fails server startup with an error naming the offending key and the
problem. The file is validated strictly: unknown keys are rejected, which
catches typos.

Secrets never belong in the file. The bridge token is referenced indirectly:
`bridge.tokenEnv` names an environment variable that holds the token, or
`bridge.tokenFile` points at a file whose contents are the token. A literal
`token` key in the file is rejected with an actionable error. If `tokenEnv`
names a variable that is not set, the bridge simply stays disabled (matching
env-only behavior); an unreadable or empty `tokenFile` fails startup.

Supported keys and their environment-variable equivalents:

| Config file key                         | Env var equivalent                                     | Default                                                 |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `server.host`                           | `GREENROOM_HOST`                                       | `127.0.0.1`                                             |
| `server.port`                           | `GREENROOM_PORT`                                       | `49331`                                                 |
| `server.logLevel`                       | `GREENROOM_LOG_LEVEL`                                  | `info`                                                  |
| `server.allowedOrigins`                 | `GREENROOM_ALLOWED_ORIGINS`                            | Loopback origins                                        |
| `server.setupTokenEndpoint`             | `GREENROOM_SETUP_TOKEN_ENDPOINT`                       | `auto`                                                  |
| `server.databasePath`                   | `GREENROOM_DB_PATH`                                    | `$GREENROOM_DATA_DIR/greenroom.sqlite`                  |
| `server.webDist`                        | `GREENROOM_WEB_DIST`                                   | Unset (API does not serve the web app)                  |
| `mcp.host`                              | `GREENROOM_MCP_HOST`                                   | `127.0.0.1`                                             |
| `mcp.port`                              | `GREENROOM_MCP_PORT`                                   | `49332`                                                 |
| `bridge.baseUrl`                        | `GREENROOM_HARNESS_BASE_URL`                           | Unset (bridge disabled)                                 |
| `bridge.tokenEnv` / `bridge.tokenFile`  | `GREENROOM_HARNESS_TOKEN` (reference, never the value) | Unset                                                   |
| `bridge.timeoutMs`                      | `GREENROOM_HARNESS_TIMEOUT_MS`                         | See `docs/Harness.md` → Timeouts                        |
| `pathMaps` (array of `{from, to}`)      | `GREENROOM_HARNESS_PATH_MAP_JSON`                      | `[]`                                                    |
| `workflows.maxConcurrentRuns`           | `GREENROOM_WORKFLOW_MAX_CONCURRENT_RUNS`               | `1`                                                     |
| `workflows.idleTimeoutMs`               | `GREENROOM_WORKFLOW_IDLE_TIMEOUT_MS`                   | See `docs/Harness.md` → Timeouts                        |
| `workflows.absoluteTimeoutMs`           | `GREENROOM_WORKFLOW_ABSOLUTE_TIMEOUT_MS`               | See `docs/Harness.md` → Timeouts                        |
| `workflows.maxMcpResourceReads`         | `GREENROOM_WORKFLOW_MAX_MCP_RESOURCE_READS`            | Unset                                                   |
| `workflows.maxRepairAttempts`           | `GREENROOM_WORKFLOW_MAX_REPAIR_ATTEMPTS`               | `2`                                                     |
| `workflows.transcripts.enabled`         | `GREENROOM_TRANSCRIPTS_ENABLED`                        | Enabled                                                 |
| `workflows.transcripts.maxAgeDays`      | `GREENROOM_TRANSCRIPTS_MAX_AGE_DAYS`                   | `30`                                                    |
| `workflows.transcripts.maxTotalBytes`   | `GREENROOM_TRANSCRIPTS_MAX_TOTAL_BYTES`                | `52428800` (50 MiB)                                     |
| `observability.tracingEnabled`          | `GREENROOM_TRACING_ENABLED`                            | Disabled                                                |
| `observability.otlpEndpoint`            | `GREENROOM_OTLP_ENDPOINT`                              | None                                                    |
| `observability.serviceName`             | `GREENROOM_TRACING_SERVICE_NAME`                       | `greenroom-server`                                      |
| `observability.langchainTracingEnabled` | `GREENROOM_LANGCHAIN_TRACING_ENABLED`                  | Disabled                                                |
| `observability.workflowLogsEnabled`     | `GREENROOM_WORKFLOW_LOGS_ENABLED`                      | Disabled unless path is set                             |
| `observability.workflowLogPath`         | `GREENROOM_WORKFLOW_LOG_PATH`                          | `$GREENROOM_DATA_DIR/logs/workflows.jsonl` when enabled |

Notes on individual keys:

- `server.setupTokenEndpoint` controls unauthenticated `POST
/api/setup/tokens` minting: `auto` enables it only when the bind host is a
  loopback address, where the local client is treated as the trusted operator.
  While enabled, after the first token exists minting additionally requires
  the requesting client address to be loopback. On non-loopback binds the
  endpoint is disabled and a pre-provisioned token is required (see
  `GREENROOM_BOOTSTRAP_ADMIN_TOKEN` under [Secrets](#secrets)).
- The `observability` keys record redacted tracing status/endpoint
  configuration in workflow-local observability records; the
  dependency-light implementation does not require or install an OTLP,
  LangChain, or LangSmith package. The standard `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
  and `OTEL_EXPORTER_OTLP_ENDPOINT` env vars are recognized as fallbacks when
  `GREENROOM_OTLP_ENDPOINT` is unset.
- Workflow logs are redacted local JSONL records written outside reviewed
  repositories; setting `observability.workflowLogPath` (or the env var)
  implies enablement.
- `workflows.idleTimeoutMs` is the stalled-activity timeout and
  `workflows.absoluteTimeoutMs` is the hard cap for a whole run.

The Settings page in the web UI edits the editable subset of this file
(server host/port, MCP port, bridge base URL/token reference/timeout, and
workflow idle/absolute limits) through `GET`/`PUT /api/config/file` (`admin`
scope). Saving
rewrites the file with a regenerated layout, so hand-written comments are not
preserved. The file is read at server boot; saved changes require a restart.
Keys currently overridden by env vars are flagged in the UI because the file
edit will not take effect until the env var is unset.

Example:

```toml
[server]
port = 49331

[bridge]
baseUrl = "http://127.0.0.1:49343"
tokenEnv = "GREENROOM_HARNESS_TOKEN"

[workflows]
maxConcurrentRuns = 2
idleTimeoutMs = 300000
absoluteTimeoutMs = 3600000

[observability]
tracingEnabled = true
otlpEndpoint = "http://127.0.0.1:4318/v1/traces"
```

The loader lives in `apps/server/src/config/file.ts` and exports the zod
schema, the resolved file path, and an annotated default template.

## Secrets

Secrets are environment-only. They never belong in `greenroom.toml`, profile
fields, prompts, workflow metadata, or reviewed repository files, and runtime
code must not persist them to SQLite.

| Variable                          | Purpose                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GREENROOM_API_TOKEN`             | Existing API token. For the CLI: used by the supervised API and authenticated `status`/`token create` probes (otherwise the token bootstrapped by `up` is read from `api-token.json`). For the MCP adapter: the stdio token only; the HTTP MCP endpoint ignores it and requires callers to send bearer headers. |
| `GREENROOM_BOOTSTRAP_ADMIN_TOKEN` | Admin token value registered at API startup (min 24 chars, idempotent). Use it to bootstrap auth on non-loopback binds, where the setup-token endpoint is disabled.                                                                                                                                             |
| `GREENROOM_HARNESS_TOKEN`         | Bearer token shared by the API (client side) and the bridge job API (`POST /runs`, `GET /runs/:id`, `DELETE /runs/:id`). `greenroom up` generates and persists one automatically; set it only to pair with an external bridge.                                                                                  |
| `VITE_GREENROOM_API_TOKEN`        | Browser API bearer token injected at build/dev time instead of Settings-page browser storage.                                                                                                                                                                                                                   |
| Pi provider API keys              | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, and friends, forwarded by the bridge to the Pi harness subprocess. See `docs/Harness.md` → "Pi Fallback".                                                                                                                                              |

Defense in depth: before workflow errors, event summaries, event metadata,
bridge diagnostics, transcripts, and local workflow logs are persisted or
logged, Greenroom redacts `Authorization`/`Bearer` values, Greenroom
`grt_...` capability tokens, common provider key prefixes such as `sk-...`,
configured secret-like environment values, and secret-like metadata keys.
Harness transcripts (prompt, output, stderr) are persisted per run after
redaction, bounded by the `workflows.transcripts.*` retention caps, purgeable
from Settings or `POST /api/workflow-transcripts/purge`, and skipped for
profiles with `privacy.persistTranscript: false` (see `docs/Harness.md` →
Privacy). Do not rely on the redactor: keep credentials out of those inputs
in the first place.

## Environment Overrides

Every key in the [Configuration File](#configuration-file) table can be
overridden by its env var equivalent; those are not repeated here. The
variables below are env-only (no config file key).

Paths:

| Variable                | Purpose                            | Default                              |
| ----------------------- | ---------------------------------- | ------------------------------------ |
| `GREENROOM_DATA_DIR`    | App data root directory.           | Platform app data path               |
| `GREENROOM_CONFIG_PATH` | `greenroom.toml` config file path. | `$GREENROOM_DATA_DIR/greenroom.toml` |

`greenroom` CLI supervisor (see `docs/CLI.md`):

| Variable              | Purpose                                                                 | Default                            |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `GREENROOM_REPO_ROOT` | Repo root override used to locate the workspaces the supervisor spawns. | Checkout containing `packages/cli` |
| `GREENROOM_BUN_PATH`  | Bun executable path for supervised child processes.                     | The running `bun`                  |

Supervised child processes inherit the parent environment, so harness bridge
variables and Pi provider API keys should be exported before `greenroom up`
when those workflows are needed. Setting `GREENROOM_HARNESS_BASE_URL` before
`up` opts out of bridge supervision entirely (see `docs/CLI.md` → "Harness
bridge supervision").

API-side harness client:

| Variable                       | Purpose                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GREENROOM_DEFAULT_AI_BACKEND` | Optional fresh-DB profile seeding override: `mock`, or `harness:<kind>` (e.g. `harness:claude-code`). Unset/empty (the default): profiles are seeded from harness detection at first startup; when nothing is detected, mock profiles are seeded with a description explaining why. Unknown values are ignored, so detection applies. |

The direct OpenAI Responses adapter and its `OPENAI_API_KEY` variable are not
supported; all AI runs go through the harness bridge.

Host harness bridge process (environment-only; `greenroom up` sets the
starred ones automatically):

| Variable                                       | Purpose                                                                                                                                                | Default                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `GREENROOM_HARNESS_HOST`                       | Bridge bind host.                                                                                                                                      | `127.0.0.1`                                  |
| `GREENROOM_HARNESS_PORT`                       | Bridge port.                                                                                                                                           | `49343`                                      |
| `GREENROOM_HARNESS_STATE_DIR` \*               | Directory for small bridge state files, currently detected harness CLI versions (`harness-versions.json`). Unset keeps detection state in memory only. | None (`up`: `<data dir>/harness`)            |
| `GREENROOM_HARNESS_TOOLS_DIR` \*               | Directory probed for Greenroom-managed harness installs (the Pi fallback).                                                                             | None (`up`: `<data dir>/tools`)              |
| `GREENROOM_HARNESS_KIND`                       | Default named harness kind, for example `claude-code`.                                                                                                 | None                                         |
| `GREENROOM_HARNESS_ENABLED_KINDS`              | Comma-separated enabled harness kinds. Defaults to `GREENROOM_HARNESS_KIND` when set.                                                                  | Empty                                        |
| `GREENROOM_HARNESS_COMMAND`                    | Advanced override executable. Takes precedence over named presets.                                                                                     | None                                         |
| `GREENROOM_HARNESS_ARGS_JSON`                  | JSON array of command args. Supports `{schemaPath}`, `{schemaJson}`, `{promptPath}`, `{cwd}`, and `{outputPath}` placeholders.                         | `[]`                                         |
| `GREENROOM_HARNESS_PATH_MAP_JSON`              | JSON array of `{ "from": containerPath, "to": hostPath }` mappings.                                                                                    | `[]`                                         |
| `GREENROOM_HARNESS_ENV_ALLOWLIST`              | Comma-separated extra env vars forwarded to the harness process.                                                                                       | Empty                                        |
| `GREENROOM_HARNESS_TIMEOUT_MS`                 | Bridge default subprocess backstop when the run request omits `timeoutMs`; API workflow liveness is controlled by idle/absolute settings.              | See `docs/Harness.md` → Timeouts             |
| `GREENROOM_HARNESS_MAX_STDERR_CHARS`           | Maximum stderr tail returned in bridge execution metadata.                                                                                             | `8000`                                       |
| `GREENROOM_HARNESS_MAX_STDOUT_CHARS`           | Hard cap on harness stdout captured by the bridge; runaway output is truncated instead of buffered unboundedly.                                        | `4000000`                                    |
| `GREENROOM_HARNESS_KILL_GRACE_MS`              | Grace period between the SIGTERM sent to the harness process group on timeout and the SIGKILL escalation.                                              | `5000`                                       |
| `GREENROOM_HARNESS_SNAPSHOT_ENABLED`           | Global bridge switch for repository snapshot workspaces. Set `false` to disable snapshot capability even when a workspace directory is configured.     | `true`                                       |
| `GREENROOM_HARNESS_WORKSPACE_DIR` \*           | Parent directory for per-run read-only repository snapshot workspaces. Unset disables snapshot workspace preparation until explicitly configured.      | None (`up`: `<data dir>/harness-workspaces`) |
| `GREENROOM_HARNESS_WORKSPACE_STALE_GRACE_MS`   | Age after which bridge startup/reaper logic may remove stale archive workspaces.                                                                       | `86400000`                                   |
| `GREENROOM_HARNESS_WORKSPACE_MAX_ACTIVE`       | Maximum active snapshot workspaces allowed by the bridge.                                                                                              | `16`                                         |
| `GREENROOM_HARNESS_WORKSPACE_MAX_BYTES`        | Maximum total bytes reserved for bridge snapshot workspaces.                                                                                           | `5368709120`                                 |
| `GREENROOM_PI_MODEL` / `GREENROOM_PI_PROVIDER` | Pi model/provider selection; see `docs/Harness.md` → "Pi Fallback".                                                                                    | Inferred from API keys                       |

Standalone MCP server processes (environment-only):

| Variable                 | Purpose                             | Default                  |
| ------------------------ | ----------------------------------- | ------------------------ |
| `GREENROOM_API_BASE_URL` | API origin used by the MCP adapter. | `http://127.0.0.1:49331` |
| `GREENROOM_MCP_HOST`     | HTTP MCP bind host.                 | `127.0.0.1`              |
| `GREENROOM_MCP_PORT`     | HTTP MCP port.                      | `49332`                  |

Browser development:

| Variable                      | Purpose                                            | Default                  |
| ----------------------------- | -------------------------------------------------- | ------------------------ |
| `GREENROOM_API_PROXY_TARGET`  | Vite dev proxy target for `/api` and `/health`.    | `http://127.0.0.1:49331` |
| `VITE_GREENROOM_API_BASE_URL` | Absolute API origin when bypassing the Vite proxy. | Same-origin `/api`       |

Advanced harness setup-status overrides (API process; rarely needed):

- `GREENROOM_HARNESS_CLI_PATHS_JSON` — JSON object mapping harness kind to an
  explicit CLI path, e.g. `{"claude-code": "/opt/claude"}`. Per-kind variants
  also exist: `GREENROOM_HARNESS_<KIND>_PATH` (e.g.
  `GREENROOM_HARNESS_CLAUDE_CODE_PATH`, `GREENROOM_HARNESS_CODEX_PATH`), plus
  the external `CLAUDE_CODE_PATH`/`CODEX_PATH` fallbacks.
- `GREENROOM_HARNESS_SKILLS_DIR` (or `GREENROOM_HARNESS_<KIND>_SKILLS_DIR`) —
  override where the Greenroom skill package is installed for a harness CLI;
  by default it derives from the CLI's home (`CLAUDE_CONFIG_DIR` or
  `~/.claude` for Claude Code, `CODEX_HOME` or `~/.codex` for Codex). See
  `docs/Harness.md` → "Greenroom Skill Package".

## Repository Mutation Defaults

Reviewed repositories are treated as read-only inputs:

- Do not commit, merge, rebase, tag, push, publish, or apply patches in
  reviewed repositories, and do not create repo-local Greenroom state such as
  `.greenroom/`, generated files, caches, logs, or temp files there.
- Git operations read local refs, commits, status, and diffs with explicit
  repository paths and without shell interpolation. Temporary Git
  repositories created by tests as disposable fixtures are exempt.
- Agent and MCP integrations follow the same rule: they may report attempted
  fixes or create review comments through the local API, but they must not
  mutate project code through Greenroom-owned behavior.
- Any feature that needs a write inside a reviewed repository must document
  the user-facing opt-in, the exact files it may write, and the rollback
  behavior before implementation.
