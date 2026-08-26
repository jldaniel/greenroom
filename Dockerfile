# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: full workspace install (dev dependencies included) plus the
# Vite production build of the web app. compose.dev.yaml targets this stage
# (`target: build`) to run the Vite dev server and source-checkout services.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.0 AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies from manifests only, so source edits do not bust the
# dependency layer cache. Every workspace package.json referenced by bun.lock
# must be present.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/git/package.json packages/git/package.json
COPY packages/harness/package.json packages/harness/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/supervisor/package.json packages/supervisor/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.base.json tsconfig.browser.json tsconfig.bun.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY types ./types

RUN bun run --cwd apps/web build

# ---------------------------------------------------------------------------
# Runtime stage: production dependencies, server + MCP sources, and the built
# web bundle. One container serves the API (which serves the static web app),
# and the MCP HTTP endpoint via apps/server/src/container.ts.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.0-slim AS runtime

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/git/package.json packages/git/package.json
COPY packages/harness/package.json packages/harness/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/supervisor/package.json packages/supervisor/package.json
RUN bun install --frozen-lockfile --production

COPY apps/server ./apps/server
COPY packages ./packages
COPY --from=build /workspace/apps/web/dist ./apps/web/dist

# The container always binds 0.0.0.0 so Docker can publish its ports; keep the
# publish spec loopback-only (127.0.0.1:...) unless you have opted into LAN
# exposure per docs/Docker.md. GREENROOM_SETUP_TOKEN_ENDPOINT is pinned to
# "enabled" because the API cannot see the publish spec; set it to "disabled"
# and provide GREENROOM_BOOTSTRAP_ADMIN_TOKEN when publishing beyond loopback.
# Internal ports are fixed; remap them with the publish spec, not env vars.
ENV GREENROOM_DATA_DIR=/data \
  GREENROOM_HOST=0.0.0.0 \
  GREENROOM_PORT=49331 \
  GREENROOM_MCP_HOST=0.0.0.0 \
  GREENROOM_MCP_PORT=49332 \
  GREENROOM_WEB_DIST=/workspace/apps/web/dist \
  GREENROOM_SETUP_TOKEN_ENDPOINT=enabled \
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=* \
  GIT_OPTIONAL_LOCKS=0

# Override the title/url labels inherited from the oven/bun base image too.
LABEL org.opencontainers.image.title="Greenroom" \
  org.opencontainers.image.url="https://github.com/jldaniel/greenroom" \
  org.opencontainers.image.source="https://github.com/jldaniel/greenroom" \
  org.opencontainers.image.description="Local-first review PR system for AI-assisted code changes." \
  org.opencontainers.image.licenses="MIT"

VOLUME /data

EXPOSE 49331 49332

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 CMD [ \
  "bun", "-e", \
  "const response = await fetch(`http://127.0.0.1:${process.env.GREENROOM_PORT ?? '49331'}/health`); process.exit(response.ok ? 0 : 1);" \
  ]

ENTRYPOINT ["bun", "apps/server/src/container.ts"]
