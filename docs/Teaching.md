# Built-In Teaching

Greenroom teaching explains a review diff without mutating the reviewed
repository. It uses stored local profiles, an explicit per-run context consent
step, and the harness bridge (or the mock provider for tests and demos).
Teaching lives on its own full-page route at `/reviews/<reviewId>/teach`: the
review workspace's panel tab bar links to it, and the
Spotlight scope banner links to it with `?view=<viewRef>` (an `SV-n` ref) to preselect the
selected View. The page is an interactive session: a run-setup
sidebar next to the walkthrough with inline code/diff excerpts and diagram
blocks, an interactive quiz with scoring and missed-concept aggregation, and a
chat-style follow-up conversation.

## Profiles

Teaching profiles are stored in SQLite and never include API keys. On a fresh
database a default teaching profile is seeded at first API startup from
harness detection (see `docs/Harness.md` → seeding): one per detected harness
CLI (for example `Default teaching (Claude Code)`), or a mock `Default
teaching` profile with an explanatory description when no harness is
detected. A typical seeded profile:

- Name: `Default teaching (Claude Code)`
- Workflow: `teaching`
- Provider: `harness`
- Model: `claude-code`
- Privacy: `persistTranscript: true` (redacted transcript persistence; set
  `false` to opt out), `consentMode: "one_click"` (a single
  confirmation shows the scope and starts the run; set `"two_step"` to keep
  the strict create-then-approve flow, or `"trusted"` to start runs
  immediately without confirmation while still recording the consented scope)

Profiles can configure provider, model, model settings, system prompt, context
preferences, and privacy behavior from Settings.

## Scopes

The Teach page supports two primary scopes:

- Full PR: build teaching context from the current review revision.
- Spotlight View: build focused teaching context from one Spotlight View's lit
  regions, associated files, and surrounding hunk context.

Following the Spotlight scope banner's Teach link
(`/reviews/<reviewId>/teach?view=<viewRef>`) preselects the current View. The
consent summary for View-scoped teaching includes the scope kind, View title,
View health, revision, files, hunks/regions, approximate token count, and any
omitted files or regions.

## Providers

Direct provider-API adapters are not supported. There is no OpenAI Responses
adapter or `OPENAI_API_KEY` integration; all AI runs go through the harness
bridge. Greenroom does not store provider credentials
in SQLite, profile records, browser local storage, review metadata, or thread
comments.

The mock provider is available for local tests and demos without network calls.

The harness provider is available when `GREENROOM_HARNESS_BASE_URL` and
`GREENROOM_HARNESS_TOKEN` are set for the API. It uses the same consent flow as
other providers, then starts an MCP-first workflow run. The bridge runs the
configured local harness command with the user's host-side harness auth and
config. The harness receives a compact prompt, schema, and run-scoped MCP
configuration; it reads detailed context through Greenroom MCP resources and
submits a draft instead of receiving the full diff inline.

## Consent Flow

Teaching runs are consent-gated through
`POST /api/reviews/:reviewId/teaching/consent`, which builds the exact
context pack: review, revision, selected scope, files, hunks, approximate
token count, omitted files or regions, profile, provider, and model. How the
run starts depends on the profile's `privacy.consentMode`:

- **`one_click` (default).** The Teach page shows the scope in a single
  confirmation; confirming sends the consent request with `"start": true`,
  which approves the consent and starts the run in one call.
- **`two_step` (opt-in).** The consent request creates a `pending_consent`
  run and returns the context pack; no provider call happens until the
  browser approves with `POST /api/teaching/runs/:runId/approve`. Profiles in
  this mode reject `"start": true`.
- **`trusted` (per-profile opt-in).** Runs start immediately without a
  confirmation; the consented scope is still built and recorded.

The provider or harness workflow then returns structured teaching output.

Teaching runs are durable `workflow_runs` records regardless of provider;
Greenroom does not persist full provider transcripts by default.

## Teaching Output

Structured teaching output includes:

- change summary
- architecture explanation
- file/line walkthrough points
- quiz questions, choices, correct answers, explanations, and missed concepts
- optional Mermaid diagrams: a top-level `diagrams` array (at most 8) of
  `{ id, title, mermaidSource }` blocks, where `mermaidSource` is raw Mermaid
  text (no code fences, at most 6000 characters); a walkthrough point may
  reference one diagram through its `diagramId` field
- optional code/diff excerpt references: walkthrough points (`excerpts`, at
  most 4) and quiz questions (`excerpts`, at most 2) may carry references the
  UI resolves against the teaching context pack, each either
  `{ kind: "anchor", anchor }` with an anchor from the approved scope, or
  `{ kind: "lines", filePath, side, startLine, endLine }` with a changed-file
  path, `side` of `base` or `head` (default `head`), and a line range spanning
  at most 200 lines

All new fields are optional with defaults (`[]` / `null`), so teaching outputs
persisted before these fields existed still parse. Server-side draft
validation rejects duplicate diagram ids (`duplicate-diagram-id`), walkthrough
`diagramId` values that do not match a diagram (`unknown-diagram-id`), excerpt
anchors outside the approved scope (`anchor-outside-approved-scope`), and
line-range excerpts naming files outside the approved scope
(`excerpt-file-outside-scope`). Mermaid source is validated structurally only;
the browser renders it sandboxed and falls back to the raw source text when it
fails to parse or render (see Teach Page Session below).

## Teach Page Session

The Teach page (`components/teach/` in `apps/web`) renders the structured
output as an interactive session:

- Walkthrough: one card per teaching point. Each excerpt reference is resolved
  against the run's teaching context pack and rendered as an inline diff
  snippet (file/line header, add/remove/context line styling, old/new line
  numbers). References that do not resolve — for example a line range outside
  the diff hunks, which server-side validation does not catch —
  degrade to a muted "excerpt unavailable" note carrying the file and line
  label. A point with a `diagramId` shows its diagram adjacent to the point;
  diagrams no point references render in a trailing Diagrams section.
- Diagrams (`TeachingDiagramBlock` + `mermaidRenderer.ts`):
  `mermaidSource` renders as an actual Mermaid diagram. The Mermaid and
  DOMPurify libraries load lazily via dynamic `import()` on first diagram
  mount, so they stay out of the main bundle. Because `mermaidSource` is
  model-authored and only structurally validated server-side, it is
  treated as untrusted: Mermaid runs with `securityLevel: "strict"` and HTML
  labels disabled, and the produced SVG is sanitized with DOMPurify's SVG
  profile (forbidding `script`/`foreignObject`/embedding tags plus URL-bearing
  link attributes; DOMPurify strips event handlers by default) before it is
  inserted into the page — no model-authored HTML executes in the app origin.
  If the library fails to load, the source fails to parse or render, or
  sanitization strips the SVG root, the block falls back to the titled raw
  Mermaid source view with a muted "could not be rendered" note, contained per
  diagram (one bad diagram never breaks the walkthrough). The figure exposes
  `data-diagram-state="loading" | "rendered" | "fallback"` for tests.
- Quiz: all questions are visible with per-question choice selection.
  Selecting a choice locks the question and shows immediate right/wrong
  feedback with the explanation (wrong answers offer promote-to-thread for the
  missed concept). Once every question is answered, a score summary (N/M)
  appears with the aggregated concepts to revisit: `missedConcept` from each
  wrongly-answered question plus the output-level `missedConcepts`,
  deduplicated. Quiz answers are browser session state only.
- Follow-up Q&A: a chat-style conversation with the ask input pinned at the
  bottom. Questions render as user bubbles, answers as reply bubbles, an
  in-flight follow-up shows a pending bubble, and failures render inline in
  the conversation with a retry action.

Follow-up questions use the already approved run context:

```http
POST /api/teaching/runs/:runId/follow-up
```

For harness-backed runs, each follow-up is a scoped
`teaching_follow_up` workflow that reuses the original approved scope and
records workflow events without expanding context. For View-scoped teaching,
follow-ups stay within the approved Spotlight View context.

Answered follow-ups are durable for workflow-backed teaching runs: each one
records a `persistence` event on the original run with the question and
answer, and the Teach page rebuilds the conversation from that event log on
load (merged with any in-flight client entries). See Persistence Guarantees
below for the full restart contract.

## Persistence Guarantees

Workflow-backed teaching state survives API restarts (`greenroom down` /
`greenroom up`, container restarts) because it lives in SQLite rather than
process memory:

- Teaching runs: teaching generation and follow-ups are durable
  `workflow_runs` records. After a restart the run is still listed under
  `GET /api/reviews/:reviewId/workflow-runs` and fetchable with its structured
  output intact via `GET /api/teaching/runs/:runId`; the Teach page rehydrates
  the session from the review's latest `teaching_generate` run on load.
- Follow-up conversations: each answered follow-up records a `persistence`
  event `{ followUpWorkflowRunId, question, answer }` on the original run, so
  the conversation is reconstructable from
  `GET /api/workflow-runs/:runId/events` after a restart or reload. New
  follow-ups and promotions keep working against the reloaded run.
- Promoted threads: promotion creates ordinary anchored review threads, which
  follow the normal thread persistence rules and survive restarts.

Not persisted: quiz answers and scores (browser session state).

Coverage: `tests/teach-persistence.test.ts` restarts a real service stack over
the same SQLite file and asserts the run, event log, and promoted threads
survive (including a post-restart follow-up and promotion);
`tests/ui/teach-persistence.playwright.ts` reloads the Teach page against a
completed run with recorded follow-up events and exercises the rebuilt
conversation and promote-to-thread flow.

## Thread Promotion

Teaching output can be promoted into durable review threads:

```http
POST /api/reviews/:reviewId/teaching/promote
```

Promotion creates a normal anchored Greenroom thread with source kind
`teaching`. The anchor must still target a changed line in the current revision.
After promotion, the thread follows the same persistence, short-ref, reply, and
state-transition rules as human and MCP-created threads. Promotion titles are
capped at 240 characters by the API; the Teach page clamps longer titles (quiz
`missedConcept` values may reach 400 characters) with an ellipsis instead of
failing the promotion.

When a promoted point came from a Spotlight View-scoped run, the thread source
metadata stores the teaching run ID, Spotlight View ID, View title, and View
health. The thread remains review-global; Spotlight provenance does not create
per-View review state.
