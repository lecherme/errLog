# Security Policy

## Reporting a vulnerability

This project does not yet have a formal external vulnerability-reporting channel. Do
not submit sensitive details through a public GitHub issue.

Until a real channel exists, the repository owner can address internally-discovered
issues through whatever private communication method they already use personally — this
is not an offer or instruction for external reporters, since no reporting channel is set
up for them yet.

Before this project is published or made available to external users, a real, usable
private reporting channel must be configured and this file updated with it. No email
address, platform, or SLA is given here because none exists yet.

## Do not include in a public issue or report

- Credentials or secrets of any kind.
- A child's identity or learning data.
- Real family photos.
- Any content from an original worksheet that may contain identifying or sensitive
  information.

## Response process

1. Once a real private reporting channel exists, receive external reports through that
   channel; an internally discovered issue enters this process through a private
   internal record. Until such a channel exists, external reporting is not yet
   available.
2. Acknowledge receipt.
3. Assess severity.
4. Fix.
5. Add a regression test covering the specific failure.
6. Release the fix.

This process is defined but not yet exercised or automated — there is no formal release
pipeline yet, stated plainly rather than implied.

## After a fix

Perform root-cause analysis for the class of issue, not just the specific instance, and
add regression coverage for that class.

## Status

This is an early-stage personal project. The rules above are the minimum workable
response process, not a validated production incident-response capability. This file
will be updated once a formal release process and reporting channel exist.
