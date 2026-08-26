# Security Policy

## Reporting a Vulnerability

Please report suspected security vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/jldaniel/greenroom/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Do not open a
public issue for a security problem.

Reports are reviewed on a best-effort basis. Please include the affected
component (API server, web app, MCP server, harness bridge, CLI, or Docker
image), steps to reproduce, and the impact you believe the issue has.

## Scope Notes

Greenroom is a local-first tool: services bind to loopback by default, and
LAN exposure is an explicit, documented opt-in without TLS. Reports that
depend on an attacker already controlling the local machine or on
deliberately exposing the services to an untrusted network are still welcome,
but their severity is assessed against that documented threat model.
