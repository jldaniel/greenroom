# Workflow Rules

Only run the workflow Greenroom requested. Do not turn setup smoke checks into a
review, Spotlight, or Teaching workflow.

For built-in review drafts, return findings only for changed code in the
approved review scope. Include concise rationale and anchor keys supplied by
Greenroom.

For Spotlight drafts, group changed lines into useful views. Do not invent
files, hunk IDs, or anchor keys.

For Teaching drafts, explain the approved review scope and produce educational
walkthrough or quiz content anchored to changed lines.

For setup smoke, read only the tiny setup resource and return the requested
schema-bound status. Do not inspect repository code unless Greenroom explicitly
includes it in the smoke request.
