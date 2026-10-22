#!/usr/bin/env bash
# The single local entry point for this repository's CI checks (task 1.5, D21).
# `.github/workflows/ci.yml` runs exactly `scripts/ci.sh <check>` in each job, so every
# CI check runs locally the same way. See docs/ci.md.
#
#   scripts/ci.sh all        run every check in order, stop at the first failure
#   scripts/ci.sh <check>    run one check: workflow openspec node-tests python web
#                            secrets dependencies compose
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# Tool images, pinned by digest (the tag is informational). Updated only by a reviewed
# change that records the new version in docs/ci.md.
ACTIONLINT_IMAGE=rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
GITLEAKS_IMAGE=ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
OSV_SCANNER_IMAGE=ghcr.io/google/osv-scanner:v2.6.0@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa
# The Python check uses the same base image as the pdf-processing service.
PYTHON_IMAGE=$(sed -n 's/^FROM \([^ ]*\).*/\1/p' services/pdf-processing/Dockerfile | head -n 1)

CHECKS=(workflow openspec node-tests python web secrets dependencies compose)

export NEXT_TELEMETRY_DISABLED=1 OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1

log() { printf '==> %s\n' "$*"; }
fail() { printf 'ci: %s\n' "$*" >&2; exit 1; }

require_node() {
  local want
  want="v$(tr -d '[:space:]' < .node-version)"
  [[ "$(node --version)" == "$want" ]] || fail "Node $want is required (found $(node --version)); see .node-version"
}

CI_TOOLS_READY=
ci_tools() {
  if [[ -z "$CI_TOOLS_READY" ]]; then
    (cd scripts/ci-tools && npm ci --ignore-scripts --no-audit --no-fund)
    CI_TOOLS_READY=1
  fi
}

check_workflow() {
  log "actionlint ($ACTIONLINT_IMAGE)"
  docker run --rm --network none -v "$ROOT:/repo:ro" -w /repo "$ACTIONLINT_IMAGE" -color=false
  log "workflow policy"
  ci_tools
  NODE_PATH="$ROOT/scripts/ci-tools/node_modules" node --input-type=commonjs - .github/workflows <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
const errors = [];
const isReadOnly = (p) => p && typeof p === 'object' && Object.keys(p).length === 1 && p.contents === 'read';
if (!files.length) errors.push(`${dir}: no workflow files`);
for (const file of files) {
  const where = path.join(dir, file);
  const raw = fs.readFileSync(where, 'utf8');
  const err = (msg) => errors.push(`${where}: ${msg}`);
  for (const word of ['pull_request_target', 'workflow_run', 'secrets.', 'continue-on-error', '|| true']) {
    if (raw.includes(word)) err(`forbidden text: ${word}`);
  }
  const doc = YAML.parse(raw);
  const on = doc.on ?? doc[true];
  const events = on && typeof on === 'object' ? Object.keys(on) : [];
  if (events.sort().join(',') !== 'pull_request,push') err('triggers must be exactly push and pull_request');
  if (!isReadOnly(doc.permissions)) err('top-level permissions must be exactly contents: read');
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    if (!isReadOnly(job.permissions)) err(`job ${id}: permissions must be exactly contents: read`);
    if (job['runs-on'] !== 'ubuntu-24.04') err(`job ${id}: runs-on must be ubuntu-24.04`);
    if (!Number.isInteger(job['timeout-minutes'])) err(`job ${id}: timeout-minutes is required`);
    for (const step of job.steps ?? []) {
      if (step.uses !== undefined) {
        if (!/^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}$/.test(step.uses)) err(`job ${id}: uses must pin a full commit SHA: ${step.uses}`);
        const line = raw.split('\n').find((l) => l.includes(`uses: ${step.uses}`));
        if (!line || !/#\s*v\d/.test(line)) err(`job ${id}: uses needs a version comment: ${step.uses}`);
        if (step.uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) err(`job ${id}: checkout needs persist-credentials: false`);
      }
      if (step.run !== undefined && !/^scripts\/ci\.sh [a-z-]+$/.test(String(step.run).trim())) err(`job ${id}: run must be exactly scripts/ci.sh <check>`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`workflow policy: ${files.length} file(s) ok`);
NODE
}

check_openspec() {
  ci_tools
  scripts/ci-tools/node_modules/.bin/openspec validate math-error-correction-mvp --strict --no-interactive
}

check_node_tests() {
  # Like a fresh CI runner: no user or system Git configuration. Node 22+ takes test
  # globs, not a directory, so this is the Node 24 form of `node --test test/`.
  local home files=(test/*.test.mjs)
  (( ${#files[@]} >= 4 )) || fail "node-tests: expected the four test files in test/, found ${#files[@]}"
  log "node-tests: ${files[*]}"
  home=$(mktemp -d)
  HOME="$home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node --test 'test/*.test.mjs'
  rm -rf "$home"
}

check_python() {
  log "python compile check ($PYTHON_IMAGE)"
  docker run --rm --network none --user 10001:10001 -e PYTHONPYCACHEPREFIX=/tmp/pycache \
    -v "$ROOT/services/pdf-processing:/src:ro" "$PYTHON_IMAGE" python -m py_compile /src/app.py
}

check_web() {
  cd apps/web
  npm ci --ignore-scripts --no-audit --no-fund
  npm run lint
  npm run typecheck
  npm run build
}

check_secrets() {
  local tree
  log "gitleaks: Git history ($GITLEAKS_IMAGE)"
  docker run --rm --network none -v "$ROOT:/repo:ro" \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
    "$GITLEAKS_IMAGE" git /repo --redact --no-banner --no-color --exit-code 1
  log "gitleaks: working tree (tracked and untracked, not ignored)"
  tree=$(mktemp -d)
  git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    mkdir -p "$tree/$(dirname "$f")" && cp "$f" "$tree/$f"
  done
  local status=0
  docker run --rm --network none -v "$tree:/scan:ro" "$GITLEAKS_IMAGE" \
    dir /scan --redact --no-banner --no-color --exit-code 1 || status=$?
  rm -rf "$tree"
  return "$status"
}

# The only dependency-scan exception (S1.5, Q6-A). Every value here is checked against
# osv-scanner.toml and the lockfiles; any other entry or finding fails. See docs/ci.md.
OSV_EXCEPTION=GHSA-vfj7-8cjw-p6xm
OSV_EXCEPTION_UNTIL=2026-11-20
OSV_EXCEPTION_LOCKFILES="apps/web/package-lock.json scripts/ci-tools/package-lock.json"

# Fails unless osv-scanner.toml holds exactly the one exception, no nested
# osv-scanner.toml exists, and braces is 3.0.3 with dev: true wherever it appears.
dependency_exception_guards() {
  node --input-type=commonjs - "$OSV_EXCEPTION" "$OSV_EXCEPTION_UNTIL" $OSV_EXCEPTION_LOCKFILES <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [id, until, ...allowed] = process.argv.slice(2);
const errors = [];
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.git', 'node_modules', '.next'].includes(e.name)) walk(p); }
    else files.push(path.relative('.', p));
  }
};
walk('.');
for (const f of files.filter((f) => path.basename(f) === 'osv-scanner.toml' && f !== 'osv-scanner.toml')) errors.push(`${f}: only the root osv-scanner.toml is allowed`);
const lines = fs.readFileSync('osv-scanner.toml', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const expected = ['[[IgnoredVulns]]', `id = "${id}"`, `ignoreUntil = ${until}`];
if (lines.length !== 4 || expected.some((l, i) => lines[i] !== l) || !/^reason = "[^"\\]+"$/.test(lines[3])) {
  errors.push(`osv-scanner.toml must hold exactly one entry: ${expected.join(' / ')} / reason = "..."`);
}
for (const f of files.filter((f) => path.basename(f) === 'package-lock.json')) {
  const packages = JSON.parse(fs.readFileSync(f, 'utf8')).packages ?? {};
  for (const [key, pkg] of Object.entries(packages)) {
    if (!/(^|\/)node_modules\/braces$/.test(key)) continue;
    if (!allowed.includes(f)) errors.push(`${f}: braces is outside the exception's lockfiles`);
    if (pkg.version !== '3.0.3' || pkg.dev !== true) errors.push(`${f}: ${key} must be 3.0.3 with dev: true (found ${pkg.version}, dev: ${pkg.dev})`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('exception guards: ok');
NODE
}

# Fails once OSV records a fixed version for the advisory, or if OSV cannot be read.
dependency_exception_unfixed() {
  node --input-type=commonjs - "$1" <<'NODE'
const id = process.argv[2];
fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(20000) })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((v) => {
    if (v.id !== id || !v.affected?.length) throw new Error('unexpected OSV record');
    const fixed = v.affected.flatMap((a) => (a.ranges ?? []).flatMap((r) => r.events ?? [])).filter((e) => e.fixed);
    if (fixed.length) { console.error(`ci: ${id} now has a fixed version (${fixed.map((e) => e.fixed).join(', ')}): remove the exception and upgrade`); process.exit(1); }
    console.log(`OSV ${id}: no fixed version`);
  })
  .catch((e) => { console.error(`ci: cannot read ${id} from OSV: ${e.message}`); process.exit(1); });
NODE
}

check_dependencies() {
  log "REPORT-ONLY exception until $OSV_EXCEPTION_UNTIL: $OSV_EXCEPTION (braces@3.0.3, dev) in $OSV_EXCEPTION_LOCKFILES; see docs/ci.md"
  dependency_exception_guards
  dependency_exception_unfixed "$OSV_EXCEPTION"
  log "osv-scanner: every lockfile not ignored by Git, with the exception ($OSV_SCANNER_IMAGE)"
  docker run --rm -v "$ROOT:/repo:ro" "$OSV_SCANNER_IMAGE" scan source --config=/repo/osv-scanner.toml --recursive /repo
  log "self-check: without --config the advisory is still reported in both lockfiles"
  local rc=0 report
  report=$(docker run --rm -v "$ROOT:/repo:ro" "$OSV_SCANNER_IMAGE" scan source --format json --recursive /repo) || rc=$?
  [[ $rc -eq 1 ]] || fail "self-check: osv-scanner exited $rc (expected 1, the advisory found)"
  node -e '
const [id, ...lockfiles] = process.argv.slice(1);
let report;
try { report = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { console.error("ci: self-check: osv-scanner JSON is unreadable"); process.exit(1); }
const found = (report.results ?? []).flatMap((r) => (r.packages ?? []).flatMap((p) => (p.vulnerabilities ?? []).map((v) =>
  `${r.source?.path?.replace(/^\/repo\//, "")} ${p.package?.name}@${p.package?.version} ${v.id}`))).sort();
const want = lockfiles.map((f) => `${f} braces@3.0.3 ${id}`).sort();
if (JSON.stringify(found) !== JSON.stringify(want)) { console.error(`ci: self-check: expected exactly\n  ${want.join("\n  ")}\nfound\n  ${found.join("\n  ") || "(none)"}`); process.exit(1); }
console.log(`self-check: ${id} reported only for braces@3.0.3 in ${lockfiles.join(", ")}`);
' "$OSV_EXCEPTION" $OSV_EXCEPTION_LOCKFILES <<<"$report"
}

compose_snapshot() {
  docker ps -a --filter "label=com.docker.compose.project=$1" --format '{{.ID}} {{.Names}} {{.State}}' | sort
  docker volume ls -q --filter "label=com.docker.compose.project=$1" | sort
  docker network ls -q --filter "label=com.docker.compose.project=$1" | sort
}

# Every Docker object that could belong to Compose project $1: labelled with it, or
# named like the containers, volumes, networks and images Compose would create for it.
compose_project_objects() {
  local p=$1 filter
  for filter in "label=com.docker.compose.project=$p" "name=$p"; do
    docker container ls -aq --filter "$filter" || fail "cannot list Docker containers"
    docker volume ls -q --filter "$filter" || fail "cannot list Docker volumes"
    docker network ls -q --filter "$filter" || fail "cannot list Docker networks"
  done
  docker image ls -aq --filter "label=com.docker.compose.project=$p" || fail "cannot list Docker images"
  docker image ls -aq --filter "reference=$p-*" || fail "cannot list Docker images"
}

check_compose() {
  # A fresh, unguessable project per run (128 random bits); nothing outside this
  # function chooses it, so a run cannot be pointed at an existing or concurrent project.
  local project
  project=errlog-ci-${GITHUB_RUN_ID:-local}-$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
  [[ -z "${COMPOSE_PROJECT_NAME:-}" && -z "${COMPOSE_FILE:-}" ]] || fail "unset COMPOSE_PROJECT_NAME and COMPOSE_FILE first"
  [[ "$project" =~ ^errlog-ci-[a-z0-9][a-z0-9-]*$ ]] || fail "refusing Compose project name '$project' (must start with errlog-ci-)"
  # Refuse, before the cleanup trap exists, if anything of that name is already there:
  # the trap may only ever remove what this run created.
  local existing
  existing=$(compose_project_objects "$project")
  [[ -z "$existing" ]] || fail "Compose project $project already has Docker objects; refusing to use or remove them"
  local dev_before
  dev_before=$(compose_snapshot errlog-dev)

  # Synthetic, per-run database password: never printed or written to a file.
  POSTGRES_PASSWORD=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
  ERRLOG_WEB_PORT=$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
  export POSTGRES_PASSWORD ERRLOG_WEB_PORT
  local dc=(docker compose -f "$ROOT/compose.yaml" -p "$project") cleanup
  printf -v cleanup '%q ' "${dc[@]}"
  # shellcheck disable=SC2064  # expand now: the project name is fixed for this run
  trap "log 'cleanup: $project'; ${cleanup}down -v --rmi local --remove-orphans >/dev/null 2>&1 || { echo 'ci: cleanup failed: $project' >&2; exit 1; }" EXIT

  log "compose config ($project)"
  "${dc[@]}" config --quiet
  log "compose build"
  "${dc[@]}" build
  log "fresh database: migrations, schema constraints, dev seed"
  "${dc[@]}" up -d --wait --wait-timeout 180 db
  local url="postgres://postgres:${POSTGRES_PASSWORD}@db:5432/postgres"
  DATABASE_URL=$url "${dc[@]}" run --rm --no-deps -e DATABASE_URL web npm run db:migrate
  local again
  again=$(DATABASE_URL=$url "${dc[@]}" run --rm --no-deps -e DATABASE_URL web npm run db:migrate)
  printf '%s\n' "$again"
  grep -q 'No migrations to run!' <<<"$again" || fail "a second migration run was not a no-op"
  ERRLOG_SCHEMA_TEST_DATABASE_URL=$url "${dc[@]}" run --rm --no-deps \
    -e ERRLOG_SCHEMA_TEST_DATABASE_URL web npm run test:db
  ERRLOG_SCHEMA_TEST_DATABASE_URL=$url "${dc[@]}" run --rm --no-deps \
    -v "$ROOT/apps/web/db/seed:/app/db/seed:ro" -e ERRLOG_SCHEMA_TEST_DATABASE_URL web npm run test:dev-seed
  log "three services healthy and reachable by service name"
  "${dc[@]}" up -d --wait --wait-timeout 180
  "${dc[@]}" exec -T web node -e "fetch('http://pdf-processing:8000/',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
  "${dc[@]}" exec -T web node -e "const s=require('net').connect(5432,'db');s.setTimeout(4000,()=>process.exit(1));s.on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
  "${dc[@]}" exec -T pdf-processing python -c "import urllib.request; urllib.request.urlopen('http://web:3000/', timeout=4)"
  "${dc[@]}" exec -T pdf-processing python -c "import socket; socket.create_connection(('db', 5432), 4).close()"
  "${dc[@]}" exec -T db bash -c 'exec 3<>/dev/tcp/web/3000 && exec 4<>/dev/tcp/pdf-processing/8000'

  [[ "$(compose_snapshot errlog-dev)" == "$dev_before" ]] || fail "errlog-dev resources changed during the run"
  log "compose: ok"
}

run_check() {
  case "$1" in
    workflow) check_workflow ;;
    openspec) check_openspec ;;
    node-tests) check_node_tests ;;
    python) check_python ;;
    web) (check_web) ;;
    secrets) check_secrets ;;
    dependencies) check_dependencies ;;
    compose) (check_compose) ;;
    *) fail "unknown check '$1' (checks: all ${CHECKS[*]})" ;;
  esac
}

[[ $# -eq 1 ]] || fail "usage: scripts/ci.sh all|<check> (checks: ${CHECKS[*]})"
require_node
if [[ "$1" == all ]]; then
  # Each check runs as its own process: `set -e` does not apply inside a function that
  # is called on the left of `||`.
  for check in "${CHECKS[@]}"; do
    bash "$ROOT/scripts/ci.sh" "$check" || fail "check failed: $check"
  done
  log "all checks passed"
else
  log "check: $1"
  run_check "$1"
fi
