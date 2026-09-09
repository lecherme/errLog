import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const CLI = path.resolve(import.meta.dirname, '..', 'tools', 'safe-commit.mjs');
const temporaryPaths = [];
let requestNumber = 0;

async function command(cwd, executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: options.env ?? process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function git(repo, ...args) {
  const result = await command(repo, 'git', args);
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function initRepo({ branch = 'feature', allowPush = undefined } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'safe-commit-test-'));
  temporaryPaths.push(repo);
  await git(repo, 'init', `--initial-branch=${branch}`);
  await git(repo, 'config', 'user.name', 'Safe Commit Test');
  await git(repo, 'config', 'user.email', 'safe-commit@example.invalid');
  await writeFile(path.join(repo, 'tracked.txt'), 'tracked v1\n');
  await writeFile(path.join(repo, 'extra.txt'), 'extra v1\n');
  if (allowPush !== undefined) {
    await writeFile(path.join(repo, '.safe-commit.json'), JSON.stringify({
      protectedBranches: ['main', 'master', 'trunk'],
      denyPatterns: ['.git/**', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/credentials.*', '**/secrets/**', 'node_modules/**'],
      allowPush,
      requireCleanIndex: true,
      planTtlMinutes: 15,
    }));
  }
  await git(repo, 'add', '--', 'tracked.txt', 'extra.txt', ...(allowPush === undefined ? [] : ['.safe-commit.json']));
  await git(repo, 'commit', '-m', 'initial');
  return repo;
}

async function request(repo, overrides = {}) {
  const value = {
    schemaVersion: 1,
    producer: 'any-harness',
    taskId: 'task-42',
    files: ['tracked.txt'],
    commitMessage: 'test: safe exact commit',
    metadata: { ignoredPermissionAttempt: true },
    ...overrides,
  };
  const directory = path.join(repo, '.git', 'safe-commit-test-requests');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${++requestNumber}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

async function cliWithOptions(repo, options, ...args) {
  const result = await command(repo, process.execPath, [CLI, ...args, '--json'], options);
  let json;
  try { json = JSON.parse(result.stdout); }
  catch { assert.fail(`CLI did not return JSON (exit ${result.code}): ${result.stdout}\n${result.stderr}`); }
  return { ...result, json };
}

async function cli(repo, ...args) {
  return await cliWithOptions(repo, {}, ...args);
}

async function check(repo, files = ['tracked.txt'], overrides = {}) {
  const requestFile = await request(repo, { files, ...overrides });
  return await cli(repo, 'check', '--request', requestFile);
}

after(async () => {
  for (const item of temporaryPaths) await rm(item, { recursive: true, force: true });
});

test('check is read-only and commit includes only requested files', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'tracked v2\n');
  await writeFile(path.join(repo, 'extra.txt'), 'extra v2\n');

  const planned = await check(repo, ['tracked.txt'], { producer: 'superflowers', taskId: 'future-task' });
  assert.equal(planned.code, 0);
  assert.equal(planned.json.producer, 'superflowers');
  assert.equal(planned.json.taskId, 'future-task');
  assert.deepEqual(planned.json.files.map((item) => item.path), ['tracked.txt']);
  assert.ok(planned.json.ignoredFiles.some((item) => item.path === 'extra.txt'));
  assert.equal(await git(repo, 'diff', '--cached', '--name-only'), '');

  const inspected = await cli(repo, 'inspect', '--plan', planned.json.planId);
  assert.equal(inspected.code, 0);
  assert.equal(inspected.json.state, 'ready');

  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  assert.match(committed.json.commitSha, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(repo, 'show', '--format=', '--name-only', 'HEAD'), 'tracked.txt');
  assert.equal(await git(repo, 'status', '--short', '--', 'extra.txt'), 'M extra.txt');

  const repeated = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(repeated.code, 11);
  assert.equal(repeated.json.errors[0].code, 'PLAN_CONSUMED');
});

test('added, deleted, renamed, spaces, and Unicode paths commit exactly', async () => {
  const repo = await initRepo();
  const unicode = 'new file 题目.txt';
  const renamed = 'renamed 文件.txt';
  await writeFile(path.join(repo, unicode), 'new\n');
  await rm(path.join(repo, 'tracked.txt'));
  await rename(path.join(repo, 'extra.txt'), path.join(repo, renamed));

  const planned = await check(repo, ['tracked.txt', 'extra.txt', renamed, unicode]);
  assert.equal(planned.code, 0);
  assert.equal(planned.json.files.length, 4);
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  const changed = (await git(repo, '-c', 'core.quotepath=false', 'diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', 'HEAD')).split('\n').sort();
  assert.deepEqual(changed, ['extra.txt', renamed, 'tracked.txt', unicode].sort());
});

test('core.fileMode=false predicts Git mode for a new executable file', async () => {
  const repo = await initRepo();
  await git(repo, 'config', 'core.fileMode', 'false');
  const file = 'run.sh';
  await writeFile(path.join(repo, file), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(repo, file), 0o755);
  const planned = await check(repo, [file]);
  assert.equal(planned.code, 0);
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  const entry = await git(repo, 'ls-tree', 'HEAD', '--', file);
  assert.match(entry, /^100644 blob /u);
});

test('invalid, escaping, denied, symlink, directory, and unchanged paths are rejected', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');

  for (const files of [['/etc/passwd'], ['C:/secret'], ['../outside'], ['bad\nname'], ['bad\0name'], ['tracked.txt', 'tracked.txt']]) {
    const result = await check(repo, files);
    assert.equal(result.code, 4);
  }
  await mkdir(path.join(repo, 'directory'));
  assert.equal((await check(repo, ['directory'])).code, 4);
  await symlink(os.tmpdir(), path.join(repo, 'outside-link'));
  assert.equal((await check(repo, ['outside-link/not-here.txt'])).code, 4);
  await symlink(path.join(os.tmpdir(), 'missing-safe-commit-target'), path.join(repo, 'broken-outside-link'));
  assert.equal((await check(repo, ['broken-outside-link'])).code, 4);
  await writeFile(path.join(repo, '.env'), 'SECRET=value\n');
  assert.equal((await check(repo, ['.env'])).code, 5);
  await writeFile(path.join(repo, '.gitignore'), '*.ignored\n');
  await writeFile(path.join(repo, 'generated.ignored'), 'generated\n');
  const ignored = await check(repo, ['generated.ignored']);
  assert.equal(ignored.code, 7);
  assert.equal(ignored.json.errors[0].code, 'FILE_IGNORED');
  assert.equal((await check(repo, ['extra.txt'])).code, 7);
});

test('protected branches and a non-empty index are rejected with stable codes', async () => {
  const protectedRepo = await initRepo({ branch: 'main' });
  await writeFile(path.join(protectedRepo, 'tracked.txt'), 'changed\n');
  assert.equal((await check(protectedRepo)).code, 5);

  const dirtyRepo = await initRepo();
  await writeFile(path.join(dirtyRepo, 'tracked.txt'), 'changed\n');
  await git(dirtyRepo, 'add', '--', 'tracked.txt');
  assert.equal((await check(dirtyRepo)).code, 6);
});

test('file, HEAD, branch, policy, and expiry changes invalidate a plan', async () => {
  const fileRepo = await initRepo();
  await writeFile(path.join(fileRepo, 'tracked.txt'), 'v2\n');
  const filePlan = await check(fileRepo);
  await writeFile(path.join(fileRepo, 'tracked.txt'), 'v3\n');
  assert.equal((await cli(fileRepo, 'commit', '--plan', filePlan.json.planId)).code, 10);
  assert.equal(await git(fileRepo, 'diff', '--cached', '--name-only'), '');

  const headRepo = await initRepo();
  await writeFile(path.join(headRepo, 'tracked.txt'), 'v2\n');
  const headPlan = await check(headRepo);
  await writeFile(path.join(headRepo, 'extra.txt'), 'head change\n');
  await git(headRepo, 'add', '--', 'extra.txt');
  await git(headRepo, 'commit', '-m', 'move head');
  assert.equal((await cli(headRepo, 'commit', '--plan', headPlan.json.planId)).code, 10);

  const branchRepo = await initRepo();
  await writeFile(path.join(branchRepo, 'tracked.txt'), 'v2\n');
  const branchPlan = await check(branchRepo);
  await git(branchRepo, 'switch', '-c', 'other-feature');
  assert.equal((await cli(branchRepo, 'commit', '--plan', branchPlan.json.planId)).code, 10);

  const policyRepo = await initRepo();
  await writeFile(path.join(policyRepo, 'tracked.txt'), 'v2\n');
  const policyPlan = await check(policyRepo);
  await writeFile(path.join(policyRepo, '.safe-commit.json'), JSON.stringify({ ...JSON.parse(await readFile(path.resolve(import.meta.dirname, '..', '.safe-commit.json'), 'utf8')), planTtlMinutes: 20 }));
  assert.equal((await cli(policyRepo, 'commit', '--plan', policyPlan.json.planId)).code, 10);

  const expiryRepo = await initRepo();
  await writeFile(path.join(expiryRepo, 'tracked.txt'), 'v2\n');
  const expiryPlan = await check(expiryRepo);
  const planFile = path.join(expiryRepo, '.git', 'safe-commit', 'plans', `${expiryPlan.json.planId}.json`);
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  plan.expiresAt = new Date(0).toISOString();
  await writeFile(planFile, JSON.stringify(plan));
  assert.equal((await cli(expiryRepo, 'commit', '--plan', expiryPlan.json.planId)).code, 9);
});

test('commit failure cleans staging and permits a safe retry', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);

  const failed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(failed.code, 13);
  assert.equal(await git(repo, 'diff', '--cached', '--name-only'), '');
  assert.equal((await cli(repo, 'inspect', '--plan', planned.json.planId)).json.state, 'ready');

  await rm(hook);
  assert.equal((await cli(repo, 'commit', '--plan', planned.json.planId)).code, 0);
});

test('worktree lock rejects a real concurrent committer immediately', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nsleep 1\n');
  await chmod(hook, 0o755);
  const firstPromise = cli(repo, 'commit', '--plan', planned.json.planId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await cli(repo, 'commit', '--plan', planned.json.planId);
  const first = await firstPromise;
  assert.equal(first.code, 0);
  assert.equal(second.code, 12);
  assert.equal(second.json.errors[0].code, 'LOCKED');
});
test('a dead lock is recovered only after its TTL', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const worktreeId = createHash('sha256').update(await realpath(repo)).digest('hex').slice(0, 24);
  const lock = path.join(repo, '.git', 'safe-commit', 'locks', worktreeId);
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: 99_999_999, token: 'dead-test' }));
  const expired = new Date(Date.now() - 16 * 60_000);
  await utimes(lock, expired, expired);
  assert.equal((await cli(repo, 'commit', '--plan', planned.json.planId)).code, 0);
});

test('staged-set mismatch is rejected and all operation staging is cleaned', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  await writeFile(path.join(repo, 'extra.txt'), 'extra v2\n');
  const planned = await check(repo);
  const realGit = (await command(repo, 'which', ['git'])).stdout.trim();
  const fakeBin = path.join(repo, '.git', 'fake-bin');
  await mkdir(fakeBin, { recursive: true });
  const wrapper = path.join(fakeBin, 'git');
  await writeFile(wrapper, `#!/bin/sh\n${JSON.stringify(realGit)} "$@"\ncode=$?\nif [ "$1" = "add" ] && [ "$code" -eq 0 ]; then\n  ${JSON.stringify(realGit)} add -- extra.txt\nfi\nexit "$code"\n`);
  await chmod(wrapper, 0o755);
  const result = await cliWithOptions(repo, { env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } }, 'commit', '--plan', planned.json.planId);
  assert.equal(result.code, 10);
  assert.equal(result.json.errors[0].code, 'STAGED_SET_MISMATCH');
  assert.equal(await git(repo, 'diff', '--cached', '--name-only'), '');
});

test('content changed between verification and git add is not committed', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'reviewed v2\n');
  const planned = await check(repo);
  const realGit = (await command(repo, 'which', ['git'])).stdout.trim();
  const fakeBin = path.join(repo, '.git', 'toctou-bin');
  await mkdir(fakeBin, { recursive: true });
  const wrapper = path.join(fakeBin, 'git');
  await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = "add" ]; then\n  printf 'changed during add\\n' > tracked.txt\nfi\n${JSON.stringify(realGit)} "$@"\n`);
  await chmod(wrapper, 0o755);
  const result = await cliWithOptions(repo, { env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } }, 'commit', '--plan', planned.json.planId);
  assert.equal(result.code, 10);
  assert.equal(result.json.errors[0].code, 'STAGED_CONTENT_MISMATCH');
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(await git(repo, 'diff', '--cached', '--name-only'), '');
});

test('a pre-commit hook that changes the index aborts the commit', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'reviewed v2\n');
  const planned = await check(repo);
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nprintf "changed by hook\\n" > tracked.txt\ngit add -- tracked.txt\n');
  await chmod(hook, 0o755);
  const result = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(result.code, 10);
  assert.equal(result.json.errors[0].code, 'HOOK_CHANGED_INDEX');
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(await git(repo, 'diff', '--cached', '--name-only'), '');
});

test('CommonJS wrapper runs a configured hook with module detection disabled', async () => {
  const repo = await initRepo();
  const hooks = path.join(repo, 'custom-hooks');
  await mkdir(hooks);
  await git(repo, 'config', 'core.hooksPath', 'custom-hooks');
  const hook = path.join(hooks, 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nprintf "ran\\n" > hook-ran.txt\n');
  await chmod(hook, 0o755);
  await writeFile(path.join(repo, 'tracked.txt'), 'reviewed v2\n');
  const planned = await check(repo);
  const nodeOptions = [process.env.NODE_OPTIONS, '--no-experimental-detect-module'].filter(Boolean).join(' ');
  const committed = await cliWithOptions(repo, { env: { ...process.env, NODE_OPTIONS: nodeOptions } }, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  assert.equal(await readFile(path.join(repo, 'hook-ran.txt'), 'utf8'), 'ran\n');
  assert.equal(await git(repo, 'show', '--format=', '--name-only', 'HEAD'), 'tracked.txt');
});

test('push policy denial occurs before commit and later push remains denied', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const denied = await cli(repo, 'commit', '--plan', planned.json.planId, '--push');
  assert.equal(denied.code, 14);
  assert.equal(denied.json.commitSha, null);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '1');
  const result = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(result.code, 0);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal((await cli(repo, 'commit', '--plan', planned.json.planId)).code, 11);
  const retry = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(retry.code, 14);
  assert.equal(retry.json.commitSha, result.json.commitSha);
});

test('missing upstream is distinct and push retry requires the committed plan at HEAD', async () => {
  const repo = await initRepo({ allowPush: true });
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);

  const missing = await cli(repo, 'commit', '--plan', planned.json.planId, '--push');
  assert.equal(missing.code, 15);
  assert.equal(missing.json.errors[0].code, 'UPSTREAM_MISSING');
  assert.match(missing.json.commitSha, /^[a-f0-9]{40,64}$/);

  const missingAgain = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(missingAgain.code, 15);
  assert.equal(missingAgain.json.errors[0].code, 'UPSTREAM_MISSING');

  await git(repo, 'commit', '--allow-empty', '-m', 'test: advance head');
  const stale = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(stale.code, 10);
  assert.equal(stale.json.errors[0].code, 'HEAD_CHANGED');
  assert.equal(stale.json.commitSha, missing.json.commitSha);

});

test('push rejects committed plans with a mismatched or missing approved tree', async () => {
  const repo = await initRepo({ allowPush: true });
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  const planFile = path.join(repo, '.git', 'safe-commit', 'plans', `${planned.json.planId}.json`);
  const stored = JSON.parse(await readFile(planFile, 'utf8'));
  stored.approvedTree = '0'.repeat(40);
  await writeFile(planFile, JSON.stringify(stored));

  const mismatch = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(mismatch.code, 13);
  assert.equal(mismatch.json.errors[0].code, 'COMMIT_TREE_MISMATCH');

  delete stored.approvedTree;
  await writeFile(planFile, JSON.stringify(stored));
  const missing = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(missing.code, 13);
  assert.equal(missing.json.errors[0].code, 'COMMIT_TREE_MISMATCH');
});


test('push failure is retryable without creating another commit', async () => {
  const repo = await initRepo({ allowPush: true });
  const initialRemote = await mkdtemp(path.join(os.tmpdir(), 'safe-commit-remote-'));
  temporaryPaths.push(initialRemote);
  await git(initialRemote, 'init', '--bare');
  await git(repo, 'remote', 'add', 'origin', initialRemote);
  await git(repo, 'push', '-u', 'origin', 'feature');
  await git(repo, 'remote', 'set-url', 'origin', path.join(repo, 'missing-remote'));
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');

  const planned = await check(repo);
  const failed = await cli(repo, 'commit', '--plan', planned.json.planId, '--push');
  assert.equal(failed.code, 15);
  assert.match(failed.json.commitSha, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');

  const retryRemote = await mkdtemp(path.join(os.tmpdir(), 'safe-commit-retry-'));
  temporaryPaths.push(retryRemote);
  await git(retryRemote, 'init', '--bare');
  await git(repo, 'remote', 'set-url', 'origin', retryRemote);
  const retried = await cli(repo, 'push', '--plan', planned.json.planId);
  assert.equal(retried.code, 0);
  assert.equal(retried.json.pushed, true);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(await git(retryRemote, 'rev-parse', 'refs/heads/feature'), failed.json.commitSha);

});

test('Git without hook run support fails early with a stable code', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const requestFile = await request(repo);
  const realGit = (await command(repo, 'which', ['git'])).stdout.trim();
  const fakeBin = path.join(repo, '.git', 'old-git-bin');
  await mkdir(fakeBin, { recursive: true });
  const wrapper = path.join(fakeBin, 'git');
  await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = "hook" ]; then\n  printf "git: 'hook' is not a git command\\n" >&2\n  exit 1\nfi\nexec ${JSON.stringify(realGit)} "$@"\n`);
  await chmod(wrapper, 0o755);
  const result = await cliWithOptions(repo, { env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } }, 'check', '--request', requestFile);
  assert.equal(result.code, 3);
  assert.equal(result.json.errors[0].code, 'UNSUPPORTED_GIT');
});

test('schema and repository policy are valid JSON', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.equal(JSON.parse(await readFile(path.join(root, 'docs', 'safe-commit-request.schema.json'), 'utf8')).properties.schemaVersion.const, 1);
  assert.equal(JSON.parse(await readFile(path.join(root, '.safe-commit.json'), 'utf8')).allowPush, true);
});
