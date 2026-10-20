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
5. After a separate, explicit push approval, run the guarded push (see "Guarded push"):
   `node tools/safe-commit.mjs push --plan PLAN_ID --endpoint-sha256 HASH --target-ref refs/heads/BRANCH --json`.
   Once Git has been invoked, a failed push keeps its `attempted` record, because the
   remote may have received the commit before the transport failed. A retry therefore
   needs `verify-push` first (separately approved): it either completes the push record
   or clears the attempt when the remote still holds the previous commit. Only then can
   the same command run again, while the current branch and HEAD still identify that
   plan's safe-commit commit; under the delivery gate the retry also goes through a
   `push_retry` record, its Codex review, and a new user approval.

`commit` never pushes: any `--push` argument to `commit` fails with `COMMIT_PUSH_REMOVED`
(exit 2) before the plan is read, the index is touched, or a commit is created. Commit
and push are always two commands with two separate approvals.

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
retrying the former. The latter keeps its push attempt: run the separately approved
`verify-push` before any retry (under the delivery gate also a `push_retry` record, its
Codex review, and a new user approval). Exit code 7 similarly uses
`FILE_IGNORED` or `FILE_UNCHANGED`. The other push codes are listed under "Guarded push".

`inspect` additionally returns `binding`, the non-secret plan facts that the delivery
handoff (`tools/stage-handoff.mjs --channel delivery`) binds:

```text
binding: { head, policyHash, indexEntries: [{ path, mode, hash }], approvedTree,
           endpoint: { sha256 | null, error: <code> | null },
           push: null | { state: attempted | pushed | verified, endpointSha256,
                          targetRef, commitSha, trackingRef, remoteSha | null },
           clearedAttempts: <number of push attempts verify-push cleared> }
```

`approvedTree` is `null` before commit. `endpoint` is resolved live from the branch's
upstream remote configuration, without network access. `binding` never contains the
repository, worktree or plan paths, Git output, or a URL.

## Repository policy

`.safe-commit.json` owns protected branches, denied path patterns, push permission, and
plan TTL. Version 1 requires `requireCleanIndex: true`; accepting a pre-populated index
would make the exact-file commit guarantee ambiguous. Unknown policy fields are rejected
intentionally: policy/version mismatches fail closed instead of silently weakening
enforcement.

Push is an explicit opt-in. It targets only the current branch's configured upstream
and never force-pushes.

## Guarded push

`push` requires both `--endpoint-sha256` (the SHA-256 of the reviewed push endpoint) and
`--target-ref` (the reviewed full `refs/heads/<branch>`). Without either it fails with
`ENDPOINT_HASH_REQUIRED` (exit 2); a malformed value fails with `USAGE`. Both values come
from the Codex-reviewed push-ready delivery record. Only for the H3 bootstrap, or when the
user has explicitly waived the delivery review, do they come from `inspect`'s
`binding.endpoint.sha256` and the upstream's full merge ref, shown to the user with the
push approval request.

Under the worktree lock, after the HEAD and approved-tree checks, and before any network
I/O, push:

1. checks the target ref with `git check-ref-format`, and refuses a protected branch
   (`PROTECTED_BRANCH`, also when the configured upstream was changed to one);
2. requires `branch.<b>.merge` to equal the target ref (`PUSH_TARGET_CHANGED`) and the
   upstream tracking ref to be `refs/remotes/<remote>/<branch>` (`UNSUPPORTED_UPSTREAM`);
3. resolves the single push endpoint (below) and compares its hash with
   `--endpoint-sha256` (`PUSH_ENDPOINT_CHANGED`);
4. records `push.state: attempted`, then pushes `<commit>:<target-ref>` to the resolved
   URL itself, so Git never looks the remote up again;
5. as soon as Git reports success, records `pushed: true` and `push.state: pushed`;
6. updates the local tracking ref from its previous value, then reads the target ref back
   from the same endpoint with `ls-remote` and records `remoteSha` and `push.state: verified`.

A refusal in steps 1–3 happens before any network I/O and leaves the plan unpushed. Once
step 4 has recorded the attempt, a push that Git reports as failed (`PUSH_FAILED`) keeps
`push.state: attempted`: a transport can fail after the remote updated its ref, so the
outcome is unknown. A failure in step 6 leaves `push.state: pushed` with
`TRACKING_REF_UPDATE_FAILED`, `REMOTE_UNVERIFIED` or `REMOTE_MISMATCH`. None of these
retries the push. A plan in `attempted` state (a failed or interrupted push) is refused
with `PUSH_OUTCOME_UNKNOWN`; a pushed plan that is not yet verified returns
`PUSH_VERIFICATION_PENDING`. Both are resolved only with `verify-push`.

### Push endpoints

The endpoint is `git remote get-url --push --all <remote>` (which applies `pushurl`,
`insteadOf` and `pushInsteadOf`). Exactly one is required: none (including remote `.`)
is `NO_PUSH_ENDPOINT`, more than one is `MULTIPLE_PUSH_ENDPOINTS`. Supported forms are
`ssh://`, `https://` and scp-like `[user@]host:path`. Local paths and `file://` are
`LOCAL_PUSH_ENDPOINT`; other forms (`http://`, `git://`, `ext::` and so on), and an
endpoint that a URL rewrite rule would rewrite again, are `UNSUPPORTED_PUSH_ENDPOINT`. Any
https userinfo, or a password in an ssh or scp-like endpoint, is `CREDENTIAL_IN_ENDPOINT`.
The hash is SHA-256 of `errlog-push-endpoint/v1` NUL `<url bytes>` NUL.

The URL stays inside the safe-commit process and is passed to Git only as an argument.
Push and `verify-push` errors carry only a code, a fixed message, `commitSha` and
`gitExitCode`: Git's stdout and stderr, which can contain the URL, are never output or
stored. Network calls disable terminal prompts.

### verify-push

`node tools/safe-commit.mjs verify-push --plan PLAN_ID --json` is a recovery command with
its own approval; it is not a push approval and never runs `git push`. Under the lock it
first checks that the recorded endpoint hash and target ref still match the configuration
(no network otherwise), then reads the target ref from the endpoint:

- `pushed`: if the remote holds the commit, it moves the tracking ref from its previous
  value (or leaves it if already there) and records `verified`; a tracking ref at any other
  commit is `TRACKING_REF_CONFLICT`, a different remote commit is `REMOTE_MISMATCH`.
- `attempted`: if the remote holds the commit, it records `pushed: true` and continues as
  above; if the remote still holds the previous commit, it clears the attempt, increments
  `clearedAttempts`, and the plan is unpushed again; otherwise `REMOTE_MISMATCH`. The
  delivery channel treats any increase of `clearedAttempts` as voiding the earlier push
  review, so a new push needs a new `push_retry` record, Codex review, and approval.
- `verified`: nothing changes.

## Lock recovery

One lock exists per worktree. A dead owner's lock is reclaimed only after the policy TTL.
For safety, a lock whose recorded PID is still alive is never stolen automatically,
because the running operation could legitimately be slow. Rare PID reuse can therefore
leave a false-positive lock. If that happens, first verify that no `safe-commit`
operation is running, resolve the private state root with
`git rev-parse --git-path safe-commit`, and remove only the affected worktree's lock
directory below its `locks/` subdirectory.
