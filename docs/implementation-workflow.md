# Implementation Workflow

## Purpose

OpenSpec is the sole source of truth for requirements/design/tasks. The `tasks.md`
checkbox is the sole completion record. This file defines the only implementation
procedure for this project — no second status.json, task list, or acceptance system.
A Stage Contract is an execution boundary for the current batch of work, not a new spec.

## Flow

1. Select a small batch of related OpenSpec tasks.
2. Read-only: confirm dependencies and current baseline (code, tests, prior stages).
3. Draft a Stage Contract (template below).
4. Obtain user approval — no edits before this.
5. Where applicable: write tests / establish failing evidence first.
6. Implement, strictly within the Stage Contract's allowed paths.
7. Scope gate: diff actual changes against the approved paths and task scope.
8. Local verification — the stage-completion gate (see CI below: once a skeleton and
   CI exist, these are the CI-equivalent commands, run locally).
9. Contract tests / AI eval where the Stage Contract lists them as applicable.
10. Independent read-only review.
11. At most two rounds of targeted fixes; unresolved blocking findings stop the stage.
12. Milestone convergence review after a Group or key end-to-end flow (not every stage).
13. Check the corresponding `tasks.md` checkbox(es) — only after 8–11 all pass.
14. safe-commit `check` → user approval → `commit` (the checkpoint's
    `ready_for_safe_commit` state and the checkbox change are committed in this same
    batch — see Session continuity and recovery).
15. Ask separately about push → user approval → `push`.
16. Remote CI runs against the pushed commit — see CI below for what happens next.

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
integration/E2E → safe-commit's own tests → secret scanning → dependency vulnerability
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
scope expansion.

**Convergence review** (after a Group or key end-to-end flow) additionally checks:
proposal/spec/design/tasks/code/tests still agree; no retired mechanism lingers; every
checked task checkbox has real evidence; facts discovered during implementation have
been written back to OpenSpec; security/privacy boundaries still hold.

## Session continuity and recovery

**Sources of truth**: OpenSpec task checkboxes (completion); Git commits (durable stage
boundaries); the current change's `scratchpad.md` Implementation Checkpoint (recovery
notes for the single in-progress stage, not a second task-status system); the
uncommitted worktree (possibly in-progress, never proof of completion by itself).

**Implementation Checkpoint** lives in `openspec/changes/<change>/scratchpad.md` as one
bounded section covering only the current stage: stage ID; OpenSpec task IDs; Stage
Contract summary; user-approval status; exact paths allowed to change; work completed;
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
    the remote CI status from step 8 if applicable; what's about to happen next.
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
