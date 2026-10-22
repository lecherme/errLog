# CI

One verification pipeline, `.github/workflows/ci.yml` (task 1.5, design D21), and one
local entry point, `scripts/ci.sh`. Every CI job runs exactly `scripts/ci.sh <check>`, so
the local stage-completion gate and remote CI run the same commands with the same tool
versions. There is no CI-only command and no weaker local substitute. The two layers
(local gate before safe-commit, remote CI after push) are described in
`docs/implementation-workflow.md` ("CI").

```bash
scripts/ci.sh all          # every check, in the order below; stops at the first failure
scripts/ci.sh <check>      # one check
```

Run `scripts/ci.sh` only on a checkout you trust. Like CI, it executes code from the
checkout (the ESLint configuration, npm scripts, tests, Compose builds), so running it on
an unreviewed pull request runs that pull request's code on your machine.

## Prerequisites

- **Node 24.21.0**, the version in `.node-version` (the same as `apps/web/Dockerfile`).
  `scripts/ci.sh` fails on any other version. CI gets it from `actions/setup-node`, which
  reads `.node-version`. Locally, either use a version manager that reads `.node-version`
  (for example fnm, nodenv or mise), or download the official
  `node-v24.21.0-<os>-<arch>.tar.xz` from nodejs.org, check its SHA-256 against the
  release's `SHASUMS256.txt` (optionally verify that file's signature,
  `SHASUMS256.txt.sig`/`.asc`, with the Node.js release keys), and put its `bin/` first on
  `PATH` for the shell that runs `scripts/ci.sh`.
- Docker with Compose v2 (`docker compose`). The scanners and actionlint run only as
  digest-pinned container images; nothing else is installed globally.
- Network access to npm, the container registries, and the OSV database and API.

## Checks

| Check | What it runs | Fails on |
|---|---|---|
| `workflow` | actionlint on `.github/workflows/` (with its bundled shellcheck 0.11.0, which checks every `run:` script, and pyflakes), then a repository policy check | any actionlint report or tool error; a `uses:` not pinned to a 40-hex commit SHA with a version comment; triggers other than exactly `push` and `pull_request`; top-level or job `permissions` other than exactly `contents: read`; `runs-on` other than `ubuntu-24.04`; a job without `timeout-minutes`; checkout without `persist-credentials: false`; a `run:` other than `scripts/ci.sh <check>`; the text `pull_request_target`, `workflow_run`, `secrets.`, `continue-on-error` or `\|\| true` |
| `openspec` | `openspec validate math-error-correction-mvp --strict --no-interactive`, from `scripts/ci-tools` (`@fission-ai/openspec` 1.10.0, installed with `npm ci --ignore-scripts` from its lockfile) | any validation error |
| `node-tests` | `node --test 'test/*.test.mjs'`: the two safe-commit and the two stage-handoff test files, with a temporary `HOME`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (no Git configuration, like a fresh runner) | a failing test; fewer than four test files |
| `python` | `python -m py_compile` on `services/pdf-processing/app.py` in the service's base image, read-only, without network | a syntax error. This is a compile check only; the Group 3 test suite does not exist yet |
| `web` | in `apps/web`: `npm ci --ignore-scripts`, `npm run lint` (ESLint with `eslint-config-next` core-web-vitals and TypeScript presets), `npm run typecheck` (`next typegen && tsc --noEmit`), `npm run build` | any lint error, type error or build failure |
| `secrets` | gitleaks on the full Git history, then on the working tree (tracked and untracked files that Git does not ignore) | any finding (`--exit-code 1`; values are redacted) |
| `dependencies` | OSV-Scanner on every lockfile Git does not ignore, with the one exception below | any finding other than that exception; any tool, database or API error |
| `compose` | in a new Compose project `errlog-ci-<GitHub run id or local>-<128 random bits>`: `config`, `build`, a fresh `db`, `npm run db:migrate` twice (the second must report `No migrations to run!`), `test:db`, `test:dev-seed`, all three services healthy, and the five service-name connectivity checks from the README | any failing step; any existing Docker object (container, volume, network or image) labelled with or named after the generated project, or a Docker listing error, checked before anything is created; `COMPOSE_PROJECT_NAME` or `COMPOSE_FILE` already set; a failed cleanup; any change to the `errlog-dev` project's containers, volumes or networks during the run |

`compose` generates a random synthetic `POSTGRES_PASSWORD` for each run (never printed or
written to a file) and publishes `web` on a free loopback port. Its exit trap always runs
`docker compose -p <project> down -v --rmi local --remove-orphans` for that project only;
it never prunes and never touches `errlog-dev` or `errlog-dev_pgdata`. Only the run-id
part of the project name comes from the environment; its 128-bit random suffix is
generated inside the script, so the name cannot be chosen or guessed. The exit trap is
installed only after the check above found nothing of that name, so a run removes only
what it created and never an existing or concurrent project. The one remaining window,
between that check and the first `build`/`up`, can only be used by a process that already
has Docker access (root-equivalent) and knows the random name.

No check uses a repository secret, an Environment or any credential. Playwright and E2E
start with task 4.1 (D22); the production smoke workflow is task 13.2 and is not part of
this pipeline.

## Workflow constraints

- Triggers: `push` (all branches) and `pull_request`. Never `pull_request_target`,
  `workflow_run`, `schedule` or `workflow_dispatch`.
- `permissions: contents: read` at the top level and on every job; nothing is elevated.
- `runs-on: ubuntu-24.04`, a `timeout-minutes` on every job, and `concurrency` per ref
  that cancels superseded runs.
- Later Groups extend this workflow; they never add a second pipeline.

## Pinned tools

| Tool | Version | Pin |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| actionlint (`rhysd/actionlint`) | 1.7.12 (shellcheck 0.11.0, pyflakes) | `sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` |
| gitleaks (`ghcr.io/gitleaks/gitleaks`) | v8.30.1 | `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| OSV-Scanner (`ghcr.io/google/osv-scanner`) | v2.6.0 | `sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa` |
| Node.js | 24.21.0 | `.node-version` |
| `@fission-ai/openspec`, `yaml` | 1.10.0, 2.9.1 | `scripts/ci-tools/package-lock.json` |
| `eslint`, `eslint-config-next` | 9.39.5, 16.4.0 | `apps/web/package-lock.json` |

Each pin was the latest release that had been published for at least two weeks when it
was chosen. A pin changes only through a reviewed stage that updates `scripts/ci.sh` or
`ci.yml` and this table together.

## Blocking policy

- Every finding fails the run. There are no directory, wildcard, package-level or
  severity-level ignores and no severity threshold.
- A tool failure (image pull, vulnerability database or OSV API unreachable, configuration
  parse error) fails the run. It is never treated as a pass.
- The only report-only item is the single dependency exception below. A new real
  vulnerability fails the run and is reported to the user; an exception needs a new Stage
  Contract revision and the user's approval.

### Baseline (first run, S1.5)

- Secret scanning: no findings in the full history (19 commits) or the working tree, so
  there is no `.gitleaks.toml`.
- Dependency scanning: `apps/web/package-lock.json` (430 packages) and
  `scripts/ci-tools/package-lock.json` (70 packages); one advisory, the exception below.
  Python has no dependency manifest yet, so no Python dependency is scanned.

## Dependency exception

`osv-scanner.toml` holds one time-boxed, report-only exception, accepted by the user for
S1.5 (Q6-A):

- **Advisory**: `GHSA-vfj7-8cjw-p6xm` (`CVE-2026-93687`). `braces` ≤ 3.0.3 walks its AST
  recursively without a depth limit, so a deeply nested brace pattern can exhaust the
  call stack and end the Node process with an uncaught `RangeError` (CWE-674, High, CVSS
  8.7). 3.0.3 is the latest `braces` release and OSV records no fixed version.
- **Paths**, both from development tooling added by S1.5:
  1. `apps/web/package-lock.json`: `eslint-config-next@16.4.0` → `@next/eslint-plugin-next`
     → `fast-glob` → `micromatch` → `braces@3.0.3`;
  2. `scripts/ci-tools/package-lock.json`: `@fission-ai/openspec@1.10.0` → `fast-glob` →
     `micromatch` → `braces@3.0.3`.

  In both lockfiles `node_modules/braces` is `3.0.3` with `dev: true`. No production
  dependency (`next`, `react`, `pg`) depends on it.
- **The web image contains it.** `apps/web/Dockerfile` is a single-stage image whose
  `npm ci --ignore-scripts` installs devDependencies too, so `braces@3.0.3` is in the
  built image's `node_modules`. Whether the running app ever loads it has not been
  verified.
- **Threat model.** `pull_request` runs check repository content that the pull request
  controls: the ESLint configuration, the OpenSpec files and the paths and contents being
  linted or validated are all untrusted. A crafted pull request can therefore reach
  `braces` through `fast-glob`/`micromatch` and exhaust the stack. The impact is bounded
  to crashing or failing that CI run: jobs hold no secrets, `GITHUB_TOKEN` is
  `contents: read`, checkout keeps no credentials and the runner is ephemeral. A pull
  request can already run arbitrary code in these jobs (the ESLint configuration is
  JavaScript), so `braces` adds no privilege, but that does not make pull request content
  trusted.
- **Expiry**: `ignoreUntil = 2026-11-20`. After that date OSV-Scanner reports the advisory
  again and the run fails.
- **Binding.** A directory's `osv-scanner.toml` applies only to that directory, not to
  subdirectories, so the root file does not reach the two nested lockfiles by itself. The
  check therefore always runs
  `osv-scanner scan source --config=/repo/osv-scanner.toml --recursive /repo`, which
  applies the file to every lockfile in the scan.

`scripts/ci.sh dependencies` prints the exception on every run and fails unless all of
these hold:

1. `osv-scanner.toml` holds exactly this one entry (this id, this `ignoreUntil`, a
   `reason`) and no nested `osv-scanner.toml` exists;
2. wherever `node_modules/braces` appears, it is `3.0.3` with `dev: true`, and only in the
   two lockfiles above;
3. the OSV API record for the advisory has no `fixed` event; an unreadable record fails;
4. the scan with the exact `--config` reports nothing else;
5. a self-check scan without `--config` (JSON output, exit code captured; only exit 1,
   "vulnerabilities found", is parsed) reports exactly this advisory for `braces@3.0.3` in
   both lockfiles and nothing else. This proves the advisory is still present and is only
   let through by the explicit `--config`.

**Re-evaluate** the exception on every dependency change (any lockfile change runs this
check) and before any production deployment; the deployment stage must list it as a
precondition. **Remove** it, in a new stage, as soon as a compatible fixed version exists
(guard 3 then fails) and upgrade the dependency. Patching third-party code, forcing a
version with `overrides`/`resolutions`, or replacing `eslint-config-next` or the pinned
OpenSpec CLI are not options: lint and the pinned CLI are task 1.5 requirements.

## Toolchain notes

- **Transitive upgrades (Q7-A).** Adding `eslint-config-next` brought a `browserslist`
  that requires `baseline-browser-mapping ^2.11.29` and `caniuse-lite ^1.0.30001816`, so
  npm upgraded two existing transitive packages together: `baseline-browser-mapping`
  2.11.28 → 2.11.30 and `caniuse-lite` 1.0.30001815 → 1.0.30001817 (both still within
  `next`'s ranges). `semver`'s lockfile flag changed from `optional` to `devOptional` at
  the same version. The user approved the pair together; no other existing package
  changed.
- **ESLint 9.** npm marks `eslint@9.39.5` as no longer supported. ESLint 10 is not
  possible yet: the latest `eslint-plugin-react`, which `eslint-config-next@16.4.0`
  depends on, has a peer range of `^3 … ^8 || ^9.7`. Open a separate upgrade stage when
  any of these happens: `eslint-config-next` for this repository's Next version and all
  its plugins support ESLint 10; a security advisory affects ESLint 9 (the `dependencies`
  check then fails); or Next moves to a new major version.

## Remote CI

The first remote run happens only after the S1.5 commit is pushed, so the local
`scripts/ci.sh all` is the pre-commit gate. After a push, the result counts only for the
`ci` workflow run of the `push` event for the exact pushed commit SHA, read in the GitHub
UI: `success` is `passed`; `failure`, `cancelled`, `pending`/`running` or no run at all
(for example when Actions is disabled for the repository) is not. A run for another
commit, or a conclusion from before a re-run, does not count. A failed remote run puts the
stage into repair through a new Stage Contract or an explicitly approved targeted fix;
never an amend, a bypass or a force-push.
