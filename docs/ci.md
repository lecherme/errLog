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
| `dependencies` | OSV-Scanner on every lockfile Git does not ignore, with the two exceptions below | any finding other than those exceptions; any tool, database or API error |
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
| `eslint`, `eslint-config-next` | 9.39.5, 16.4.4 | `apps/web/package-lock.json` |

Each pin was the latest release that had been published for at least two weeks when it
was chosen, except `eslint-config-next` 16.4.4 (published 2026-11-02), which SR1 moved
together with the security-fixed `next` 16.4.4. A pin changes only through a reviewed stage that updates `scripts/ci.sh` or
`ci.yml` and this table together.

## Blocking policy

- Every finding fails the run. There are no directory, wildcard, package-level or
  severity-level ignores and no severity threshold.
- A tool failure (image pull, vulnerability database or OSV API unreachable, configuration
  parse error) fails the run. It is never treated as a pass.
- The only report-only items are the two dependency exceptions below. A new real
  vulnerability fails the run and is reported to the user; an exception needs a new Stage
  Contract revision and the user's approval.

### Baseline (first run, S1.5)

- Secret scanning: no findings in the full history (19 commits) or the working tree, so
  there is no `.gitleaks.toml`.
- Dependency scanning: `apps/web/package-lock.json` (430 packages) and
  `scripts/ci-tools/package-lock.json` (70 packages); one advisory, the exception below.
  Python has no dependency manifest yet, so no Python dependency is scanned.

## Dependency exceptions

`osv-scanner.toml` holds two time-boxed, report-only exceptions, accepted by the user for
SR1 (revision 3). Both advisories were published on 2026-10-30 and found by the
`dependencies` check before the SR1 Next.js upgrade; neither can be fixed without a new
major version that the depending packages do not accept:

- **`GHSA-3g3m-2fjr-6pw4`** (`CVE-2026-118773`, Medium): `glob` ≥ 9.0.0, ≤ 14.0.1 keeps
  traversing the file system after its `AbortSignal` is cancelled. Fixed only in
  `glob` 14.0.2. Path: `apps/web/package-lock.json`: `node-pg-migrate@9.0.0` (the
  migration CLI, a devDependency) → `glob ~13.0.0` → `glob@13.0.6`.
- **`GHSA-g3hv-75wg-m249`** (`CVE-2026-118764`, Medium): `minimatch` < 11.0.1 can be
  driven into a denial of service by globparts amplification. Fixed only in
  `minimatch` 11.0.1. Paths, all in `apps/web/package-lock.json`:
  1. `minimatch@10.2.6` (`node_modules/minimatch`), through `glob` (`^10.2.2`) and
     `@typescript-eslint/typescript-estree` (`^10.2.2`);
  2. `minimatch@3.1.5`, nested under `eslint`, `@eslint/config-array`, `@eslint/eslintrc`,
     `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react`
     (`^3.1.x`).

Every `node_modules/glob` and `node_modules/minimatch` entry is `dev: true`, and neither
package appears in `scripts/ci-tools/package-lock.json`. No production dependency
(`next`, `react`, `pg`) depends on them. Upgrading `next` or `eslint-config-next` does not
change them.

- **The web image contains them.** `apps/web/Dockerfile` is a single-stage image whose
  `npm ci --ignore-scripts` installs devDependencies too, so both packages are in the
  built image's `node_modules`. Whether the running app ever loads them has not been
  verified, so they are accepted, time-boxed risk, not packages absent from the
  production artifact.
- **Threat model.** `glob` runs in `npm run db:migrate` (Compose and CI), which reads the
  repository's own migration directory. `minimatch` runs in lint. `pull_request` runs
  check repository content that the pull request controls: the ESLint configuration and
  the paths and contents being linted are untrusted, so a crafted pull request can reach
  the `minimatch` denial of service. The impact is bounded to failing or stalling that CI
  run: jobs hold no secrets, `GITHUB_TOKEN` is `contents: read`, checkout keeps no
  credentials and the runner is ephemeral. A pull request can already run arbitrary code
  in these jobs (the ESLint configuration is JavaScript), so these packages add no
  privilege, but that does not make pull request content trusted.
- **Expiry**: `ignoreUntil = 2026-11-20` for both. After that date OSV-Scanner reports the
  advisories again and the run fails.
- **Binding.** A directory's `osv-scanner.toml` applies only to that directory, not to
  subdirectories, so the root file does not reach the nested lockfiles by itself. The
  check therefore always runs
  `osv-scanner scan source --config=/repo/osv-scanner.toml --recursive /repo`, which
  applies the file to every lockfile in the scan.
- **Precision.** `osv-scanner.toml` ignores by advisory ID. The package, version and
  lockfile precision comes from the guards below and the self-check; weakening any of
  them is a security regression even if `osv-scanner.toml` still looks exact.

`scripts/ci.sh dependencies` prints both exceptions on every run and fails unless all of
these hold:

1. `osv-scanner.toml` holds exactly these two entries, in this order (each: this id, this
   `ignoreUntil`, a `reason`) and nothing else, and no nested `osv-scanner.toml` exists;
2. wherever `node_modules/glob` appears, it is `13.0.6`, and wherever
   `node_modules/minimatch` appears, it is `10.2.6` or `3.1.5`; each with `dev: true`, and
   only in `apps/web/package-lock.json`;
3. the OSV API record of each advisory is readable and not withdrawn, and its only
   `fixed` event is `glob` 14.0.2 or `minimatch` 11.0.1 respectively; a new fixed version
   (for example a compatible backport) fails;
4. the scan with the exact `--config` reports nothing else;
5. a self-check scan without `--config` (JSON output, exit code captured; only exit 1,
   "vulnerabilities found", is parsed) reports, after removing duplicates, exactly
   `glob@13.0.6` for `GHSA-3g3m-2fjr-6pw4` and `minimatch@10.2.6` and `minimatch@3.1.5`
   for `GHSA-g3hv-75wg-m249` in `apps/web/package-lock.json`, and nothing else. This
   proves the advisories are still present and are only let through by the explicit
   `--config`.

**Re-evaluate** the exceptions on every dependency change (any lockfile change runs this
check) and before any production deployment; the deployment stage must list them as a
precondition. **Remove** them, in a new security repair stage before 2026-11-20, by
upgrading the depending packages (`node-pg-migrate`, the ESLint toolchain) or, if a
compatible fixed version appears (guard 3 then fails), by upgrading to it. Patching
third-party code, forcing a version with `overrides`/`resolutions`, or replacing
`eslint-config-next` or the pinned OpenSpec CLI are not options: lint and the pinned CLI
are task 1.5 requirements.

**Removed: `GHSA-vfj7-8cjw-p6xm`** (`braces` ≤ 3.0.3, the S1.5 exception, Q6-A). GitHub
withdrew the advisory on 2026-10-23, and OSV-Scanner reported the ignore as unused, so
SR1 removed it. `braces@3.0.3` is still in both lockfiles (`dev: true`); if the advisory
returns, the scan reports it and the run fails.

## Toolchain notes

- **Transitive upgrades (Q7-A).** Adding `eslint-config-next` brought a `browserslist`
  that requires `baseline-browser-mapping ^2.11.29` and `caniuse-lite ^1.0.30001816`, so
  npm upgraded two existing transitive packages together: `baseline-browser-mapping`
  2.11.28 → 2.11.30 and `caniuse-lite` 1.0.30001815 → 1.0.30001817 (both still within
  `next`'s ranges). `semver`'s lockfile flag changed from `optional` to `devOptional` at
  the same version. The user approved the pair together; no other existing package
  changed.
- **ESLint 9.** npm marks `eslint@9.39.5` as no longer supported. ESLint 10 is not
  possible yet: the latest `eslint-plugin-react`, which `eslint-config-next@16.4.4`
  depends on, has a peer range of `^3 … ^8 || ^9.7`. Open a separate upgrade stage when
  any of these happens: `eslint-config-next` for this repository's Next version and all
  its plugins support ESLint 10; a security advisory affects ESLint 9 (the `dependencies`
  check then fails); or Next moves to a new major version.
- **Next.js build-time security check.** Next 16.4 checks the installed version against
  known advisories before `next build` when it detects that an AI agent runs the command
  (`experimental.agentUpgrade`, default `'security'`). An affected version fails the first
  run with `SecurityFatalError` and writes a retry receipt under
  `apps/web/.next/cache/next-agentic-upgrade-retries/`; the same command within five
  minutes is let through. A failed check only warns ("Could not check Next.js security
  advisories"). It does not run in GitHub Actions or Docker builds (no agent, no TTY),
  where OSV covers advisories. Never re-run the gate to get past it: upgrade to a fixed
  version in a security repair stage (SR1 moved `next` and `eslint-config-next` from
  16.4.0 to 16.4.4 for this reason).

## Remote CI

The first remote run happens only after the S1.5 commit is pushed, so the local
`scripts/ci.sh all` is the pre-commit gate. After a push, the result counts only for the
`ci` workflow run of the `push` event for the exact pushed commit SHA, read in the GitHub
UI: `success` is `passed`; `failure`, `cancelled`, `pending`/`running` or no run at all
(for example when Actions is disabled for the repository) is not. A run for another
commit, or a conclusion from before a re-run, does not count. A failed remote run puts the
stage into repair through a new Stage Contract or an explicitly approved targeted fix;
never an amend, a bypass or a force-push.
