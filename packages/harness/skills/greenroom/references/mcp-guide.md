# MCP Guide

Greenroom MCP is the preferred context plane for built-in workflows. Use
Greenroom-provided MCP resources for review metadata, revision summaries, diff
content, anchor catalogs, validation feedback, and setup smoke resources.

Expected setup smoke resource:

```text
greenroom://setup/smoke
```

The smoke resource is intentionally non-secret. It should contain only a small
concept marker and expected response shape.

Do not persist MCP bearer tokens, headers, environment variables, provider API
keys, or raw transcripts. When diagnostics mention authorization, redact the
secret value and report only the missing or invalid setup step.
