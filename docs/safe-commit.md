# safe-commit protocol v1

`safe-commit` is a task-agnostic Git commit executor. An upstream harness decides which
files belong to one task; this tool validates and commits exactly those files. It does
not infer task scope, assess implementation correctness, or contain OpenSpec-specific
logic.

## Requirements

- Node.js 20 or newer.
- Git 2.36 or newer with `git hook run` support.

## Commit Request

```json
{
  "schemaVersion": 1,
  "producer": "superflowers",
  "taskId": "implement-auth-middleware",
  "files": ["src/auth/middleware.ts", "test/auth/middleware.test.ts"],
  "commitMessage": "feat(auth): add authentication middleware",
  "metadata": {}
}
```

Paths use `/`, are relative to the repository root, name individual files, and must be
unique. `metadata` is recorded but never changes permissions or behavior. Repository
policy comes only from `.safe-commit.json`; requests cannot weaken it.
The machine-readable schema is `docs/safe-commit-request.schema.json`.

## Harness flow

1. Decide the exact files that belong to the current task and write a request JSON.
2. Run `node tools/safe-commit.mjs check --request request.json --json`.
3. Show the returned plan, including unrelated changes that will be ignored.
4. After explicit approval, run `node tools/safe-commit.mjs commit --plan PLAN_ID --json`.
5. Add `--push` only when the repository policy permits it. If commit succeeds but
   push fails, retry only the push with
   `node tools/safe-commit.mjs push --plan PLAN_ID --json`. This retry is valid only
   while the current branch and HEAD still identify that plan's safe-commit commit.

The harness must not replace this flow with broad Git mutations such as `git add .`,
an unscoped `git add -A`, amend, force-push, or an implicit multi-branch push.

`check` never modifies the index, creates a commit, or pushes. Plans are stored below a
path resolved by `git rev-parse --git-path safe-commit`, outside the worktree. They bind
the repository, worktree, Git directory, HEAD, branch, policy, exact file statuses,
content hashes, and the blob IDs and modes that Git is expected to stage. They expire
after the configured TTL and are consumed after commit.

Immediately before committing, the tool verifies both the staged path set and every
staged blob/mode, then records the approved Git tree. Existing commit hooks still run.
A wrapper aborts if `pre-commit`, `prepare-commit-msg`, or `commit-msg` changes the
index. The resulting commit tree is checked immediately after commit and again before
every push; a committed plan that lacks a valid `approvedTree` is rejected. A hook may
change working-tree files that it does not stage; those changes remain uncommitted.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Invalid CLI usage |
| 3 | Unsupported Git, invalid Git context, or Git inspection failure |
| 4 | Invalid request or unsafe path |
| 5 | Repository policy denied the operation |
| 6 | Index was not empty |
| 7 | A requested file had no Git change or is ignored by Git |
| 8 | Plan was missing or malformed |
| 9 | Plan expired |
| 10 | Plan or exact staged content became stale |
| 11 | Plan was already consumed or is not in the required state |
| 12 | Another operation holds the worktree lock |
| 13 | Staging/commit failed, or committed tree verification failed |
| 14 | Push is disabled by policy |
| 15 | Push failed; a successful commit is retained |
| 16 | Unexpected internal failure |

With `--json`, every result contains `ok`, `action`, `producer`, `taskId`, `planId`,
`branch`, `files`, `ignoredFiles`, `commitMessage`, `commitSha`, `pushed`, and `errors`.
Errors include a stable symbolic `code`; callers should use the process exit code for
the broad failure class and the symbolic code for detailed handling.

Git installations without `git hook run` support fail before any plan or commit work
with exit code 3 and symbolic code `UNSUPPORTED_GIT`.

Exit code 15 uses `UPSTREAM_MISSING` when no pushable upstream is configured and
`PUSH_FAILED` for a rejected or transport-failed push. Configure an upstream before
retrying the former; the latter can be retried directly. Exit code 7 similarly uses
`FILE_IGNORED` or `FILE_UNCHANGED`.

## Repository policy

`.safe-commit.json` owns protected branches, denied path patterns, push permission, and
plan TTL. Version 1 requires `requireCleanIndex: true`; accepting a pre-populated index
would make the exact-file commit guarantee ambiguous. Unknown policy fields are rejected
intentionally: policy/version mismatches fail closed instead of silently weakening
enforcement.

Push is an explicit opt-in. It targets only the current branch's configured upstream
using an explicit `HEAD:refs/heads/...` refspec and never force-pushes.

## Lock recovery

One lock exists per worktree. A dead owner's lock is reclaimed only after the policy TTL.
For safety, a lock whose recorded PID is still alive is never stolen automatically,
because the running operation could legitimately be slow. Rare PID reuse can therefore
leave a false-positive lock. If that happens, first verify that no `safe-commit`
operation is running, resolve the private state root with
`git rev-parse --git-path safe-commit`, and remove only the affected worktree's lock
directory below its `locks/` subdirectory.
