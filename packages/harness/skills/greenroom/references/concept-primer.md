# Concept Primer

Greenroom is a local-first review tool for AI-assisted code changes. A review
has a repository, a revision, structured diff files, anchored threads, optional
Spotlight views, and optional Teaching output.

Greenroom workflows do not ask the harness to write final application state.
The harness should inspect approved local context and return a draft that
matches the schema provided by Greenroom. Greenroom validates the draft and
persists only accepted results.

Important terms:

- Review: the local review object, often displayed as `GR-<number>`.
- Thread: an anchored review comment thread with a globally unique ref such as `GT-<number>`.
- Spotlight View: an intent-coherent review lens with a globally unique ref such as `SV-<number>`.
- Revision: the immutable structured diff snapshot for one review state.
- Anchor key: Greenroom's stable reference to a changed line or hunk.
- Draft output: schema-bound JSON submitted by the harness for validation.
- Repair: a follow-up pass that fixes validation issues without expanding scope.
