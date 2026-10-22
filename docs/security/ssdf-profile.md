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
| PO.3 (secure toolchain) | Two toolchain components are automated: safe-commit (exact-file commit/push gating) and the CI pipeline (task 1.5): one workflow `.github/workflows/ci.yml` whose jobs each run `scripts/ci.sh <check>`, the same entry point as the local gate; actions pinned to full commit SHAs; actionlint, gitleaks and OSV-Scanner run as digest-pinned images; Node pinned in `.node-version`; the workflow itself is checked by actionlint and a repository policy check (SHA pins, `contents: read`, no `pull_request_target`). | `tools/safe-commit.mjs`, `test/safe-commit.test.mjs`, `test/safe-commit-gate.test.mjs`, `.github/workflows/ci.yml`, `scripts/ci.sh`, `docs/ci.md` | automated | No SAST, container image scanning or Python lint/type-check/pytest yet; base images are not digest-pinned; remote CI re-verifies each pushed commit and is not a precondition for that commit | Groups 3+; first release |
| PO.5 (secure dev environment) | Docker-isolated local dev skeleton per D1/D8/D11 (task 1.1): fixed compose project `errlog-dev`; `web`/`pdf-processing`/`db` on one compose network; only `web` published, host loopback only (`127.0.0.1:${ERRLOG_WEB_PORT:-3100}` → container port 3000); `web`/`pdf-processing` run as non-root and hold no DB credentials; `POSTGRES_PASSWORD` supplied only from the shell at run time; base images pinned to exact version tags; `db` data on the project-scoped named volume `pgdata` (`errlog-dev_pgdata`), kept across `down` and app-container rebuilds, separate per compose project (task 1.2). `scripts/ci.sh compose` (task 1.5) builds this stack and checks migrations, tests, health and connectivity in the local pre-commit gate and, as configured in `ci.yml`, on every push and pull request (remote runs start after the S1.5 push), in a new, randomly named `errlog-ci-*` project with a per-run synthetic password, refusing to start if any Docker object of that name already exists and never touching `errlog-dev`; it does not assert the isolation properties listed here. | `design.md`, `compose.yaml`, `README.md`, `apps/web/Dockerfile`, `services/pdf-processing/Dockerfile`, `scripts/ci.sh`, `docs/ci.md` | implemented | Dev DB volume is local and not encrypted at rest; no DB backup yet (D8); base images not digest-pinned and no container image scanning; the single-stage web image contains devDependencies (see the dependency exception in `docs/ci.md`); `pdf-processing` is a placeholder until task 3.1; all containers share one host and failure domain (D8) | Group 1 |

## PS — Protect the Software

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| PS.1 (protect credentials/secrets) | safe-commit's `denyPatterns` automatically block committing matched paths (`.env`, `*.pem`, `*.key`, `credentials.*`, `secrets/**`). gitleaks (`scripts/ci.sh secrets`, task 1.5) scans the full Git history and the working tree in the local pre-commit gate and, as configured in `ci.yml`, on every push and pull request (remote runs start after the S1.5 push) and fails on any finding, with values redacted. This is secret *protection and detection*, not full secret management. | `.safe-commit.json`, `test/safe-commit*.test.mjs`, `scripts/ci.sh`, `docs/ci.md` | automated | No runtime credential management | Group 2/13 |
| PS.2 (provenance) | safe-commit binds each commit to an approved plan's exact file/blob hashes and verifies the tree pre- and post-commit, giving exact commit-content integrity and partial commit provenance. This does not cover release provenance, signed releases, or artifact attestation. | `docs/safe-commit.md`, `test/safe-commit*.test.mjs` | automated | No release provenance, signing, or artifact attestation exists yet | — |
| PS.3 (archive and protect each release) | No release artifact, release pipeline, or protected publish archive exists yet; not yet applicable at this stage. `.git` history is a change record, not a release archive, and is not cited as evidence for this practice. PS.2's safe-commit evidence covers change integrity/commit provenance only and does not by itself satisfy release archiving. | — | planned | Must be designed and implemented before the first formal release | First release |

## PW — Produce Well-Secured Software

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| PW.1 (design requirements) | D1–D20 cover Provider boundaries, auth, storage, least-privilege, fail-closed patterns — design only | `design.md` | planned | not yet coded | respective Groups |
| PW.4 (reuse well-secured components) | Provider-neutral boundaries (AuthService/StorageService/PdfProcessingPort) isolate 3rd-party SDKs from Domain — design only | `design.md` D1/D2/D3/D11 | planned | not yet coded | Groups 2/3/5/6 |
| PW.7 (code review) | Independent read-only review mandated per stage in `docs/implementation-workflow.md` | `docs/implementation-workflow.md` | planned | no implementation exists yet to review | first Stage Contract |
| PW.8 (test) | CI (task 1.5) runs in the local pre-commit gate and, as configured in `ci.yml`, on every push and pull request (remote runs start after the S1.5 push): the safe-commit and stage-handoff tests, `openspec validate --strict`, web lint/type-check/build, a Python compile check, and on a fresh database the migrations, schema-constraint and dev-seed tests plus service health and connectivity. Procedures for contract tests, AI eval and E2E are defined in `docs/implementation-workflow.md`. | `.github/workflows/ci.yml`, `scripts/ci.sh`, `docs/ci.md`, `docs/implementation-workflow.md` | automated | No contract tests, AI eval, user-journey E2E (from task 4.1) or Python tests yet | per-Group as the stack lands |

## RV — Respond to Vulnerabilities

| Practice/Outcome | Implementation | Evidence | Status | Gap | Trigger |
|---|---|---|---|---|---|
| RV.1 (identify vulnerabilities) | OSV-Scanner (`scripts/ci.sh dependencies`, task 1.5) scans every lockfile in the local pre-commit gate and, as configured in `ci.yml`, on every push and pull request (remote runs start after the S1.5 push) and fails on any finding or tool error; one time-boxed, report-only exception (GHSA-vfj7-8cjw-p6xm, until 2026-11-20) is guarded and printed on every run. Reporting path defined in `SECURITY.md`, but no real external channel exists yet. | `scripts/ci.sh`, `osv-scanner.toml`, `docs/ci.md`, `SECURITY.md` | automated | No SAST or container image scanning; Python has no dependency manifest to scan yet; no real external reporting channel | Group 3+; first external report |
| RV.2 (assess/prioritize/remediate) | Process described in `SECURITY.md`, never exercised | `SECURITY.md` | planned | not exercised or automated | first real report |
| RV.3 (root cause + regression) | Required post-fix per `SECURITY.md`, never exercised | `SECURITY.md` | planned | not exercised | first real fix |

## Current gaps

- Python lint/type-check/pytest, contract tests and user-journey E2E are not yet
  established.
- SAST and container image scanning are not yet established; base images are not
  digest-pinned.
- One time-boxed dependency exception is open (GHSA-vfj7-8cjw-p6xm, until 2026-11-20; see
  `docs/ci.md`).
- AI eval has no executable asset yet.
- Vulnerability response process is not yet established or automated; no real external
  reporting channel exists yet.
