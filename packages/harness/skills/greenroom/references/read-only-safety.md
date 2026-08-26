# Read-Only Safety

Greenroom-owned workflows are read-only unless Greenroom explicitly supplies a
draft submission tool for the active run.

Do not edit files, run formatters, create commits, change Git state, install
packages, or call external network services as part of review, Spotlight,
Teaching, or setup smoke.

Do not store credentials, provider keys, bearer tokens, cookies, raw prompts, or
full transcripts. Diagnostics should name the missing capability or failed
setup step without exposing secret values.
