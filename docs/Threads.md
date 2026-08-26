# Thread States And Triage Vocabulary

Greenroom review threads are durable, review-scoped comments anchored to one or
more changed diff lines in the current revision.

## Refs

Threads are numbered from one global sequence: `GT-1`, `GT-2`, and so on,
regardless of which review they belong to, and numbers are never reused. The
ref is stable for the life of the thread and is the preferred handle for MCP
tools, handoff notes, and human discussion; a thread can be fetched by ref
alone (`GET /api/threads/GT-12`) without knowing its review.

## States

- `open` - active and still needs attention.
- `resolved` - handled or intentionally accepted.
- `dismissed` - not actionable for this review, but preserved for history.

Resolved and dismissed threads can be reopened from the UI or API.

## Types

- `question` - asks for clarification or review context.
- `issue` - identifies behavior, correctness, security, or maintainability risk.
- `suggestion` - proposes an improvement without blocking progress.
- `note` - records context that should remain with the review.

## Severity

Severity is optional. Use it when a thread needs prioritization:

- `blocking` - should be addressed before the review is considered complete.
- `major` - important, but not necessarily blocking.
- `minor` - useful cleanup or localized risk.
- `nit` - small polish or consistency concern.

## Source Attribution

Thread sources display distinctly in the diff and panel:

- `human` - a local user comment.
- `mcp_client` - a connected MCP client.
- `external_agent` - an outside agent or reviewer integration.
- `teaching` - a promoted teaching or quiz point.
- `builtin_reviewer` - Greenroom's built-in AI reviewer.

Comments can also carry `system` authorship for generated system events.

## Anchors And Outdated Threads

Threads keep a primary `anchor` for display and navigation plus an `anchors`
array for the full selected line set. Single-line threads store one entry in
`anchors`; multi-line threads store each selected changed line.

Anchors target changed lines only: additions on the head side and deletions on
the base side. Context lines are displayed but cannot start a thread yet.

The `outdated` flag is reserved for Phase 6 refresh/remapping. Once refresh is
available, low-confidence remaps will remain visible as outdated threads and can
be filtered from the thread panel.

## Panel Filters

The review workspace thread panel supports these filters:

- `Open` - active open threads.
- `Current file` - open threads anchored in the selected file.
- `AI/external` - non-human sources such as MCP clients and external agents.
- `Question` - threads with type `question`.
- `Severity` - threads with any severity value.
- `Outdated` - threads marked outdated by revision remapping.
- `Dismissed` - dismissed threads.
