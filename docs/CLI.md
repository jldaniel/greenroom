# Greenroom CLI

The `greenroom` CLI (`packages/cli`) runs the local Greenroom stack; the
browser is the only UI surface. Greenroom installs from source: clone the
repository, run `bun install` once, then run the CLI from the repository
root:

```sh
bun install
bun run greenroom -- <command>
```

## Commands

| Command              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `up`                 | Starts the harness bridge, API, and HTTP MCP server under one supervisor, bootstraps (or reuses) an admin API token plus a shared bridge token, prints the web UI URL, and stays in the foreground. By default the built web app is served statically by the API process; `--dev` runs the Vite dev server with HMR instead. Ctrl-C stops all services. Flags: `--data-dir`, `--dev`, `--host`, `--verbose`. |
| `down`               | Stops a running `up` instance found through the runtime state file; removes stale state files from crashed supervisors.                                                                                                                                                                                                                                                                                      |
| `status`             | Prints a per-service table (state, port, pid, URL) — including the supervised harness bridge — from the state file plus a live probe of `GET /api/runtime/status`. Exits nonzero when nothing is running. `--json` for machine output.                                                                                                                                                                       |
| `token create`       | Mints a capability token via `POST /api/tokens` on the running API, authenticated with the bootstrapped admin token. Flags: `--name`, `--scopes` (default `read,comment:write`).                                                                                                                                                                                                                             |
| `harness install-pi` | Installs the pinned Pi coding agent CLI (`@mariozechner/pi-coding-agent`) into the Greenroom-managed `<data dir>/tools/pi` directory via `bun add`, verifies the binary, and prints next steps (provider API key env var, optional `GREENROOM_PI_MODEL`). The bridge detects the managed install automatically; see `docs/Harness.md` → "Pi Fallback (Managed Install)".                                     |
| `config`             | Prints the resolved configuration: the `greenroom.toml` path and, per key, whether the effective value comes from an env var, the file, or a default. `--path` prints only the file path; `--json` prints the full resource.                                                                                                                                                                                 |
| `db backup [dest]`   | Snapshots the SQLite database using SQLite `VACUUM INTO` (via `bun:sqlite`, no external `sqlite3` needed), which is transactionally consistent while services run. Default destination: `<data dir>/backups/greenroom-backup-<timestamp>.sqlite`.                                                                                                                                                            |

Most commands accept `--data-dir`; otherwise `GREENROOM_DATA_DIR` or the
platform app-data default is used. `config` is the exception: it resolves
paths from the environment only (`GREENROOM_DATA_DIR`,
`GREENROOM_CONFIG_PATH`).

## First run

The first time a browser opens the web UI it has no stored API token. The app
probes the API without credentials, and when the probe answers 401 it routes
to the setup wizard (`/setup`) instead of raw error banners. The wizard walks
five steps — every step (and the whole wizard) is skippable, and it can be
re-run any time from Settings → "Run setup wizard":

1. **Token** — mints a browser token via the unauthenticated
   `POST /api/setup/tokens` endpoint and stores it in `localStorage`. The
   endpoint only works on loopback binds, and after the first token exists
   (the `greenroom up` supervisor bootstraps one at startup) only for clients
   connecting from a loopback address. A localhost client is treated as the
   trusted operator, so one-click minting stays available
   after bootstrap. The wizard shows a paste-a-token input with a
   `greenroom token create --name "Browser" --scopes admin` hint when the
   endpoint answers 403 (non-loopback bind or non-loopback client).
2. **Repository** — registers a local Git worktree with the same form used on
   the dashboard; existing repositories count as done.
3. **Harness** — shows the CLIs detected by the bridge (found/version, per
   kind) and offers the non-blocking setup smoke check. When no harness CLI
   is found it shows the copyable `greenroom harness install-pi` fallback and
   a re-check button (see `docs/Harness.md`).
4. **Profiles** — summarizes the profiles seeded from detection, with their
   descriptions; editing happens in Settings.
5. **First review** — hands off to the regular review-creation page or
   finishes on the dashboard.

Completion/skip state is persisted in the browser (`localStorage`), so the
wizard only auto-launches again when the app genuinely has no working token.

Outside the wizard, any page whose requests answer 401 while the browser has
no stored token shows the same one-click "Create access token" action (with a
link back to `/setup` and paste-a-token guidance when minting is refused)
instead of raw error banners. When a stored browser token is rejected —
revoked or stale — the app keeps an honest error and offers an explicit
"Reconnect" action that mints a replacement; it never swaps tokens silently.

## Web app serving modes

`greenroom up` serves the web app in one of two modes:

- **Static (default).** The API process serves the built SPA from
  `apps/web/dist` (env `GREENROOM_WEB_DIST`, config key `server.webDist`):
  static assets by path, `index.html` for client-side routes, JSON 404s for
  unknown `/api/*` paths, and resolved-path prefix checks against directory
  traversal. The one printed URL is the API origin and the browser calls
  `/api` same-origin, so no proxy or CORS configuration is involved. When
  `apps/web/dist/index.html` is missing, `up` runs `bun run web:build` once
  before starting. An existing build is trusted as-is; rerun
  `bun run web:build` (or delete `apps/web/dist`) to pick up web changes.
- **Dev (`--dev`).** Spawns the Vite dev server with HMR as a separate `web`
  service and prints its URL; Vite proxies `/api` and `/health` to the API
  process as before.

In static mode there is no separate web process: the state file and
`greenroom status` report the `web` service as `running` with the message
`static (served by api)`, no pid, and the API origin as its URL.

## Harness bridge supervision

`greenroom up` also supervises the harness bridge (`packages/harness`), so no
separate bridge terminal or manual token wiring is needed:

- On start, `up` resolves a bridge bearer token: an explicit
  `GREENROOM_HARNESS_TOKEN` env var wins; otherwise the token persisted in
  `<data dir>/harness-bridge-token.json` is reused; otherwise a random token is
  generated and persisted there (0600) so restarts keep the same token.
- The bridge process is spawned on `GREENROOM_HARNESS_PORT` (default `49343`,
  falling back to a free port when busy) and the API process receives a
  matching `GREENROOM_HARNESS_BASE_URL`/`GREENROOM_HARNESS_TOKEN` pair, so
  `GET /api/harness/status` works out of the box.
- The bridge starts in its default mode without a harness kind selected;
  set `GREENROOM_HARNESS_KIND` (for example `claude-code`) in the environment
  before `up` to enable a specific harness CLI. `up` never fails just because
  no harness CLI is installed; when detection finds none at all, it prints a
  one-line hint suggesting `greenroom harness install-pi` (the managed
  API-key fallback) without blocking or prompting.
- At startup the bridge probes for installed harness CLIs (`claude`, `codex`,
  `pi` — including the managed Pi install under `<data dir>/tools/pi`)
  and records their versions in `<data dir>/harness/harness-versions.json`
  (the supervisor passes `GREENROOM_HARNESS_STATE_DIR`). `GET
/api/harness/status` reports the detected CLIs as `detectedHarnesses`, and a
  CLI version change since the last verified version flags
  `recommendSmoke: true`; see `docs/Harness.md` → "Harness CLI Detection".
- **Explicit env wins.** If `GREENROOM_HARNESS_BASE_URL` is set in the
  environment, `up` does not spawn a bridge and the API uses your value as-is
  (with your `GREENROOM_HARNESS_TOKEN`); set it to an empty string to disable
  the bridge entirely. Note that env vars take precedence over a
  `greenroom.toml` `[bridge]` section for the supervised API — use the env
  vars to point `up` at an external bridge.

The bridge appears as a `bridge` row in `greenroom status` and in
`GET /api/runtime/status` like any other supervised service.

## Runtime state and the status endpoint

`greenroom up` writes `runtime-state.json` (supervisor PID, ports, URLs,
per-service status) into the app data dir on every service status change.
`down` and `status` read it, and the API exposes it to authenticated clients as
`GET /api/runtime/status` (per service: name, state, port, pid, lastExit) so
the Settings "App status" panel can display supervised service health. A
state file whose supervisor PID is no longer alive is reported as
stale/not running.

## Environment variables

- `GREENROOM_DATA_DIR` — app data dir (state file, token file, SQLite DB).
- `GREENROOM_API_TOKEN` — explicit API token for the supervised API and the
  `status`/`token create` probes. Without it, the token bootstrapped by `up`
  is read from `api-token.json` in the data dir.
- `GREENROOM_REPO_ROOT`, `GREENROOM_BUN_PATH` — override workspace root and
  bun binary used to spawn services (defaults: the checkout containing
  `packages/cli`, and the running `bun`).
- `GREENROOM_HARNESS_BASE_URL`, `GREENROOM_HARNESS_TOKEN`,
  `GREENROOM_HARNESS_PORT`, `GREENROOM_HARNESS_KIND` — harness bridge
  overrides; see [Harness bridge supervision](#harness-bridge-supervision).

## End-to-end acceptance test

`bun run test:cli` runs `tests/cli.acceptance.test.ts`: it spawns the real
`greenroom up` process tree against a temp data dir and a temp git
repository, drives the first-run wizard flow at the API level (setup token →
repository → harness detect/smoke → seeded profiles → first review), then
executes a one-click built-in AI review through the supervised bridge using a
mock harness command (`GREENROOM_HARNESS_COMMAND` pointed at a script that
plays back a staged findings draft) and asserts the drafted findings become a
review thread after draft approval. The test is excluded from the default
`bun run test:unit` glob because it starts real processes and may build the
web app once.
