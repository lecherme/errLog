# NIST SSDF Risk-Informed Practice Mapping

## Scope and disclaimer

This is a risk-informed mapping of relevant NIST SSDF practices onto this project's
existing workflow — it is not a second development process, and it does not claim NIST
certification, full compliance, or complete coverage. A practice named here is not
automatically "implemented" merely by being documented.

## Status definitions

- **planned**: exists only in a requirement, design decision, or plan — not yet an
  operating control.
- **implemented**: actually established and executable, but not yet automatically
  enforced.
- **automated**: executed automatically by code, tests, CI, a gate, or tooling.
  `automated` implies `implemented`.

**Scope note**: a status in this document describes the specific project control named
in that row's "Implementation" column — it is never a certification that the entire
named SSDF practice/outcome is fully satisfied. A practice can have one `automated`
control and several remaining gaps at the same time; read the Gap column alongside the
Status column, not instead of it.

## PO — Prepare the Organization

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| PO.1 (define security requirements) | Captured only as OpenSpec design decisions (D2/D3/D9/D10 auth/storage/upload security model); not yet coded | `design.md` | planned | not yet coded | Group 2/5/9 tasks |
| PO.3 (secure toolchain) | safe-commit is the change-control tooling component of the toolchain, and that component is automated (exact-file commit/push gating). This does not mean the full application CI/security toolchain is automated. | `tools/safe-commit.mjs`, `test/safe-commit.test.mjs`, `test/safe-commit-gate.test.mjs` | automated | App-level CI, lint/type-check/test runners, dependency/secret/SAST/container scanning are not yet established | Group 1 skeleton |
| PO.5 (secure dev environment) | Docker-isolated dev skeleton per D1/D8/D11 | `design.md` | planned | no containers exist yet | Group 1 |

## PS — Protect the Software

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| PS.1 (protect credentials/secrets) | safe-commit's `denyPatterns` automatically block committing matched paths (`.env`, `*.pem`, `*.key`, `credentials.*`, `secrets/**`). This is commit-time secret *protection*, not full secret management. | `.safe-commit.json`, `test/safe-commit*.test.mjs` | automated | No secret scanning, no runtime credential management, no historical-leak detection yet | Group 1 CI |
| PS.2 (provenance) | safe-commit binds each commit to an approved plan's exact file/blob hashes and verifies the tree pre- and post-commit, giving exact commit-content integrity and partial commit provenance. This does not cover release provenance, signed releases, or artifact attestation. | `docs/safe-commit.md`, `test/safe-commit*.test.mjs` | automated | No release provenance, signing, or artifact attestation exists yet | — |
| PS.3 (archive and protect each release) | No release artifact, release pipeline, or protected publish archive exists yet; not yet applicable at this stage. `.git` history is a change record, not a release archive, and is not cited as evidence for this practice. PS.2's safe-commit evidence covers change integrity/commit provenance only and does not by itself satisfy release archiving. | — | planned | Must be designed and implemented before the first formal release | First release |

## PW — Produce Well-Secured Software

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| PW.1 (design requirements) | D1–D20 cover Provider boundaries, auth, storage, least-privilege, fail-closed patterns — design only | `design.md` | planned | not yet coded | respective Groups |
| PW.4 (reuse well-secured components) | Provider-neutral boundaries (AuthService/StorageService/PdfProcessingPort) isolate 3rd-party SDKs from Domain — design only | `design.md` D1/D2/D3/D11 | planned | not yet coded | Groups 2/3/5/6 |
| PW.7 (code review) | Independent read-only review mandated per stage in `docs/implementation-workflow.md` | `docs/implementation-workflow.md` | planned | no implementation exists yet to review | first Stage Contract |
| PW.8 (test) | CI/contract tests/AI eval procedures defined in `docs/implementation-workflow.md` | same | planned | none established yet | per-Group as skeleton lands |

## RV — Respond to Vulnerabilities

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| RV.1 (identify vulnerabilities) | Reporting path defined in `SECURITY.md`, but no real external channel or scanning tooling exists yet | `SECURITY.md` | planned | no scanning tooling, no real external channel | Group 1 CI; first external report |
| RV.2 (assess/prioritize/remediate) | Process described in `SECURITY.md`, never exercised | `SECURITY.md` | planned | not exercised or automated | first real report |
| RV.3 (root cause + regression) | Required post-fix per `SECURITY.md`, never exercised | `SECURITY.md` | planned | not exercised | first real fix |

## Current gaps

- Application CI not yet established.
- Lint/type-check/unit/integration/E2E not yet established alongside an app skeleton.
- Dependency, secret, SAST, and container scanning not yet established.
- Contract tests not yet established.
- AI eval has no executable asset yet.
- Vulnerability response process is not yet established or automated; no real external
  reporting channel exists yet.
