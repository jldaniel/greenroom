# Anchor Rules

Use only anchor keys supplied by Greenroom. Never synthesize an anchor key from
file names or line numbers unless Greenroom's prompt explicitly defines that
format for the current run.

Anchor output must target changed lines or changed hunks in the approved
revision. Prefer the narrowest anchor that supports the finding or explanation.

If a desired point has no valid anchor, put it in a non-finding summary or
return a validation-friendly omission instead of inventing an anchor.

When a repair pass says an anchor is invalid, replace it with a valid supplied
anchor or remove that draft item.
