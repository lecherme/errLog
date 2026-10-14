# Implementation Workflow

## Purpose

OpenSpec is the sole source of truth for requirements/design/tasks. The `tasks.md`
checkbox is the sole completion record. This file defines the only implementation
procedure for this project — no second status.json, task list, or acceptance system.
A Stage Contract is an execution boundary for the current batch of work, not a new spec.

## Flow

1. Read-only recovery (see Session continuity and recovery).
2. Read the cited OpenSpec Requirement/Scenario/design/task text for a small batch of
   related tasks; confirm dependencies and the current baseline (code, tests, prior
   stages).
3. Draft a Stage Contract (template below), including User-journey E2E requirements.
   3a. Contract review handoff: publish the full contract to the `contract` channel and
   stop. Continue only after a verified Codex `OK`, then present that exact contract to
   the user (see Cross-agent review handoff).
4. Obtain the user's explicit approval of that contract — no checkpoint and no edits
   before this. Any change to it goes back to step 3a as a new revision.
5. Write the Implementation Checkpoint with `stageState: in_progress`, holding the full
   approved Stage Contract.
6. Where applicable: failing evidence first; unit, integration, contract tests, AI eval.
7. Implement product code strictly within the Stage Contract's allowed paths.
8. E2E worker (see User-journey E2E) writes/updates tests within worker allowed paths.
9. E2E worker runs the focused E2E → E2E Test Summary.
10. E2E worker runs the full E2E suite → E2E Test Summary.
11. Main agent verifies each Summary against the machine-readable Playwright report and
    records the compressed result in the checkpoint.
12. Product defect or spec gap → main agent fixes it within the Stage Contract, or
    performs an OpenSpec flow-back; the worker re-verifies focused → full, each with its
    own Summary. If the same E2E blocker survives two consecutive fix attempts, stop and
    report — never loop or weaken tests.
13. Main agent runs the full local stage-completion gate (see CI below: once a skeleton
    and CI exist, these are the CI-equivalent commands, run locally, including the full
    E2E suite), producing machine evidence and an E2E Test Summary. Scope gate: diff
    actual changes against the approved paths and task scope.
14. Independent read-only stage reviewer — a fresh sub-agent, never the E2E worker —
    reviews product code, tests, and E2E using the final gate evidence and Summaries.
15. Blocking findings: targeted fix → re-run the affected tests (E2E via the worker) and
    the full local gate → re-review. At most two reviewer fix rounds; unresolved
    blocking findings stop the stage.
    15a. Implementation review handoff: publish the stage to the `implementation`
    channel and stop. Continue only after a verified Codex `PASS`.
16. Reviewer PASS, Codex `PASS`, and every gate PASS → check the corresponding `tasks.md`
    checkbox(es).
17. After checking: re-run `openspec validate "<change>" --strict`, the progress count,
    and the final scope/worktree check.
18. Update the checkpoint to `stageState: ready_for_safe_commit`. Never set this before
    the checkbox is checked.
19. safe-commit `check` (the checkpoint's `ready_for_safe_commit` state, the checkbox
    change, and the stage files are committed in this same batch — see Session
    continuity and recovery).
20. User approves the plan → `commit`.
21. Ask separately about push → user approval → `push`.
22. Remote CI runs the committed deterministic suite against the pushed commit — no LLM,
    no sub-agent (see CI below).
23. Remote CI failure → a new repair stage (see CI below).

Milestone convergence review follows a Group or key end-to-end flow (not every stage).

Both cross reviews (3a and 15a) are default gates; the user does not have to ask for
them. Only the user can waive one, explicitly (see Cross-agent review handoff).

## Hard rules

- OpenSpec is the only source of truth; the `tasks.md` checkbox is the only completion
  record.
- Never create a duplicate status/task/acceptance system.
- A Stage Contract is a boundary for this batch, not a new spec — it cannot change
  product semantics; if it needs to, stop and go back to OpenSpec refine (flow-back).
- Never run Git automatically. Never bypass the sandbox, permissions, hooks, or
  safe-commit. Never use `git add .`, unscoped `git add -A`, auto-commit, or auto-push.
- Scope gate: the actual diff must land only inside the Stage Contract's allowed paths
  and task scope — nothing else, no drive-by refactors or unrelated fixes.
- Flow-back: if implementation reveals a spec gap/conflict, pause implementation, revise
  OpenSpec, re-validate, get the (possibly revised) Stage Contract re-approved, continue.
- A stage is "done" only with reproducible evidence (test output, review verdict) — "the
  code looks done" is never sufficient.
- CI, contract tests, and AI eval are established only once the corresponding tech
  skeleton actually exists. Never fabricate commands, interfaces, thresholds, or results
  ahead of that.
- User-journey E2E is a persistent repo asset. `.only` is always forbidden — no Stage
  Contract exception exists; `forbidOnly` stays on and any `.only` is a FAIL. `.skip` and
  `.fixme` are zero in the committed suite by default; an exception to them, and any
  deletion or weakening of an existing test or assertion, must be listed item by item in
  the Stage Contract and explicitly user-approved.
- A stage whose E2E applicability is not `not-applicable` cannot reach independent
  review, a checkbox, or safe-commit without a valid E2E Test Summary for the final tree.

## Stage Contract template

- Stage ID
- OpenSpec task IDs
- Expected outcome
- Requirement/Scenario/Design it traces to
- Dependencies
- Sub-steps
- Exact paths allowed to change
- Explicitly excluded
- Test requirements
- Contract-test requirements (Contracts affected: list which of the 5 named boundaries)
- AI-eval requirements
- User-journey E2E requirements:
  - Applicability: required / extends-existing / reuses-existing / not-applicable + reason
  - Requirement/Scenario IDs (+ task verify clauses)
  - E2E worker applicability: worker (author+run) / worker (run-only) / main-agent
    fallback / none + reason
  - Minimal context supplied to worker (exact paths)
  - Worker allowed paths (exact E2E spec / fixture / helper / test-adapter paths)
  - Tests to add / modify / reuse (by path)
  - Synthetic data / fixtures
  - Test identity (1.4 pre-journey precondition, or login UI + test OTP adapter)
  - External dependencies and the test adapter replacing each
  - Read-only DB checks (if any): what, and why — supplementary only
  - Cleanup strategy
  - User-visible / business assertions
  - Viewports covered (desktop / mobile)
  - Approved `.skip` / `.fixme` exceptions (default: none)
  - Expected E2E Test Summary (scenarios expected to be covered)
  - Failure artifact locations (`.artifacts/e2e/…`; CI artifact names)
- Security/privacy/trust-boundary impact
- Evidence of completion
- Rollback approach

## CI

Two layers, kept deliberately separate, because remote CI typically only runs after a
push — it cannot be a precondition for the commit that precedes that push. Collapsing
them into one sequential "CI passing → stage complete" rule is unexecutable.

**Pre-safe-commit stage-completion gate (local).** The stage's required checks run
locally, before the task checkbox is checked and before safe-commit `check` runs. Once
a Group's technical skeleton and CI are established, these local commands must be the
same (or equivalent) commands CI will run — not a weaker local-only substitute. Passing
this local gate, plus any applicable contract tests/AI eval, plus the independent
review, is what allows checking the task checkbox and proceeding to safe-commit.

**Post-push remote CI.** Runs against the already-committed, already-pushed commit. It
is an independent re-verification and the gate for future merge/release — never a
precondition for creating that commit. If remote CI fails on a pushed commit: the stage
re-enters a repair state; no dependent stage may start, and the commit may not be merged
or released, until it's fixed. The fix itself goes through a new Stage Contract (or an
explicitly approved targeted fix) with its own tests, review, and safe-commit cycle —
never an `amend`, never a bypass.

Coverage builds up incrementally in both layers as the stack exists: `openspec validate
--strict` → frontend lint/type-check/unit → Python lint/type-check/pytest →
integration → user-journey E2E (from task 4.1; deterministic Playwright, no LLM) →
safe-commit's own tests → secret scanning → dependency vulnerability
scanning → SAST/container scanning once applicable.

## Contract tests

Established when each boundary is actually implemented, not pre-built. The five
boundaries: Next.js ↔ Python PDF Processing Service; Domain ↔ AI Provider adapter;
Domain ↔ Storage adapter; Auth/session ↔ Child ownership; durable job ↔ AI error-cause
analysis state machine. Every Stage Contract touching one of these lists it under
"Contracts affected." A contract change is verified on both provider and consumer sides,
covering: normal request/response; invalid input; empty result; timeout/Provider
failure; low-confidence/`unavailable`; version incompatibility; idempotency/retry;
permission/ownership checks.

## User-journey E2E

Design D22 holds the technical principles; this section holds the procedure and agent
orchestration.

### Applicability
`required` (new journey) / `extends-existing` (an existing journey changes) /
`reuses-existing` (existing E2E covers it; run, no test changes expected) /
`not-applicable` + reason (the stage reviewer verifies the reason).

### Derivation
The main agent proposes scenarios from the cited Requirement/Scenario and task verify
clauses; the user approves them in the Stage Contract. Never reverse-engineer scenarios
from the implementation. A gap is an OpenSpec flow-back.

### Driving and assertions
Only real pages and user-visible interactions drive the product. Never drive or prepare
product flow via DB writes, internal APIs/helpers, domain objects, or the 1.4/4.3 dev
seed/fixture. Until real login UI and the test OTP adapter exist, the 1.4 dev identity
may serve as an explicitly labeled pre-journey precondition; such tests are never called
login E2E, and once login exists all E2E authenticate through the login UI. UI-visible
results are the authoritative assertions. A read-only DB check may add diagnostic or
invariant evidence only if declared in the Stage Contract, and never prepares data,
drives flow, or replaces a UI assertion. Asserting only that a page loads is never enough.

### Single suite and configuration
One Playwright config, one fixture/helper/adapter set, extended by every later stage.
Chromium engine only initially; applicable journeys run at one desktop and one mobile
viewport (chosen by 4.1). WebKit/Firefox are added only on a real compatibility need.
retries = 0 in the local gate and CI. `forbidOnly` is on; `.only` is never allowed.
Skipped/fixme must be zero unless approved item by item per the Hard rules.

### Delegation and context isolation
Never delegated by the main agent: final interpretation of requirements; product
trade-offs; changes to OpenSpec semantics; Stage Contract approval handling; the final
completion judgment; task checkboxes; checkpoint state; safe-commit/commit/push/merge;
the choice between product fix, test fix, environment handling, and flow-back.

After approval, for `required`/`extends-existing`, the main agent starts the E2E worker
(`.claude/agents/e2e-worker.md` once 4.1 creates it) in a fresh context. For
`reuses-existing` it may start the worker run-only (affected tests + full suite).

Minimal context, given as exact paths the worker may read:
1. the approved Stage Contract's User-journey E2E section;
2. the exact cited Requirement/Scenario text;
3. the relevant task verify clauses;
4. D22;
5. this section;
6. the Playwright config;
7. the E2E specs/fixtures/helpers/test adapters directly related to the journey;
8. the worker allowed paths;
9. how to start the product;
10. the unified local E2E command;
11. the page routes or public boundary contracts the journey touches;
12. the journey-relevant part of the current product diff.

Never given: the main conversation, scratchpad history, unrelated specs/decisions, other
Groups' content, unrelated Git history, old bulky logs/traces/screenshots/videos.
Missing necessary context → the worker lists the exact gaps and returns `BLOCKED`. It
never widens its reading to the whole repository.

### E2E worker permissions
May: add/modify Playwright tests, synthetic fixtures, E2E helpers, and test-adapter
implementation files within worker allowed paths; run focused and full-suite E2E;
inspect traces, screenshots, videos, service logs; classify failures as product defect
/ test defect / environment issue / spec gap / external dependency issue; return the
Summary.

May not: change or reinterpret a Requirement/Scenario; widen the journey; touch
unapproved files; modify product code, including the configuration/composition wiring
that selects or excludes test adapters; write the DB to prepare product flow; call
internal APIs/helpers/domain objects in place of user actions; use the 1.4/4.3 dev
fixture to drive product E2E; delete or weaken assertions; add `.skip`/`.only`/`.fixme`
and report PASS; add retries; change checkboxes or the checkpoint; run
safe-commit/commit/push/merge; adapt a test to a product defect. Needing product code,
out-of-contract paths, or OpenSpec → stop and return `BLOCKED`.

Agent definition files reinforce this procedure but are not a path allowlist; the Stage
Contract, the scope gate, and the stage reviewer remain the controls.

### Mandatory E2E Test Summary
Every E2E execution — by the worker, the main agent's step-13 gate, or fallback — ends
with an E2E Test Summary (template below), whatever the result. Counts come from the
machine-readable Playwright report; the main agent verifies them against that report.
No valid Summary → no review, no checkbox, no safe-commit. CI produces only the
machine-readable report, never an LLM Summary.

```markdown
### E2E Test Summary
- Stage ID:
- OpenSpec task IDs:
- Result: PASS / FAIL / BLOCKED
- Execution type: focused / full-suite / re-verification
- Executor: E2E worker / main-agent fallback / main-agent stage gate
- Started / finished (Asia/Shanghai):
- Duration:

#### Coverage
- Requirement/Scenario IDs:
- Task verify clauses:
- User journeys tested (+ viewports):
- Normal path:
- Exception path:
- Recovery path:
- Explicitly not covered (+ reason):

#### Files
- New E2E files / Modified E2E files / Reused E2E files:
- Fixtures / Helpers / Test adapters:

#### Execution
- Commands actually run:
- Machine-readable report path:
- Exit code:
- total / passed / failed / skipped / fixme / retries / flaky / interrupted:

#### Findings
- Blocking:
- Non-blocking:
- Per failure: test id — category (product defect / test defect / environment issue /
  spec gap / external dependency issue) — minimal excerpt (never full stdout/stderr)

#### Evidence
- Trace / screenshot / video paths (`.artifacts/e2e/…`) or CI artifact names:
- Container/service log paths:
- Failure report path:
- If PASS with only report + Summary kept: retention policy applied

#### Integrity checks — value: yes / no / n/a + reason   (expected value in brackets)
- Driven entirely through real UI [yes]
- Direct DB writes [no]
- Read-only DB checks used — if yes, declared in Stage Contract and supplementary only [no, or yes+declared]
- Internal API/helper driving [no]
- Dev fixture used as product entry [no]
- 1.4 identity precondition used — labeled, not called login E2E [n/a, or yes+labeled]
- Synthetic isolated data only [yes]
- Real child data or family photos touched [no]
- Real production credentials used [no]
- Test data cleaned up [yes]
- `.skip` present [no, unless Stage-Contract-approved]
- `.only` present [no — never approvable]
- `.fixme` present [no, unless Stage-Contract-approved]
- Existing tests deleted [no, unless approved]
- Existing assertions weakened [no, unless approved]
- Passed only via retry / flaky observed [no]
- Test adapters absent or fail-closed in production configuration [yes; n/a only if this stage has no test adapter]

`n/a` is valid only when the concept does not exist in this stage; each needs a reason,
and the stage reviewer confirms it.

#### Decision
- Product fix needed / Test fix needed / Environment handling needed / OpenSpec flow-back needed:
- Ready for stage reviewer:
- Final verdict:
```

### PASS / FAIL / BLOCKED rules
- **BLOCKED** — the test process did not run, or could not produce a valid run: missing
  context (exact gaps listed); a need for product code, out-of-contract paths, or
  OpenSpec changes; an environment that cannot start (category: environment issue).
- **FAIL** — the tests ran, and any of: exit code ≠ 0; failed > 0; interrupted > 0
  (abnormal exit); unapproved skipped/fixme; any `.only` present (never approvable);
  flaky (inconsistent across repeated runs); DB/API/helper bypass or dev-fixture driving; real child data,
  family photos, production data, or credentials used; a test adapter reachable in
  production configuration; test data not cleaned up; a required Scenario not covered;
  only page load asserted; missing commands, counts, or evidence, or counts not matching
  the report file; any integrity check off its expected value or an unjustified `n/a`.
- **PASS** — the tests ran completely and every rule above is satisfied.

Flaky is always FAIL and blocks the stage by default. The main agent decides whether to
fix it or ask the user for explicit acceptance; an acceptance is recorded in the
checkpoint and never rewrites the Summary to PASS.

### Evidence retention and context hygiene
Default local evidence directory: `.artifacts/e2e/` (gitignored, never a safe-commit
path). Passing runs may keep only the machine report and the Summary; failing runs keep
trace, screenshots, video, and the necessary service logs. Local retention/cleanup is
defined by 4.1's Stage Contract. CI uploads evidence as artifacts with a 7-day retention.

Commands redirect full output to files. The main agent receives only the Summary,
artifact paths, and the minimal excerpt a blocker needs, and reads specific evidence
fragments only while handling that blocker. The checkpoint records only: result, counts,
covered Scenario IDs, blocking/non-blocking findings, evidence paths/artifact names,
next action. Never copy logs into `scratchpad.md`.

### Product-fix and re-verification loop
The worker reports a product defect and stops. The main agent examines it, fixes it
within allowed files or performs a flow-back, then re-runs the same worker or a fresh
minimal-context one: focused first, then full suite, each with a Summary. Completion
rests on the Playwright exit code plus the verified full counts, never on a
natural-language judgment. These pre-review loops do not consume reviewer fix rounds,
but the same blocker surviving two consecutive fix attempts stops the stage for a report.

### Stage reviewer
Exactly one independent stage reviewer (`.claude/agents/stage-reviewer.md` once 4.1
creates it): a fresh read-only sub-agent, never the E2E worker. No sub-agent is author,
executor, and reviewer at once. It checks product code and tests per "Independent review
& convergence", plus: Requirement/Scenario traceability; genuine UI driving; no
DB/API/helper bypass; no deleted/skipped/weakened tests; no dev fixture in product E2E;
test adapters unable to reach production; synthetic isolated data only; business and
user-visible assertions; tests following the spec, not the implementation; Summary
consistency with the actual files, commands, report, and artifacts; every `n/a` and
every `not-applicable` justified. Output: structured findings + verdict, no bulk logs.

### CI has no LLM
Remote CI runs only the committed deterministic Playwright suite: no Claude, no
sub-agent, no generated tests, no main-session context, no LLM-based verdict. Pass/fail
is the exit code plus deterministic policy (`forbidOnly` — any `.only` fails, retries =
0, zero skip/fixme unless approved item by item). Evidence is uploaded as 7-day artifacts.

### Fallback when sub-agents are unavailable
If a sub-agent cannot be created, the main agent performs the worker role under the
same minimal-context, allowed-paths, evidence-isolation, and Summary rules, and reports
"E2E worker unavailable — main-agent fallback". If the project agent definitions exist
but are not loaded in the current session, a general-purpose sub-agent given the
definition's content counts as the worker or reviewer; report this. A separate reviewer
is still required; if none can run, stop and report rather than self-review. The
fallback never skips, narrows, or weakens E2E.

## AI eval

Built as an executable asset exactly when the D13/D17/D19/D20-related OpenSpec tasks are
worked, not invented ahead of time. Likely future structure: eval manifests, schemas,
human labels, sanitized fixtures, a runner, reports. Requirements: sample IDs and data
versions traceable; human ground truth kept separate from model output; calibration kept
separate from held-out; digital-native/scanned-PDF/photo-only reported separately;
provider, model, contract/prompt, threshold, and preprocessing version all recorded; no
real child data, identity information, or unredacted family photos committed to Git; CI
runs only a small sanitized smoke eval; the full eval runs inside the relevant Selection
Gate. Any change to an AI contract, model, prompt, preprocessing, or threshold requires
re-running the relevant eval; ordinary UI changes do not.

## Independent review & convergence

**Per-stage review** checks: Stage Contract satisfied; no scope/path overrun;
requirement/scenario/design traced to implementation and tests; permissions, input
validation, fail-closed behavior, idempotency, concurrency, and data isolation; no
Provider-specific type leaking into Domain; no "tests pass but product semantics are
wrong"; any fact requiring flow-back to OpenSpec; any unrelated refactor or unapproved
scope expansion. The per-stage reviewer is the single stage reviewer defined under
User-journey E2E: it reviews after the full local gate, with the gate's machine evidence
and all E2E Test Summaries, and also covers the E2E checklist there.

**Convergence review** (after a Group or key end-to-end flow) additionally checks:
proposal/spec/design/tasks/code/tests still agree; no retired mechanism lingers; every
checked task checkbox has real evidence; facts discovered during implementation have
been written back to OpenSpec; security/privacy boundaries still hold.

The cross-agent (Codex) reviews are default gates in addition to the stage reviewer; they
never replace or satisfy it (see Cross-agent review handoff).

## Session continuity and recovery

**Sources of truth**: OpenSpec task checkboxes (completion); Git commits (durable stage
boundaries); the current change's `scratchpad.md` Implementation Checkpoint (recovery
notes for the single in-progress stage, not a second task-status system); the
uncommitted worktree (possibly in-progress, never proof of completion by itself).
Cross-agent review handoffs under `.agent-handoffs/` are not a source of truth; recovery
never depends on them. The one exception is resuming a pending contract handoff (see
"Pending contract handoff" below), which is still a non-authoritative snapshot.

**Implementation Checkpoint** lives in `openspec/changes/<change>/scratchpad.md` as one
bounded section covering only the current stage: stage ID; OpenSpec task IDs; the full
user-approved Stage Contract (the formal execution boundary); user-approval status; exact paths allowed to change; work completed;
work remaining; tests run and their results; tests not yet run; reviewer findings and
their resolution; files expected to exist in the worktree; blockers; the single next
action; `stageState` (e.g. `in_progress` / `ready_for_safe_commit`); last-updated
timestamp. There is no commit-SHA field — see below for why.

**Write the checkpoint**: right after Stage Contract approval and before editing; after
each hard-to-re-derive sub-step; after tests or the reviewer produce a material
conclusion; whenever a session is ending, context is about to compact, something blocks,
or the user asks to pause. Immediately before running safe-commit `check`, set
`stageState: ready_for_safe_commit` and commit this checkpoint update **in the same
safe-commit batch** as the implementation/tests/task-checkbox changes — not as a
separate follow-up edit, since a commit cannot contain its own SHA.

Never edit `scratchpad.md` again after that commit purely to backfill a SHA. The
successful commit itself is the stage's durable closing boundary. A new session
identifies which commit closed a stage by searching `git log`/commit diffs for a commit
that simultaneously (a) changes `scratchpad.md`'s checkpoint to `ready_for_safe_commit`
for that stage and (b) includes the corresponding `tasks.md` checkbox change and the
stage's implementation files in the same commit. A stage ID appearing in the commit
message, or any surviving safe-commit private plan metadata under `.git/safe-commit`, is
auxiliary corroborating evidence only — never a required condition, since recovery must
work even on a different machine or after that private metadata no longer exists. If no
commit uniquely satisfies this, or more than one plausibly does, report the ambiguity to
the user and wait for confirmation — never guess which commit closed the stage.

If commit succeeds but push is still pending or fails, that fact is expressed by the
branch's ahead/behind-upstream status in Git, not by any checkpoint field.

When the next stage begins, its checkpoint **replaces** the previous one entirely —
`scratchpad.md` holds exactly one current-stage checkpoint, never an accumulating log of
past stages. Git history is where past-stage history actually lives.

**Pre-implementation baseline**: a missing Implementation Checkpoint is not automatically
drift. If all of the following hold — the worktree is clean; the change's planning
artifacts (proposal/design/tasks/specs) are complete; implementation progress is 0 (no
OpenSpec implementation task for the change is checked); no application implementation
code exists yet; no Implementation Checkpoint exists; and the branch/HEAD/upstream state
can be clearly explained and reported to the user — treat this as the legitimate
`pre_implementation` baseline, not as a lost checkpoint or drift. The branch/HEAD/
upstream state is not required to be synchronized to qualify:
- synchronized with upstream → report normally;
- ahead of upstream → still a valid `pre_implementation` baseline, but report the
  unpushed local commit(s) explicitly, and do not push, merge, or otherwise act on them
  until the user decides;
- behind, diverged, or unknown → stop and ask the user to confirm before treating
  anything as a pre-implementation baseline.

Recovery in this case reports: implementation progress as `0/<total task count>`; active
stage as `none`; the branch/HEAD/upstream state per the rules above; and the next action
as reading OpenSpec's apply instructions read-only and proposing the first Stage
Contract — never creating an active checkpoint or editing implementation files before
that Stage Contract is approved.

**Pending contract handoff**: before the user approves a Stage Contract, the draft exists
only in its contract handoff, since no checkpoint is written yet. A new session may
resume it, without redrafting or creating a run, only if `verify --channel contract`
reports `valid` (so HEAD, `inputsDigest`, and `changedFilesDigest` are unchanged) and
`nextGate` is `awaiting_codex_response` or `awaiting_user_approval`. Report the stage,
channel, run, revision, verify status, and next action, then stop and wait for the user.
If the handoff is `unavailable`, `invalid`, or `stale`, its origin is unclear, or the user
asks for a new draft, stop and let the user decide whether to republish; never continue
silently and never create a new run on your own.

Conversely, if the checkpoint is missing but any task is already checked, implementation
code exists, the worktree has changes not explained by this baseline, or the branch/Git
state can't be clearly explained, treat it as potential drift per the inconsistency rule
below — stop and wait for user confirmation rather than assuming a pre-implementation
baseline.

**New-session recovery protocol** — read-only, in order:
1. Read `CLAUDE.md`.
2. Read `docs/implementation-workflow.md`.
3. Read the current change's proposal/spec/design/tasks/`scratchpad.md`.
4. Inspect branch, HEAD, upstream, worktree, and uncommitted diff.
5. Cross-check the Implementation Checkpoint against actual files and Git state. If the
   checkpoint's `stageState` is `ready_for_safe_commit` (or the checkpoint is stale or
   missing), search `git log`/commit diffs for a commit that simultaneously updated the
   checkpoint to that state and included the matching task-checkbox and stage-file
   changes — treat that commit as the stage's closing boundary. A stage ID in the commit
   message or surviving safe-commit plan metadata is auxiliary evidence only, never
   required; this must work from tracked files, the worktree, and Git history alone,
   even on a different machine with no private safe-commit metadata present. If the
   closing commit can't be uniquely determined this way, report the ambiguity and wait
   for user confirmation instead of guessing. (See "Pre-implementation baseline" above
   for the one case where a missing/stale checkpoint is expected, not drift.)
6. Cross-check any test run the checkpoint claims against credible evidence.
7. Cross-check `tasks.md` checkboxes.
8. If this project has a configured remote CI, check the remote CI/check status for the
   currently pushed HEAD before treating any stage as safe to build on: `passed` →
   continue; `failed` → report the failure and treat the stage as needing targeted
   repair — do not start any dependent stage, merge, or release; `pending`/`running` →
   do not start any stage that depends on that result, wait or report to the user
   instead of guessing; if the status can't be reached or can't be uniquely matched to
   the current HEAD → mark it `unknown`, report this to the user, and never treat
   `unknown` as `passed`. This reads the existing remote CI/check-status mechanism
   only — it does not create or require a new tracked status file. Resuming "from disk
   alone" means recovering implementation context and stage boundaries; it does not
   mean skipping a remote status that genuinely has to be queried fresh.
9. Separate expected changes from changes whose origin can't be confirmed.
10. Report to the user: what the prior stage completed; what's still incomplete; which
    worktree changes are expected vs. unexpected; whether checkpoint/Git/OpenSpec agree;
    the remote CI status from step 8 if applicable; any pending contract handoff (see
    "Pending contract handoff"); what's about to happen next.
11. Only continue editing after the user confirms.

**On any inconsistency** between checkpoint, worktree, Git, and task checkboxes: stop
implementation and report the drift. Never guess which source is correct. Never delete,
overwrite, or clean up changes of unconfirmed origin. Never auto-check a task. Never
re-run an operation that has external side effects.

**If interruption happened before the checkpoint was updated**: reconstruct a candidate
checkpoint from OpenSpec, the uncommitted diff, test output, and Git state — clearly
labeling what's disk evidence vs. inference — and show it to the user for approval
before continuing.

Prefer finishing one Stage Contract within a single session; start the next stage only
after the current one is safe-committed.

## Cross-agent review handoff

A two-way, file-based handoff that lets another reviewer (Codex) review a stage without
the conversation: Claude publishes an immutable review request, the user has Codex write
an immutable response bound to that request, and the user tells Claude to read it. No
agent ever invokes another; the user carries every step.

There are two channels, and each is a default gate of every stage:

- **contract**: reviews a Stage Contract draft after Claude drafts it and before the
  user approves it (Flow step 3a). Verdicts: `OK`, `NEEDS_CHANGES`, `BLOCKED`.
- **implementation**: reviews a finished stage after the local gate and the Claude stage
  reviewer PASS, before the task checkbox (Flow step 15a). Verdicts: `PASS`, `FAIL`,
  `BLOCKED`.

**Authority**: a handoff is a redacted transport and review snapshot. It is not a source
of truth, a checkpoint, a task system, or an audit log. It never changes the
Implementation Checkpoint (no extra fields), `scratchpad.md`, `tasks.md`, code, or Git,
and it authorizes nothing: no implementation, fix, commit, push, merge, or deployment.
Commit and push each keep their own user approval. The checkpoint, Git, the worktree,
test evidence, and safe-commit stay authoritative. The user-approved Stage Contract
lives in the checkpoint; if a contract handoff and the checkpoint disagree, the
checkpoint wins, but Claude reports the drift and stops instead of guessing.

**Gate behavior**: a handoff that is `unavailable`, `invalid`, or `stale` stops the
workflow at that gate. Claude reports it (with the message `handoff unavailable or
invalid — perform direct repository review`) and never skips the cross review silently.
The user decides: republish, switch to a direct repository review, or waive this review
explicitly. Only the user can waive a cross review.

### Layout

    .agent-handoffs/<stage-id>/runs/<run-id>/index.json                                     implementation
    .agent-handoffs/<stage-id>/runs/<run-id>/requests/NNNN-review-ready.json
    .agent-handoffs/<stage-id>/runs/<run-id>/responses/NNNN-codex-review.json
    .agent-handoffs/<stage-id>/contract/runs/<run-id>/index.json                            contract
    .agent-handoffs/<stage-id>/contract/runs/<run-id>/requests/NNNN-contract-request.json
    .agent-handoffs/<stage-id>/contract/runs/<run-id>/responses/NNNN-codex-contract-review.json

The implementation channel keeps the original (H1) layout, names, and record shapes, so
existing handoffs verify unchanged without migration. Each channel has its own runs,
index, revision chain, and lock; a revision, index, request, or response of one channel
is never read as, or overwrites, one of the other. `.agent-handoffs/` is in the root
`.gitignore`; the tool refuses to write unless Git ignores it and nothing under it is
tracked. `<stage-id>` is the Stage Contract ID (matching `^[A-Z][A-Za-z0-9.-]{0,15}$`).
`<run-id>` is `<UTC yyyymmddThhmmssZ>-<8 hex>`; the active run of a channel is its
greatest run ID. Requests and responses are read-only (0444) and are never edited,
overwritten, renamed, or deleted. `index.json` names the current request; only `publish`
changes it. Response `NNNN` answers request `NNNN`, one to one.

### State machine and stop points

The same cycle runs in each channel; `verify` reports where it stands as `nextGate`:

1. Claude publishes revision `n` and **stops** (`nextGate: awaiting_codex_response`).
   The user has Codex review it; Codex writes the response for revision `n`.
2. When the user says to read it, Claude runs `verify`. Anything but `valid` → **stop**
   and report (gate behavior above).
3. The verdict decides the next step:
   - contract `OK` (`awaiting_user_approval`): present that exact contract to the user and
     **stop** until the user explicitly approves it. `OK` is never approval.
   - implementation `PASS` (`codex_pass`): continue at Flow step 16 after a final scope
     gate.
   - `NEEDS_CHANGES`, `FAIL`, or `BLOCKED` (`stopped_on_codex_verdict`): **stop** and
     report. A change or fix needs the user's authorization, then a new revision `n+1`.

Revisions are immutable, so any change to a reviewed contract, including one the user
asks for after `OK`, is a new revision that needs a new `OK` before the user's final
approval. After approval, Claude writes the full approved Stage Contract into the
Implementation Checkpoint (Flow step 5); the contract handoff plays no further role.

**Fix-round limit**: the same blocking finding gets at most two fix rounds in each
channel. If the finding is still blocking after round two, stop and report; never keep
publishing revisions. A user's own change of a product trade-off also needs a new
revision and review, but it does not reset the count for a finding that is still open.

In the contract channel `publish` enforces this from the run's history:
- revision `n` lists in `priorFindings` each blocking finding of the response to
  revision `n-1` exactly once, with its text copied verbatim, and nothing else. After
  `OK` the list is empty;
- if revision `n-1` has no response yet (a `manual_refresh`, or a user change before
  Codex answered), revision `n` repeats its findings unchanged (`finding`,
  `previousFinding`, `fixRound`; only `resolution` may differ). The fix is still
  unreviewed, so the round stays the same;
- `previousFinding` links a finding to an earlier one of this run: `null` for a new
  finding, the same text for a finding reported again (required), or the original text
  when Codex reworded the same finding. Linked findings share one count;
- the tool derives the round (1 for a new finding, otherwise one more than the highest
  round of its linked findings) and refuses a `fixRound` that differs. It refuses a
  third round with `FIX_ROUND_LIMIT` and writes nothing.

The tool cannot tell that a reworded finding is the same finding: linking it is the
publisher's duty, and Codex checks the links. The count is per run; only the user decides
to start a new run with `init --new-run`. `verify` does not re-derive the rounds of
stored requests. In the implementation channel the limit is procedural: a fix for a
Codex finding shares the two-round targeted-fix limit with the Claude stage reviewer.

### When to publish

**Contract channel**: once per Stage Contract draft, before asking the user to approve
it. Each request is the next revision, with a `reason`:

- `initial`: revision 1, and only revision 1;
- `contract_revision`: after a Codex finding, with the user's authorization;
- `user_revision`: the user changed the contract or a product trade-off;
- `manual_refresh`: the same contract, republished because its inputs or the repository
  moved on.

**Implementation channel**: after the local gate and the Claude stage reviewer PASS,
before step 16, so the request's `safeCommit` is `null`. Each request is the next
revision, with a `reason`:

- `initial`: revision 1, and only revision 1;
- `targeted_fix`: after a targeted fix that needs re-review;
- `plan_refresh`: only when the user asks for a review after safe-commit `check`, or the
  plan itself needs review, and the plan named in the current request expired, went
  stale, or was rebuilt. There is no routine re-review after `check`;
- `manual_refresh`: the user asks for a fresh snapshot.

Nothing else is recorded: stage start, reviewer rounds, fixes, plan expiry, commit, push,
and abandonment stay with the checkpoint, Git, safe-commit, and the stage report.

**Bootstrap**: H2, the stage that added the contract channel, is the one exception: its
own Stage Contract was approved by the user directly, and its implementation was
reviewed through the H1 implementation handoff. The contract-review default applies from
the first Stage Contract after H2 is pushed.

### Commands

`tools/stage-handoff.mjs` uses only Node built-ins and runs only read-only Git commands
(`rev-parse`, `status`, `rev-list`, `check-ignore`, `ls-files`) plus the read-only
`safe-commit inspect` when a request names a plan. Every command prints one
JSON object that names the `channel` it acted on; exit code 0 means success or `valid`,
1 refused or not valid, 2 usage error. `--channel` is `contract` or `implementation`;
without it the tool acts on `implementation`, for compatibility with H1. Always pass it
explicitly.

- `node tools/stage-handoff.mjs init --stage <id> --channel <channel> [--new-run] --json`
  creates a run with `currentRevision: 0`. It refuses if the channel already has a run
  for the stage, unless `--new-run` is given; the new run records `priorRunId` and old
  runs are left untouched.
- `node tools/stage-handoff.mjs publish --stage <id> --channel <channel> --input <draft.json> --json`
  (Claude) publishes the next request revision. A named plan must be `ready` and
  unexpired.
- `node tools/stage-handoff.mjs respond --stage <id> --channel <channel> --revision <n> --input <draft.json> --json`
  (Codex) writes the response to request `n`, which must be the current one.
- `node tools/stage-handoff.mjs verify --stage <id> --channel <channel> [--revision <n>] --json`
  checks the handoff read-only and repairs nothing.

Drafts live outside the repository (for example the agent's own temporary directory).
Every draft must have exactly the fields its channel lists below, as single-line strings
of at most 500 characters (summaries 300) and lists of at most 50 items, except
`contractText` and contract `inputFiles` (see Contract request). A draft for the wrong
channel is refused (`INPUT_INVALID`).

### Contract request

Claude's draft supplies:

- `reason` (see When to publish);
- `contract`: `summary`, `taskIds`, `allowedFiles` (at least one), `excluded`,
  `testRequirements`, `contractTestRequirements`, `aiEvalRequirements`,
  `e2eRequirements`, `securityImpact`;
- `contractText`: the complete Stage Contract as multi-line Markdown, at most 32 KiB
  (newlines and tabs allowed, no other control characters). It is exactly the text shown
  to the user, so Codex reviews the same contract the user is asked to approve;
- `openQuestions[]`: `id`, `question`, `options[]` (at least two, each `label` and
  `description`), `recommendation`, `rationale`;
- `priorFindings[]`: `finding`, `previousFinding` (`null` or an earlier finding's text),
  `fixRound` (1 or 2, as derived by the tool), `resolution`; empty for revision 1. See
  "Fix-round limit";
- `inputFiles[]`: at least one repository-relative regular file the contract relies on,
  such as the cited OpenSpec artifacts, `CLAUDE.md`, and this document; any POSIX name
  except NUL;
- `nextAction`.

The tool adds `schemaVersion`, `kind: "contract-review-request"`, `channel`, `stageId`,
`runId`, `revision`, `generatedAt`, `previousRequest`, `repo` (as in the implementation
request), `contractSha256` (`sha256:` plus the SHA-256 of `contractText`), `inputs`
(`inputsDigest` and `files[]` of `path` and `sha256`), `changes`, and `worktree`. The
record has no field for approval.

### Contract response

Codex's draft supplies `verdict` (`OK`, `NEEDS_CHANGES`, or `BLOCKED`),
`blockingFindings`, `nonBlockingFindings`, `suggestions`, `checksPerformed`,
`limitations`, and `nextAction`, and nothing else; in particular it cannot carry an
approval or decision field. The tool adds `schemaVersion`, `kind:
"contract-review-response"`, `channel`, `reviewer: "codex"`, `generatedAt`, and `source`:
the request's `stageId`, `runId`, `revision`, `requestPath`, `requestSha256`,
`changedFilesDigest`, `inputsDigest`, `contractSha256`, and `currentHead`.

### Implementation request

Claude's draft supplies `reason`, `contract` (`summary`, `taskIds`, `allowedFiles`),
`checkpoint` (`path`, a `summary` of `stageId`, `stageState`, `progress`, and
`containsApprovedContract: true`, stating that the checkpoint holds the user-approved
Stage Contract; or `null` when the stage has no checkpoint), `verification[]` (`name`, `redactedCommand`,
`exitCode`, `result`, `conciseSummary`), `claudeReview` (`reviewerType`, `round`,
`verdict`, `blockingFindings`, `nonBlockingFindings`, `fixesApplied`),
`contractDeviations[]` (`description`, `userApproved`), `safeCommitPlanId` (or `null`),
and `nextAction`. The tool adds the rest:

- `schemaVersion`, `kind: "review-request"`, `stageId`, `runId`, `revision`,
  `generatedAt`;
- `previousRequest`: `path` and SHA-256 of the previous request file (`null` for
  revision 1);
- `repo`: `branch`, `upstream`, `baselineHead` (HEAD at `init`), `currentHead`;
- `changes`: `changedFilesDigest` and `files[]` (`path`, `status`, `sha256`, `inScope`);
- `checkpoint.sha256` (the checkpoint file's hash) and `containsApprovedContract: true`,
  or `{path: null, sha256: null, summary: "not-applicable"}`; H1 requests, which lack
  `containsApprovedContract`, still verify;
- `safeCommit`: `planId`, `state`, `expiresAt`, `files`, `ignoredFiles` from
  `safe-commit inspect`, or `null`;
- `worktree`: `clean`, `ahead`, `behind`.

A changed path outside `allowedFiles` is published with `inScope: false` and reported by
`verify` as `OUT_OF_SCOPE_CHANGES`; the reviewer and the scope gate must report it.

### Implementation response

Codex's draft supplies `verdict` (`PASS`, `FAIL`, or `BLOCKED`), `blockingFindings`,
`nonBlockingFindings`, `checksPerformed`, `limitations`, and `nextAction`. The tool adds
`schemaVersion`, `kind: "review-response"`, `reviewer: "codex"`, `generatedAt`, and
`source`: the request's `stageId`, `runId`, `revision`, `requestPath`, `requestSha256`,
`changedFilesDigest`, and `currentHead`. `respond` refuses a request that is not current,
already answered, or stale.

### Changed-files manifest

The manifest covers every path that `git status --porcelain=v1 -z --untracked-files=all
--no-renames` lists (ignored files excluded), as bytes:

    errlog-changed-files-manifest/v1 NUL
    then, per path:  <XY> NUL <content> NUL <path bytes> NUL

`<XY>` is the porcelain status. `<content>` is `sha256:<hex>` of the file bytes,
`symlink:<hex>` of a symlink's target text, or `deleted`. Entries are sorted by path,
comparing raw UTF-8 bytes. POSIX paths can't contain NUL, so paths with spaces, tabs,
newlines, or quotes are unambiguous. `changedFilesDigest` is `sha256:` plus the SHA-256 of
these bytes. `changes.files[]` holds exactly these entries (`sha256` is `<content>`), so
the digest can be rebuilt from the request alone and from the worktree, and both must
agree.

The contract inputs are encoded the same way:

    errlog-contract-inputs/v1 NUL
    then, per input file:  <content> NUL <path bytes> NUL

sorted by path bytes; `inputsDigest` is `sha256:` plus the SHA-256 of these bytes. Any
change to an input file's bytes, or its removal, changes the digest.

### Writes and interruptions

`publish` and `respond` hold a lock (`<run>/.lock`, created with `mkdir`) and first
require the existing handoff to verify structurally. A record is scanned for sensitive
data, written to a temporary file, flushed, read back, and then published with a hard link
that fails rather than replace an existing name; it is then set read-only and the
directory is flushed. `publish` updates `index.json` only after its request is fully
published, through a temporary file and an atomic rename. `respond` never touches the
index. A refused or failed write leaves the earlier index, requests, and responses
byte-for-byte unchanged. An interrupted write can leave a temporary file, a lock, or a
request newer than the index; `verify` reports these as `stale` and the tools refuse to
write until they are gone. Only the user removes them, or an agent the user explicitly
asks to.

### Verify

`verify` reports `status`:

- `valid`;
- `stale`: an interrupted-write leftover, or the repository has moved on
  (`HEAD_CHANGED`, `DIGEST_CHANGED`, `INPUTS_CHANGED` (contract), `CHECKPOINT_CHANGED`,
  `PLAN_EXPIRED`, `PLAN_CONSUMED`, `PLAN_MISSING` (implementation), or
  `NOT_CURRENT_REVISION`);
- `invalid`: a broken index, a hash or chain mismatch (including `INPUTS_MISMATCH` and
  `CONTRACT_HASH_MISMATCH` inside a contract request), a record of the wrong channel or
  shape, a response not bound to its request, or an unignored directory;
- `unavailable`: no handoff in that channel, or no request yet.

It checks the index, every request back to revision 1 (contiguous revisions, each
`previousRequest` hash, the current hash in the index, each digest against its
`files[]`), the response binding, and then compares the current request with HEAD, the
worktree digest, and either the contract input files or the checkpoint hash and the
safe-commit plan. The output also gives `channel`, `request` (`path`, `sha256`,
`intact`), `response` (`present`, `verdict`, `bindingOk`), `plan`, `nextGate` (see State
machine; `null` unless `valid`), `reasons`, and `notices`. A valid contract `OK` always
carries the notice `USER_APPROVAL_REQUIRED`.

### Using a response (Claude)

When the user says to read the current Codex response, run `verify` with the channel
first. Read the response only if `status` is `valid` and `response.present` is true;
anything else stops the workflow (gate behavior). Report the verdict and findings to the
user, then follow the State machine: after a contract `OK`, ask for the user's approval of
that exact contract; after an implementation `PASS`, continue at step 16 after a final
scope gate; otherwise stop. Before an implementation review, confirm the checkpoint's
approved Stage Contract still matches the contract the user approved; on any drift,
report it and stop.

### Instructions for Codex

Run `verify --channel <channel>` and continue only if the current request is `valid`.
Never modify code, Git, the index, the request, or the checkpoint, and never approve
anything on the user's behalf. Write the draft outside the repository, then run
`respond` with the same channel for the current revision.

- **Contract review**: read `contractText` and the listed input files in the repository,
  and check the contract against the cited OpenSpec tasks, requirements, and design, this
  document, and `CLAUDE.md`: scope, allowed and excluded paths, test/E2E/security
  requirements, and whether the open questions and alternatives are fairly presented.
  Product trade-offs remain the user's decision; raise them, do not decide them. In a
  later revision, check that `priorFindings` links each finding you raised again, even
  reworded, to its earlier text through `previousFinding`; a missing or wrong link is a
  blocking finding.
- **Implementation review**: read the full approved Stage Contract in the checkpoint
  (`checkpoint.path`) and review the actual repository (the diff against
  `repo.currentHead` and the changed files) against it: the diff stays inside the
  allowed files, the tests and gates required by the contract ran and pass. Do not rely
  on the request's claims alone. A stage with `checkpoint: null` has its contract in the
  request's `contract` and its stage report.

### Safety

Never store passwords, API tokens, OTPs, cookies, Authorization headers, SSH or private
keys, database connection strings, environment dumps, real email addresses or phone
numbers, photo or PDF content, unfiltered terminal output, or other user data. Commands
are stored only in redacted form, with secrets replaced by `<redacted>`; write any
database URL as `postgres://<redacted>`. Before writing, the tool scans the full record
and refuses (`SENSITIVE_DATA`, naming the rules and top-level fields but never the
matched text), leaving everything unchanged, on any of: a URL with a password other than
`<redacted>`; a database URL (`postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`,
`redis`) not starting with `<redacted>`; `authorization:`; `bearer` and a token; a
private-key header; `password`, `passwd`, `secret`, `token`, `api_key`, `cookie`, or
`otp` followed by `:` or `=` and a value other than `<redacted>`; AWS, GitHub, Google,
Slack, JWT, or `sk-` key formats; an email address outside `example.test`, `example.com`,
and `example.invalid`; a mainland mobile number (optionally `+86` or dash-separated); or
three or more `NAME=value` assignments. Wording such as `token: …` or `OTP: …` in review
text also trips the scan; rephrase it. `verify` applies the same scan and the response
field checks to stored records, so a hand-written record is reported `invalid`. Both
channels use the same scan; it covers the serialized record and also each raw string
value, so a match at the start of a line in a multi-line `contractText` is caught. Only
hashes of changed files and contract input files are stored, never their contents; the
contract text itself is the one stored document. The scan is a safety net; the writer
remains responsible for redaction.

### Retention

Handoffs are local working data, not an audit system. They are never deleted
automatically, only when the user explicitly asks.
