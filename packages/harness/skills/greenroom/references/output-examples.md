# Output Examples

Setup smoke response:

```json
{
  "kind": "setup_smoke_report",
  "status": "passed",
  "checks": [
    {
      "name": "mcp_resource",
      "status": "passed",
      "summary": "Read the non-secret Greenroom setup smoke resource."
    }
  ]
}
```

Built-in review draft shape:

```json
{
  "kind": "builtin_review_findings",
  "summary": "Reviewed the approved changed lines.",
  "findings": []
}
```

Spotlight membership draft shape:

```json
{
  "kind": "spotlight_membership",
  "memberships": [
    {
      "viewKey": "api-contract",
      "anchorKeys": ["anchor-key-from-greenroom"]
    }
  ]
}
```
