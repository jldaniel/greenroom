# Greenroom Documentation

Greenroom is a local-first review PR system for AI-assisted code changes: you
register local Git worktrees, create reviews, triage durable inline threads in
a browser workspace, and drive AI review, Spotlight, and Teach workflows
through the coding-agent harness you already have installed. The
[root README](../README.md) covers the feature tour, requirements, and
architecture; this page is the index to the detailed guides.

## Start here

- [Quickstart](Quickstart.md) — a guided, screenshot-heavy tour from first
  launch through every feature: setup wizard, review creation, diff
  workspace, threads, AI review, Spotlight, and Teach.

## Running Greenroom

- [CLI](CLI.md) — `greenroom` commands (`up`, `down`, `status`,
  `token create`, `harness install-pi`, `config`, `db backup`), the first-run
  wizard, web serving modes, bridge supervision, and runtime state.
- [Docker](Docker.md) — single-container deployment, volumes, the code root
  mount, the host-side harness bridge, and LAN exposure caveats.
- [Environment](Environment.md) — the `greenroom.toml` config file reference,
  secrets handling, and environment-variable overrides.

## Reviewing and triage

- [Git](Git.md) — Git assumptions, supported diff cases, untracked-file
  handling, and limits.
- [Threads](Threads.md) — thread states, triage filters, short refs like
  `GT-5`, severity, and source attribution.

## AI workflows

- [Harness](Harness.md) — harness detection, the managed Pi install for
  API-key users, AI profiles, workflow runs, timeouts, and privacy.
- [Teaching](Teaching.md) — the Teach page: consent flow, walkthroughs, the
  quiz, follow-up sessions, thread promotion, and persistence.

## Integration

- [MCP](MCP.md) — connecting external coding agents, token scopes, and the
  generated tool/resource tables.
- [API](API.md) — local API startup and endpoint details.
