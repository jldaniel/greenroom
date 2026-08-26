import type { Database } from "bun:sqlite";

export interface Migration {
  id: string;
  sql: string;
}

// Single schema-defining migration for the fresh-DB epoch. Greenroom is
// unreleased: no pre-epoch database survives, so this is generated from the
// drizzle schema (apps/server/src/db/schema.ts — the source of truth) rather
// than replayed history. Statements deliberately omit IF NOT EXISTS so an old
// database fails loudly instead of half-applying.
export const migrations: Migration[] = [
  {
    id: "0001_initial_schema",
    sql: `
CREATE TABLE repositories (
  id TEXT PRIMARY KEY NOT NULL,
  root_path TEXT NOT NULL,
  git_common_dir TEXT NOT NULL,
  identity_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_branch_candidate TEXT,
  spotlight_config TEXT NOT NULL,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX repositories_updated_at_idx ON repositories(updated_at);

CREATE TABLE review_prs (
  id TEXT PRIMARY KEY NOT NULL,
  display_id TEXT NOT NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  range TEXT NOT NULL,
  base_ref_display TEXT NOT NULL,
  head_ref_display TEXT NOT NULL,
  current_revision_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  spotlight_config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX review_prs_display_id_unique ON review_prs(display_id);
CREATE INDEX review_prs_repository_id_idx ON review_prs(repository_id);
CREATE INDEX review_prs_updated_at_idx ON review_prs(updated_at);

CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  base_sha TEXT NOT NULL,
  head_sha TEXT,
  worktree_fingerprint TEXT,
  diff_summary TEXT NOT NULL,
  refresh_reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX review_revisions_review_id_idx ON review_revisions(review_id);
CREATE INDEX review_revisions_created_at_idx ON review_revisions(created_at);

CREATE TABLE diff_files (
  id TEXT PRIMARY KEY NOT NULL,
  revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  old_path TEXT,
  status TEXT NOT NULL,
  is_binary INTEGER NOT NULL,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  old_mode TEXT,
  new_mode TEXT,
  rename_metadata TEXT
);

CREATE INDEX diff_files_revision_id_idx ON diff_files(revision_id);
CREATE INDEX diff_files_path_idx ON diff_files(path);

CREATE TABLE diff_hunks (
  id TEXT PRIMARY KEY NOT NULL,
  file_id TEXT NOT NULL REFERENCES diff_files(id) ON DELETE CASCADE,
  old_start INTEGER NOT NULL,
  old_lines INTEGER NOT NULL,
  new_start INTEGER NOT NULL,
  new_lines INTEGER NOT NULL,
  header TEXT NOT NULL,
  lines TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE INDEX diff_hunks_file_id_idx ON diff_hunks(file_id);
CREATE INDEX diff_hunks_sort_order_idx ON diff_hunks(file_id, sort_order);

CREATE TABLE threads (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  short_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT,
  source TEXT NOT NULL,
  anchor TEXT NOT NULL,
  anchors TEXT NOT NULL,
  remap_confidence REAL,
  outdated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX threads_short_ref_unique ON threads(short_ref);
CREATE INDEX threads_review_status_idx ON threads(review_id, status);

CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  parent_comment_id TEXT,
  author_kind TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT
);

CREATE INDEX comments_thread_id_idx ON comments(thread_id);
CREATE INDEX comments_sort_order_idx ON comments(thread_id, sort_order);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  workflow_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  model_settings TEXT NOT NULL,
  allowed_tools TEXT NOT NULL,
  context_preferences TEXT NOT NULL,
  privacy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE capability_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  expires_at TEXT
);

CREATE INDEX capability_tokens_revoked_at_idx ON capability_tokens(revoked_at);
CREATE INDEX capability_tokens_expires_at_idx ON capability_tokens(expires_at);

CREATE TABLE agent_events (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT REFERENCES review_prs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  thread_refs TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX agent_events_review_id_idx ON agent_events(review_id);
CREATE INDEX agent_events_created_at_idx ON agent_events(created_at);

CREATE TABLE spotlight_runs (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  trigger TEXT NOT NULL,
  gated INTEGER NOT NULL,
  status TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  approved_outline TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX spotlight_runs_review_id_idx ON spotlight_runs(review_id);
CREATE INDEX spotlight_runs_review_status_idx ON spotlight_runs(review_id, status);
CREATE INDEX spotlight_runs_created_at_idx ON spotlight_runs(created_at);

CREATE TABLE spotlight_views (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  display_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  intent TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  health TEXT NOT NULL,
  origin_run_id TEXT NOT NULL REFERENCES spotlight_runs(id) ON DELETE CASCADE,
  last_reconciled_revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX spotlight_views_display_ref_unique ON spotlight_views(display_ref);
CREATE INDEX spotlight_views_review_id_idx ON spotlight_views(review_id);
CREATE INDEX spotlight_views_review_order_idx ON spotlight_views(review_id, order_index);
CREATE INDEX spotlight_views_origin_run_id_idx ON spotlight_views(origin_run_id);

CREATE TABLE spotlight_view_regions (
  id TEXT PRIMARY KEY NOT NULL,
  view_id TEXT NOT NULL REFERENCES spotlight_views(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  old_path TEXT,
  anchors TEXT NOT NULL,
  remap_confidence REAL,
  stale INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX spotlight_view_regions_view_id_idx ON spotlight_view_regions(view_id);
CREATE INDEX spotlight_view_regions_file_path_idx ON spotlight_view_regions(file_path);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_kind TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  harness_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  consent_summary TEXT NOT NULL,
  approved_scope TEXT,
  draft_output TEXT,
  final_output TEXT,
  validation_issues TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX workflow_runs_review_id_idx ON workflow_runs(review_id);
CREATE INDEX workflow_runs_review_status_idx ON workflow_runs(review_id, status);
CREATE INDEX workflow_runs_status_idx ON workflow_runs(status);
CREATE INDEX workflow_runs_created_at_idx ON workflow_runs(created_at);

CREATE TABLE workflow_run_events (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES review_prs(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE(run_id, sequence_number)
);

CREATE INDEX workflow_run_events_run_id_idx ON workflow_run_events(run_id);
CREATE INDEX workflow_run_events_review_id_idx ON workflow_run_events(review_id);
CREATE INDEX workflow_run_events_timestamp_idx ON workflow_run_events(timestamp);

CREATE TABLE workflow_run_transcripts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  profile_id TEXT,
  workflow_kind TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  exit_code INTEGER,
  prompt TEXT NOT NULL,
  output TEXT,
  stderr TEXT NOT NULL DEFAULT '',
  redacted INTEGER NOT NULL DEFAULT 1,
  truncated INTEGER NOT NULL DEFAULT 0,
  prompt_bytes INTEGER NOT NULL DEFAULT 0,
  output_bytes INTEGER NOT NULL DEFAULT 0,
  stderr_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX workflow_run_transcripts_run_id_idx ON workflow_run_transcripts(run_id);
CREATE INDEX workflow_run_transcripts_created_at_idx ON workflow_run_transcripts(created_at);

CREATE TABLE workflow_run_harness_events (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  profile_id TEXT,
  workflow_kind TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  sequence_number INTEGER NOT NULL,
  event TEXT NOT NULL,
  redacted INTEGER NOT NULL DEFAULT 1,
  truncated INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence_number)
);

CREATE INDEX workflow_run_harness_events_run_id_idx ON workflow_run_harness_events(run_id);
CREATE INDEX workflow_run_harness_events_created_at_idx ON workflow_run_harness_events(created_at);

CREATE TABLE ref_counters (
  scope TEXT PRIMARY KEY NOT NULL,
  next_value INTEGER NOT NULL
);
`,
  },
];

export function runMigrations(sqlite: Database, migrationList: Migration[] = migrations): void {
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS greenroom_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const applied = new Set(
    sqlite
      .query<{ id: string }, []>("SELECT id FROM greenroom_migrations")
      .all()
      .map((row) => row.id),
  );

  const known = new Set(migrationList.map((migration) => migration.id));
  for (const id of applied) {
    if (!known.has(id)) {
      throw new Error(
        "This database was created by an incompatible pre-release version of Greenroom. Delete the Greenroom data directory and restart.",
      );
    }
  }

  for (const migration of migrationList) {
    if (applied.has(migration.id)) {
      continue;
    }

    sqlite.exec("BEGIN;");
    try {
      sqlite.exec(migration.sql);
      sqlite
        .query("INSERT INTO greenroom_migrations (id, applied_at) VALUES (?, ?)")
        .run(migration.id, new Date().toISOString());
      sqlite.exec("COMMIT;");
    } catch (error) {
      sqlite.exec("ROLLBACK;");
      throw error;
    }
  }
}

export function resetDatabase(sqlite: Database): void {
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  sqlite.exec(`
DROP TABLE IF EXISTS ref_counters;
DROP TABLE IF EXISTS agent_events;
DROP TABLE IF EXISTS capability_tokens;
DROP TABLE IF EXISTS workflow_run_transcripts;
DROP TABLE IF EXISTS workflow_run_harness_events;
DROP TABLE IF EXISTS workflow_run_events;
DROP TABLE IF EXISTS workflow_runs;
DROP TABLE IF EXISTS spotlight_view_regions;
DROP TABLE IF EXISTS spotlight_views;
DROP TABLE IF EXISTS spotlight_runs;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS diff_hunks;
DROP TABLE IF EXISTS diff_files;
DROP TABLE IF EXISTS review_revisions;
DROP TABLE IF EXISTS review_prs;
DROP TABLE IF EXISTS repositories;
DROP TABLE IF EXISTS greenroom_migrations;
`);
  sqlite.exec("PRAGMA foreign_keys = ON;");
}
