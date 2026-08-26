# Docker

Docker is Greenroom's production deployment path alongside the `greenroom up`
CLI (see `docs/CLI.md`). One container runs everything the browser needs: the
HTTP API, the static web app served same-origin from the API process, and the
HTTP JSON-RPC MCP endpoint. AI harnesses (Claude Code, Codex, Pi) stay on the
host next to your existing CLI installs and auth; the container reaches them
through a host-side bridge.

## Quickstart: Build and Run from Source

Building from a clone is the currently available path: no pre-built image is
published yet. From the repository root, the default `compose.yaml` builds
the production image and runs the single service:

```sh
docker compose up --build        # or: bun run compose:up
```

Open `http://localhost:49331`. The first-run wizard creates your API token and
walks through registering a repository (use container paths such as
`/worktrees/<name>`) and setting up AI profiles. Both published ports bind to
`127.0.0.1`, so nothing is reachable from other machines (see
[LAN Exposure](#lan-exposure-opt-in)).

Endpoints:

| Endpoint          | Host URL                     |
| ----------------- | ---------------------------- |
| Web app + API     | `http://localhost:49331`     |
| MCP HTTP JSON-RPC | `http://localhost:49332/mcp` |

Stop with `docker compose down` (`bun run compose:down`); reset the data
volume and rebuild with `bun run compose:fresh`.

Useful compose variables:

| Variable                          | Default          | Purpose                                                                                                                                |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GREENROOM_PUBLISH_HOST`          | `127.0.0.1`      | Host interface ports are published on. See LAN caveats before changing.                                                                |
| `GREENROOM_API_HOST_PORT`         | `49331`          | Published web + API port.                                                                                                              |
| `GREENROOM_MCP_HOST_PORT`         | `49332`          | Published MCP HTTP port.                                                                                                               |
| `GREENROOM_DATA_VOLUME`           | `greenroom-data` | Named volume or host directory mounted at `/data`.                                                                                     |
| `GREENROOM_WORKTREE_VOLUME`       | `.`              | Code root mounted read-only at `/worktrees`.                                                                                           |
| `GREENROOM_SETUP_TOKEN_ENDPOINT`  | `enabled`        | First-token bootstrap endpoint; disable for LAN exposure.                                                                              |
| `GREENROOM_BOOTSTRAP_ADMIN_TOKEN` | unset            | Admin token pre-provisioned at startup (required for LAN on a fresh DB).                                                               |
| `GREENROOM_HARNESS_BASE_URL`      | unset            | API-side URL of a host harness bridge; also settable in `greenroom.toml`.                                                              |
| `GREENROOM_HARNESS_TOKEN`         | unset            | Bearer token shared with the host harness bridge.                                                                                      |
| `GREENROOM_API_TOKEN`             | unset            | Existing API token for the supervised API and stdio MCP adapter. Not used by the HTTP MCP endpoint (callers must send bearer headers). |
| `GREENROOM_DEFAULT_AI_BACKEND`    | unset            | Fresh-DB profile seeding override (`mock` or `harness:<kind>`).                                                                        |

Unset variables stay unset inside the container, so values from the mounted
config file apply (see [Data and Configuration](#data-and-configuration)).

## Published Image (Future)

No pre-built container image exists yet. `ghcr.io/jldaniel/greenroom` is a
future artifact: the publication workflow
(`.github/workflows/docker-publish.yml`) will build it for linux/amd64 and
linux/arm64 with semver tags (`1.2.3`, `1.2`) plus `latest` when a GitHub
Release is published. Once a first release exists, running the published
image without a clone will look like this (replace `~/code` with the
directory that holds your repositories):

```yaml
services:
  greenroom:
    image: ghcr.io/jldaniel/greenroom:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:49331:49331"
      - "127.0.0.1:49332:49332"
    volumes:
      - ./greenroom-data:/data
      - ~/code:/worktrees:ro
```

Until then, build from source as described above.

## Production Image

`Dockerfile` is a multi-stage build. The `build` stage installs the full
workspace with dev dependencies and runs the Vite production build of the web
app; the `runtime` stage carries only production dependencies, the API and MCP
sources, and the built web bundle. A single container runs both the API (which
serves the static web app same-origin, per `GREENROOM_WEB_DIST`) and the MCP
HTTP endpoint through `apps/server/src/container.ts` — no Vite dev server and
no process supervisor.

```sh
docker build -t greenroom:local .
docker run --rm \
  -p 127.0.0.1:49331:49331 -p 127.0.0.1:49332:49332 \
  -v greenroom-data:/data \
  greenroom:local
```

Measured image size: 374MB (`docker images greenroom:local`, Bun 1.3.14
Debian slim base plus git, linux/arm64, 2026-07-01).

The image pins `GREENROOM_HOST=0.0.0.0` (Docker must be able to publish the
ports) and the internal ports `49331`/`49332`; remap with publish specs rather
than env vars. Git inside the container trusts mounted repositories
(`safe.directory=*`) and runs with `GIT_OPTIONAL_LOCKS=0`, so read operations
never take optional locks or refresh repository metadata — required for the
read-only `/worktrees` mount. The image carries OCI labels for the source
repository, description, and MIT license.

## Code Root Mount

The compose file mounts one host directory — your code root — read-only at
`/worktrees`:

```sh
GREENROOM_WORKTREE_VOLUME=/Users/you/code docker compose up --build
```

Register repositories in the web UI with container paths such as
`/worktrees/project`. Because the whole root is mounted, a new project cloned
under it later is immediately visible at `/worktrees/<name>` — register it in
the UI without restarting or reconfiguring the container.

The mount is read-only (`:ro`) because reviewed repositories are inputs
Greenroom never mutates; the container can never write into your code, and
Git read operations run with `GIT_OPTIONAL_LOCKS=0` so they do not try to
refresh repository metadata on the read-only filesystem.

From a clone the default code root is the repository itself, so `/worktrees`
can be registered to review Greenroom.

## Data and Configuration

`/data` (the `greenroom-data` volume by default) holds everything durable:

- `greenroom.sqlite` — the database, created and migrated on startup.
- `greenroom.toml` — the config file. On first start the container writes a
  fully commented template that changes no behavior.

Edit the config through the web Settings page (`Configuration file` panel) or
directly on the volume:

```sh
docker compose exec greenroom cat /data/greenroom.toml
# or, with a host directory: GREENROOM_DATA_VOLUME=/absolute/path
```

Precedence per key is env var > config file > built-in default. Keys the image
pins by env var (bind hosts, internal ports, `server.webDist`) cannot be
changed from the file; bridge settings, path maps, workflow limits, and
observability keys can. The file is read at startup — restart the container
after editing (`docker compose restart`).

## First API Token

With loopback publishing, the browser bootstraps its own token through the
first-run wizard. To mint one manually:

```sh
curl -sS -X POST http://localhost:49331/api/setup/tokens \
  -H 'content-type: application/json' \
  -d '{"name":"Docker admin"}'
```

Use the returned `plaintextToken` for MCP requests and API calls.

## Host-Side Harness Bridge

Harness-backed reviews, Teaching, and Spotlight need a harness bridge process.
The image deliberately contains no harness CLI and no harness auth: the bridge
runs on the host, next to your Claude Code/Codex install (or a managed Pi),
and the containerized API calls it over `host.docker.internal` (the compose
file adds the `host-gateway` mapping so this also works on Linux).

1. Start the bridge on the host from a repository clone, with a shared token
   and a path map that translates container paths back to host paths:

   ```sh
   export GREENROOM_HARNESS_TOKEN="$(openssl rand -hex 24)"
   GREENROOM_HARNESS_KIND=claude-code \
   GREENROOM_HARNESS_PORT=49343 \
   GREENROOM_HARNESS_PATH_MAP_JSON='[{"from":"/worktrees","to":"/Users/you/code"}]' \
   bun run harness:dev
   ```

   `to` must match the host directory you mounted at `/worktrees`.

2. Point the container at the bridge. Either export the env pair before
   `docker compose up` (the compose file passes both through):

   ```sh
   GREENROOM_HARNESS_BASE_URL=http://host.docker.internal:49343 \
   GREENROOM_HARNESS_TOKEN="$GREENROOM_HARNESS_TOKEN" \
   docker compose up -d
   ```

   Or persist it in `/data/greenroom.toml` (the token is referenced, never
   inline — here via a file on the data volume):

   ```toml
   [bridge]
   baseUrl = "http://host.docker.internal:49343"
   tokenFile = "/data/harness-bridge-token"
   ```

3. Verify with `GET /api/harness/status`: it reports whether the API reaches
   the bridge and which harness CLIs were detected.

The bridge prompts harnesses not to mutate repositories and fails a run if the
repository's Git fingerprint changes during it. Repository registration,
review creation, MCP reads, and mock-profile workflows all work without a
bridge.

### Pi Fallback (API-key Users)

Without Claude Code or Codex, install the pinned, Greenroom-managed Pi coding
agent on the host and run the bridge against it:

```sh
bun run greenroom -- harness install-pi
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY, GEMINI_API_KEY, ...
export GREENROOM_HARNESS_TOKEN="$(openssl rand -hex 24)"
GREENROOM_HARNESS_KIND=pi \
GREENROOM_HARNESS_PATH_MAP_JSON='[{"from":"/worktrees","to":"/Users/you/code"}]' \
bun run harness:dev
```

Then point the container at the bridge as above. See `docs/Harness.md` for
`GREENROOM_PI_MODEL`/`GREENROOM_PI_PROVIDER` and detection details.

## MCP Endpoint

```text
POST http://localhost:49332/mcp
```

Send the Greenroom API token as a bearer token:

```sh
curl -sS http://localhost:49332/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $GREENROOM_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

All `tools/call` and non-concept `resources/read` requests must send a bearer
token; there is no fallback for header-less clients. Token-free discovery
(`initialize`, `tools/list`, concept resources) remains available.

## LAN Exposure (Opt-In)

Loopback-only is the default. Greenroom has no TLS and only
bearer-token auth, so publish beyond loopback only on a network you trust, and
always with the unauthenticated first-token bootstrap disabled and an admin
token pre-provisioned instead:

```sh
GREENROOM_PUBLISH_HOST=0.0.0.0 \
GREENROOM_SETUP_TOKEN_ENDPOINT=disabled \
GREENROOM_BOOTSTRAP_ADMIN_TOKEN="$(openssl rand -hex 24)" \
docker compose up -d
```

Enter the pre-provisioned token in the web Settings page on each device.
Outside Docker the API disables `POST /api/setup/tokens` automatically on
non-loopback bind hosts (`auto` mode); inside Docker the container must bind
`0.0.0.0` for port publishing, so the image pins the endpoint to `enabled` on
the assumption of loopback-only publish specs — which is why LAN exposure must
set `GREENROOM_SETUP_TOKEN_ENDPOINT=disabled` explicitly. See
`docs/Environment.md` for both variables.

## Development Compose

The pre-V2 development flow remains in `compose.dev.yaml`: three services
(API, Vite dev server with `/api` proxy, MCP) built from the Dockerfile's
`build` stage with the full source tree baked in.

```sh
bun run compose:dev:up      # docker compose -f compose.dev.yaml up --build
bun run compose:dev:down
bun run compose:dev:fresh   # reset the dev data volume and rebuild
```

The frontend serves at `http://localhost:5173` (`GREENROOM_WEB_HOST_PORT`),
and the API/MCP ports follow the same variables as the default file. Rebuild
after source changes — the image bakes in the tree. For day-to-day
development, prefer `greenroom up --dev` on the host.
