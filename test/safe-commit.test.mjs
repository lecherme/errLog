import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
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

const ANY_HASH = 'f'.repeat(64);
const guards = (hash, targetRef = 'refs/heads/feature') => ['--endpoint-sha256', hash, '--target-ref', targetRef];
const endpointHash = (url) => createHash('sha256').update(Buffer.concat([
  Buffer.from('errlog-push-endpoint/v1\0', 'utf8'), Buffer.from(url, 'utf8'), Buffer.from('\0', 'utf8'),
])).digest('hex');
const URL_SENTINEL = 'url-sentinel-4b7e';
const CREDENTIAL_SENTINEL = 'credential-sentinel-9c2d';

// Test-only ssh transport: ssh://git.example.invalid/<name>.git is served from a local bare
// repo through GIT_SSH_COMMAND, so pushes never touch the network. Every call is logged; a
// mode file makes the transport fail or kill the calling safe-commit process.
const WRAPPER_SOURCE = `
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const fixture = process.env.SAFE_COMMIT_TEST_FIXTURE;
const [host, cmd] = process.argv.slice(-2);
const match = /^(git-receive-pack|git-upload-pack) '(.+)'$/.exec(cmd);
if (!match || !host.endsWith('example.invalid')) process.exit(255);
const service = match[1];
const name = path.basename(match[2]);
const mode = existsSync(path.join(fixture, 'mode')) ? readFileSync(path.join(fixture, 'mode'), 'utf8').trim() : '';
appendFileSync(path.join(fixture, 'calls.log'), service + ' ' + name + '\\n');
function killSafeCommit() {
  for (let pid = process.ppid; pid > 1;) {
    if (readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes('safe-commit.mjs')) return process.kill(pid, 'SIGKILL');
    pid = Number(readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ')[1].split(' ')[1]);
  }
}
if (mode === 'fail-all' || (mode === 'fail-upload' && service === 'git-upload-pack')) {
  process.stderr.write('fatal: ${URL_SENTINEL} ${CREDENTIAL_SENTINEL} transport failed\\n');
  process.stdout.write('${URL_SENTINEL} ${CREDENTIAL_SENTINEL}\\n');
  process.exit(128);
}
if (mode === 'kill-before-receive' && service === 'git-receive-pack') {
  killSafeCommit();
  process.exit(128);
}
const result = spawnSync('git', [service.slice(4), path.join(fixture, 'remotes', name)], { stdio: 'inherit' });
if (mode === 'kill-after-receive' && service === 'git-receive-pack' && result.status === 0) killSafeCommit();
// The remote ref is updated, but the transport then fails before Git sees an acknowledgement.
if (mode === 'fail-after-receive' && service === 'git-receive-pack') process.exit(128);
process.exit(result.status ?? 1);
`;

async function remoteFixture(repo) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'safe-commit-remote-'));
  temporaryPaths.push(fixture);
  await mkdir(path.join(fixture, 'remotes'));
  await writeFile(path.join(fixture, 'wrapper.mjs'), WRAPPER_SOURCE);
  await writeFile(path.join(fixture, 'calls.log'), '');
  const env = {
    ...process.env,
    SAFE_COMMIT_TEST_FIXTURE: fixture,
    GIT_SSH_COMMAND: `"${process.execPath}" "${path.join(fixture, 'wrapper.mjs')}"`,
    GIT_SSH_VARIANT: 'simple',
  };
  const remoteDir = (name) => path.join(fixture, 'remotes', `${name}.git`);
  const helper = {
    env,
    url: (name) => `ssh://git.example.invalid/${name}.git`,
    remoteDir,
    async bare(name) {
      await git(fixture, 'init', '--bare', '-q', remoteDir(name));
      return remoteDir(name);
    },
    async calls() {
      return (await readFile(path.join(fixture, 'calls.log'), 'utf8')).split('\n').filter(Boolean);
    },
    async setMode(mode) {
      await writeFile(path.join(fixture, 'mode'), mode);
    },
    async git(...args) {
      const result = await command(repo, 'git', args, { env });
      assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
      return result.stdout.trim();
    },
    async cli(...args) {
      return await cliWithOptions(repo, { env }, ...args);
    },
    async human(...args) {
      return await command(repo, process.execPath, [CLI, ...args], { env });
    },
  };
  await git(fixture, 'clone', '--bare', '-q', repo, remoteDir('origin'));
  await git(repo, 'remote', 'add', 'origin', helper.url('origin'));
  await helper.git('fetch', '-q', 'origin');
  await git(repo, 'branch', `--set-upstream-to=origin/${await git(repo, 'branch', '--show-current')}`);
  await writeFile(path.join(fixture, 'calls.log'), '');
  return helper;
}

async function inspectPlan(repo, planId, env = process.env) {
  const result = await cliWithOptions(repo, { env }, 'inspect', '--plan', planId);
  assert.equal(result.code, 0, result.stdout);
  return result.json;
}

async function committedPlan(repo) {
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0, committed.stdout);
  return { planId: planned.json.planId, commitSha: committed.json.commitSha };
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
  assert.equal(denied.code, 2);
  assert.equal(denied.json.errors[0].code, 'COMMIT_PUSH_REMOVED');
  assert.equal(denied.json.commitSha, null);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '1');
  const result = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(result.code, 0);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal((await cli(repo, 'commit', '--plan', planned.json.planId)).code, 11);
  const retry = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
  assert.equal(retry.code, 14);
  assert.equal(retry.json.commitSha, result.json.commitSha);
});

test('missing upstream is distinct and push retry requires the committed plan at HEAD', async () => {
  const repo = await initRepo({ allowPush: true });
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);

  const removed = await cli(repo, 'commit', '--plan', planned.json.planId, '--push');
  assert.equal(removed.code, 2);
  assert.equal(removed.json.errors[0].code, 'COMMIT_PUSH_REMOVED');
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  assert.match(committed.json.commitSha, /^[a-f0-9]{40,64}$/);

  const missing = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
  assert.equal(missing.code, 15);
  assert.equal(missing.json.errors[0].code, 'UPSTREAM_MISSING');
  assert.equal(missing.json.commitSha, committed.json.commitSha);

  const missingAgain = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
  assert.equal(missingAgain.code, 15);
  assert.equal(missingAgain.json.errors[0].code, 'UPSTREAM_MISSING');

  await git(repo, 'commit', '--allow-empty', '-m', 'test: advance head');
  const stale = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
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

  const mismatch = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
  assert.equal(mismatch.code, 13);
  assert.equal(mismatch.json.errors[0].code, 'COMMIT_TREE_MISMATCH');

  delete stored.approvedTree;
  await writeFile(planFile, JSON.stringify(stored));
  const missing = await cli(repo, 'push', '--plan', planned.json.planId, ...guards(ANY_HASH));
  assert.equal(missing.code, 13);
  assert.equal(missing.json.errors[0].code, 'COMMIT_TREE_MISMATCH');
});


test('push failure is retryable without creating another commit, only after verify-push', async () => {
  const repo = await initRepo({ allowPush: true });
  // Local-path endpoints are refused, so the remotes are served through the ssh test wrapper.
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const originBefore = await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature');
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');

  const planned = await check(repo);
  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  assert.equal(committed.code, 0);
  await remote.setMode('fail-all');
  const failed = await remote.cli('push', '--plan', planned.json.planId, ...guards(hash));
  assert.equal(failed.code, 15);
  assert.equal(failed.json.errors[0].code, 'PUSH_FAILED');
  assert.equal(failed.json.errors[0].details.stderr, undefined);
  assert.match(failed.json.commitSha, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');
  // Git invoked push, so its effect is unknown: the attempt stays until verify-push decides.
  assert.equal((await inspectPlan(repo, planned.json.planId)).binding.push.state, 'attempted');

  await remote.setMode('');
  const direct = await remote.cli('push', '--plan', planned.json.planId, ...guards(hash));
  assert.equal(direct.json.errors[0].code, 'PUSH_OUTCOME_UNKNOWN');
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);
  const cleared = await remote.cli('verify-push', '--plan', planned.json.planId);
  assert.equal(cleared.code, 0, cleared.stdout);
  assert.equal(cleared.json.pushed, false);
  assert.equal((await inspectPlan(repo, planned.json.planId)).binding.clearedAttempts, 1);
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), originBefore);

  const retried = await remote.cli('push', '--plan', planned.json.planId, ...guards(hash));
  assert.equal(retried.code, 0, retried.stdout);
  assert.equal(retried.json.pushed, true);
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), failed.json.commitSha);
});

test('B1: a nonzero push exit after the remote received the commit is never pushed again', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const { planId, commitSha } = await committedPlan(repo);
  await remote.setMode('fail-after-receive');
  const failed = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(failed.code, 15);
  assert.equal(failed.json.errors[0].code, 'PUSH_FAILED');
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), commitSha);
  let plan = await inspectPlan(repo, planId);
  assert.equal(plan.pushed, false);
  assert.equal(plan.binding.push.state, 'attempted');

  await remote.setMode('');
  const direct = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(direct.json.errors[0].code, 'PUSH_OUTCOME_UNKNOWN');
  const receives = (await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length;
  assert.equal(receives, 1);
  const reconciled = await remote.cli('verify-push', '--plan', planId);
  assert.equal(reconciled.code, 0, reconciled.stdout);
  plan = await inspectPlan(repo, planId);
  assert.equal(plan.pushed, true);
  assert.equal(plan.binding.push.state, 'verified');
  assert.equal(await git(repo, 'rev-parse', 'refs/remotes/origin/feature'), commitSha);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, receives);
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

test('B12: every commit --push form is refused before the plan, index, commit, or network is touched', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const id = planned.json.planId;
  const hash = endpointHash(remote.url('origin'));
  const forms = [
    ['commit', '--plan', id, '--push'],
    ['commit', '--push', '--plan', id],
    ['commit', '--plan', id, '--push', ...guards(hash)],
    ['commit', ...guards(hash), '--push', '--plan', id],
    ['commit', '--push=true', '--plan', id],
  ];
  for (const form of forms) {
    const result = await remote.cli(...form);
    assert.equal(result.code, 2, form.join(' '));
    assert.equal(result.json.errors[0].code, 'COMMIT_PUSH_REMOVED', form.join(' '));
    assert.equal(result.json.commitSha, null);
  }
  assert.equal(await git(repo, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal((await command(repo, 'git', ['diff', '--cached', '--quiet'])).code, 0);
  assert.equal((await inspectPlan(repo, id)).state, 'ready');
  assert.deepEqual(await remote.calls(), []);
  const committed = await cli(repo, 'commit', '--plan', id);
  assert.equal(committed.code, 0);
  assert.equal(committed.json.pushed, false);
  assert.deepEqual(await remote.calls(), []);
});

test('Q5-A: push needs both guards in valid form, refused before any network I/O', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const { planId } = await committedPlan(repo);
  const hash = endpointHash(remote.url('origin'));
  const cases = [
    [[], 'ENDPOINT_HASH_REQUIRED'],
    [['--endpoint-sha256', hash], 'ENDPOINT_HASH_REQUIRED'],
    [['--target-ref', 'refs/heads/feature'], 'ENDPOINT_HASH_REQUIRED'],
    [guards('abc'), 'USAGE'],
    [guards(hash.toUpperCase()), 'USAGE'],
    [guards(hash, 'feature'), 'USAGE'],
    [guards(hash, 'refs/tags/v1'), 'USAGE'],
    [guards(hash, 'refs/heads/a..b'), 'USAGE'],
    [guards(hash, 'refs/heads/bad.lock'), 'USAGE'],
  ];
  for (const [extra, code] of cases) {
    const result = await remote.cli('push', '--plan', planId, ...extra);
    assert.equal(result.code, 2, `${extra.join(' ')}: ${result.stdout}`);
    assert.equal(result.json.errors[0].code, code, extra.join(' '));
  }
  assert.equal((await inspectPlan(repo, planId)).pushed, false);
  assert.deepEqual(await remote.calls(), []);
});

test('B2/B8: guarded push binds endpoint and target, pushes the bound ref and reports binding by state', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  await writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
  const planned = await check(repo);
  const ready = await inspectPlan(repo, planned.json.planId);
  assert.deepEqual(Object.keys(ready.binding), ['head', 'policyHash', 'indexEntries', 'approvedTree', 'endpoint', 'push', 'clearedAttempts']);
  assert.equal(ready.binding.head, await git(repo, 'rev-parse', 'HEAD'));
  assert.match(ready.binding.policyHash, /^[0-9a-f]{64}$/u);
  assert.equal(ready.binding.indexEntries[0].path, 'tracked.txt');
  assert.equal(ready.binding.approvedTree, null);
  assert.deepEqual(ready.binding.endpoint, { sha256: hash, error: null });
  assert.equal(ready.binding.push, null);
  assert.equal(ready.binding.clearedAttempts, 0);

  const committed = await cli(repo, 'commit', '--plan', planned.json.planId);
  const afterCommit = await inspectPlan(repo, planned.json.planId);
  assert.equal(afterCommit.binding.approvedTree, await git(repo, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(afterCommit.binding.push, null);

  const pushed = await remote.cli('push', '--plan', planned.json.planId, ...guards(hash));
  assert.equal(pushed.code, 0, pushed.stdout);
  assert.equal(pushed.json.pushed, true);
  const commitSha = committed.json.commitSha;
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), commitSha);
  assert.equal(await git(repo, 'rev-parse', 'refs/remotes/origin/feature'), commitSha);
  const verified = await inspectPlan(repo, planned.json.planId);
  assert.deepEqual(verified.binding.push, {
    state: 'verified',
    endpointSha256: hash,
    targetRef: 'refs/heads/feature',
    commitSha,
    trackingRef: 'refs/remotes/origin/feature',
    remoteSha: commitSha,
  });
  assert.deepEqual(await remote.calls(), ['git-receive-pack origin.git', 'git-upload-pack origin.git']);
  for (const output of [JSON.stringify(ready), JSON.stringify(verified), pushed.stdout]) {
    assert.ok(!output.includes(repo) && !output.includes(remote.url('origin')) && !output.includes('example.invalid'));
  }

  const again = await remote.cli('push', '--plan', planned.json.planId, ...guards(hash));
  assert.equal(again.code, 0);
  assert.equal((await remote.calls()).length, 2);
});

test('B7/B9: endpoint resolution classifies endpoints and refuses credentials without network', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const { planId } = await committedPlan(repo);
  const endpointError = async () => (await inspectPlan(repo, planId)).binding.endpoint;
  const setPushUrls = async (...urls) => {
    await command(repo, 'git', ['config', '--unset-all', 'remote.origin.pushurl']);
    for (const url of urls) await git(repo, 'config', '--add', 'remote.origin.pushurl', url);
  };
  const cases = [
    [['/srv/repo.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['../relative.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['~/repo.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['file:///srv/repo.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['git://git.example.invalid/repo.git'], 'UNSUPPORTED_PUSH_ENDPOINT'],
    [['http://git.example.invalid/repo.git'], 'UNSUPPORTED_PUSH_ENDPOINT'],
    [['ext::sh -c true'], 'UNSUPPORTED_PUSH_ENDPOINT'],
    [[`https://${CREDENTIAL_SENTINEL}:${CREDENTIAL_SENTINEL}x@git.example.invalid/repo.git`], 'CREDENTIAL_IN_ENDPOINT'],
    [[`https://${CREDENTIAL_SENTINEL}@git.example.invalid/repo.git`], 'CREDENTIAL_IN_ENDPOINT'],
    [[`ssh://git:${CREDENTIAL_SENTINEL}@git.example.invalid/repo.git`], 'CREDENTIAL_IN_ENDPOINT'],
    [[`git:${CREDENTIAL_SENTINEL}@git.example.invalid:repo.git`], 'CREDENTIAL_IN_ENDPOINT'],
    [[remote.url('origin'), remote.url('second')], 'MULTIPLE_PUSH_ENDPOINTS'],
  ];
  for (const [urls, code] of cases) {
    await setPushUrls(...urls);
    assert.deepEqual(await endpointError(), { sha256: null, error: code }, urls.join(' '));
    const result = await remote.cli('push', '--plan', planId, ...guards(endpointHash(urls[0])));
    assert.equal(result.json.errors[0].code, code, urls.join(' '));
    for (const output of [result.stdout, result.stderr]) {
      assert.ok(!output.includes(CREDENTIAL_SENTINEL) && !output.includes('example.invalid'), output);
    }
  }
  await setPushUrls('git@git.example.invalid:team/repo.git');
  assert.equal((await endpointError()).sha256, endpointHash('git@git.example.invalid:team/repo.git'));
  await setPushUrls('https://git.example.invalid/team/repo.git');
  assert.equal((await endpointError()).sha256, endpointHash('https://git.example.invalid/team/repo.git'));
  await setPushUrls('https://git.example.invalid/team/repo.git');
  // A rewrite whose result still starts with its own prefix would be rewritten again on push.
  await git(repo, 'config', 'url.https://git.example.invalid/team/.insteadOf', 'https://git.example.invalid/');
  assert.equal((await endpointError()).error, 'UNSUPPORTED_PUSH_ENDPOINT');
  await git(repo, 'config', '--unset', 'url.https://git.example.invalid/team/.insteadOf');
  await git(repo, 'config', 'url.https://mirror.example.invalid/.insteadOf', 'https://git.example.invalid/');
  assert.equal((await endpointError()).sha256, endpointHash('https://mirror.example.invalid/team/repo.git'));
  await git(repo, 'config', '--unset', 'url.https://mirror.example.invalid/.insteadOf');
  await setPushUrls();
  await git(repo, 'config', 'branch.feature.remote', 'nourl');
  assert.equal((await endpointError()).error, 'NO_PUSH_ENDPOINT');
  await git(repo, 'config', 'branch.feature.remote', '.');
  assert.equal((await endpointError()).error, 'NO_PUSH_ENDPOINT');
  assert.deepEqual(await remote.calls(), []);
});

test('B8: an endpoint changed after review is refused before network I/O; restoring it pushes', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const other = await remote.bare('other');
  const { planId, commitSha } = await committedPlan(repo);
  const reviewed = endpointHash(remote.url('origin'));
  const originBefore = await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature');
  await git(repo, 'config', 'remote.origin.pushurl', remote.url('other'));
  const changed = await remote.cli('push', '--plan', planId, ...guards(reviewed));
  assert.equal(changed.code, 15);
  assert.equal(changed.json.errors[0].code, 'PUSH_ENDPOINT_CHANGED');
  assert.deepEqual(await remote.calls(), []);
  assert.equal((await command(other, 'git', ['rev-parse', '--verify', '-q', 'refs/heads/feature'])).code, 1);
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), originBefore);
  const plan = await inspectPlan(repo, planId);
  assert.equal(plan.pushed, false);
  assert.equal(plan.binding.push, null);
  await git(repo, 'config', '--unset', 'remote.origin.pushurl');
  const pushed = await remote.cli('push', '--plan', planId, ...guards(reviewed));
  assert.equal(pushed.code, 0, pushed.stdout);
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), commitSha);
});

test('B10: the target ref is bound, compared before network I/O and checked against protected branches', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const { planId } = await committedPlan(repo);
  const hash = endpointHash(remote.url('origin'));
  await git(repo, 'config', 'branch.feature.merge', 'refs/heads/other');
  const changed = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(changed.json.errors[0].code, 'PUSH_TARGET_CHANGED');
  await git(repo, 'config', 'branch.feature.merge', 'refs/heads/main');
  const protectedMerge = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(protectedMerge.json.errors[0].code, 'PROTECTED_BRANCH');
  const protectedFlag = await remote.cli('push', '--plan', planId, ...guards(hash, 'refs/heads/main'));
  assert.equal(protectedFlag.json.errors[0].code, 'PROTECTED_BRANCH');
  assert.deepEqual(await remote.calls(), []);
  assert.equal((await inspectPlan(repo, planId)).pushed, false);
  assert.equal((await command(remote.remoteDir('origin'), 'git', ['rev-parse', '--verify', '-q', 'refs/heads/main'])).code, 1);
});

test('B9: transport failure output, plan and errors never carry the URL, stderr or credentials', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const failingUrl = `ssh://${URL_SENTINEL}.example.invalid/origin.git`;
  await git(repo, 'remote', 'set-url', 'origin', failingUrl);
  const { planId } = await committedPlan(repo);
  await remote.setMode('fail-all');
  const json = await remote.cli('push', '--plan', planId, ...guards(endpointHash(failingUrl)));
  assert.equal(json.code, 15);
  assert.equal(json.json.errors[0].code, 'PUSH_FAILED');
  assert.deepEqual(Object.keys(json.json.errors[0].details).sort(), ['commitSha', 'gitExitCode']);
  assert.equal((await inspectPlan(repo, planId)).binding.push.state, 'attempted');
  // verify-push over the failing transport leaks nothing either; once it works, it clears the attempt.
  const unverified = await remote.cli('verify-push', '--plan', planId);
  assert.equal(unverified.json.errors[0].code, 'REMOTE_UNVERIFIED');
  await remote.setMode('');
  assert.equal((await remote.cli('verify-push', '--plan', planId)).code, 0);
  await remote.setMode('fail-all');
  const human = await remote.human('push', '--plan', planId, ...guards(endpointHash(failingUrl)));
  assert.notEqual(human.code, 0);
  assert.match(human.stderr, /PUSH_FAILED/u);
  const planFile = await readFile(path.join(repo, '.git', 'safe-commit', 'plans', `${planId}.json`), 'utf8');
  for (const output of [json.stdout, json.stderr, unverified.stdout, unverified.stderr, human.stdout, human.stderr, planFile]) {
    assert.ok(!output.includes(URL_SENTINEL) && !output.includes(CREDENTIAL_SENTINEL), output);
  }
  assert.equal((await inspectPlan(repo, planId)).binding.push.state, 'attempted');
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 2);
});

test('B11: a remote write is persisted before local verification, and verify-push recovers without pushing again', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const { planId, commitSha } = await committedPlan(repo);
  const lockFile = path.join(repo, '.git', 'refs', 'remotes', 'origin', 'feature.lock');
  await writeFile(lockFile, '');
  const updateFailed = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(updateFailed.code, 15);
  assert.equal(updateFailed.json.errors[0].code, 'TRACKING_REF_UPDATE_FAILED');
  assert.equal(updateFailed.json.pushed, true);
  let plan = await inspectPlan(repo, planId);
  assert.equal(plan.binding.push.state, 'pushed');
  assert.equal(plan.binding.push.commitSha, commitSha);
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), commitSha);

  const pending = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(pending.json.errors[0].code, 'PUSH_VERIFICATION_PENDING');
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);

  await rm(lockFile);
  const recovered = await remote.cli('verify-push', '--plan', planId);
  assert.equal(recovered.code, 0, recovered.stdout);
  plan = await inspectPlan(repo, planId);
  assert.equal(plan.binding.push.state, 'verified');
  assert.equal(plan.binding.push.remoteSha, commitSha);
  assert.equal(await git(repo, 'rev-parse', 'refs/remotes/origin/feature'), commitSha);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);
  const noop = await remote.cli('verify-push', '--plan', planId);
  assert.equal(noop.code, 0);
});

test('B11: post-push ls-remote failure leaves pushed state that verify-push completes', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const { planId, commitSha } = await committedPlan(repo);
  await remote.setMode('fail-upload');
  const unverified = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(unverified.json.errors[0].code, 'REMOTE_UNVERIFIED');
  assert.ok(!unverified.stdout.includes(URL_SENTINEL) && !unverified.stdout.includes(CREDENTIAL_SENTINEL));
  assert.equal((await inspectPlan(repo, planId)).binding.push.state, 'pushed');
  const stillFailing = await remote.cli('verify-push', '--plan', planId);
  assert.equal(stillFailing.json.errors[0].code, 'REMOTE_UNVERIFIED');
  await remote.setMode('');
  const recovered = await remote.cli('verify-push', '--plan', planId);
  assert.equal(recovered.code, 0, recovered.stdout);
  assert.equal((await inspectPlan(repo, planId)).binding.push.remoteSha, commitSha);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);
});

async function ageLock(repo) {
  const locks = path.join(repo, '.git', 'safe-commit', 'locks');
  const old = new Date(Date.now() - 60 * 60_000);
  for (const name of await readdir(locks)) await utimes(path.join(locks, name), old, old);
}

test('B11: interrupted pushes are reconciled by verify-push in both directions', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const { planId, commitSha } = await committedPlan(repo);
  const originBefore = await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature');

  await remote.setMode('kill-before-receive');
  const killedBefore = await remote.cli('push', '--plan', planId, ...guards(hash)).catch(() => null);
  assert.equal(killedBefore, null);
  assert.equal((await inspectPlan(repo, planId)).binding.push.state, 'attempted');
  await ageLock(repo);
  await remote.setMode('');
  const unknown = await remote.cli('push', '--plan', planId, ...guards(hash));
  assert.equal(unknown.json.errors[0].code, 'PUSH_OUTCOME_UNKNOWN');
  const receivesBefore = (await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length;
  const cleared = await remote.cli('verify-push', '--plan', planId);
  assert.equal(cleared.code, 0, cleared.stdout);
  assert.equal(cleared.json.pushed, false);
  assert.equal((await inspectPlan(repo, planId)).binding.push, null);
  assert.equal((await inspectPlan(repo, planId)).binding.clearedAttempts, 1);
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), originBefore);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, receivesBefore);

  await remote.setMode('kill-after-receive');
  const killedAfter = await remote.cli('push', '--plan', planId, ...guards(hash)).catch(() => null);
  assert.equal(killedAfter, null);
  assert.equal((await inspectPlan(repo, planId)).binding.push.state, 'attempted');
  assert.equal(await git(remote.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), commitSha);
  await ageLock(repo);
  await remote.setMode('');
  const receives = (await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length;
  const completed = await remote.cli('verify-push', '--plan', planId);
  assert.equal(completed.code, 0, completed.stdout);
  const plan = await inspectPlan(repo, planId);
  assert.equal(plan.pushed, true);
  assert.equal(plan.binding.push.state, 'verified');
  assert.equal(await git(repo, 'rev-parse', 'refs/remotes/origin/feature'), commitSha);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, receives);
});

test('B11: verify-push fails closed on conflicts, mismatches and changed endpoint or target', async () => {
  const repo = await initRepo({ allowPush: true });
  const remote = await remoteFixture(repo);
  const hash = endpointHash(remote.url('origin'));
  const { planId, commitSha } = await committedPlan(repo);
  const lockFile = path.join(repo, '.git', 'refs', 'remotes', 'origin', 'feature.lock');
  await writeFile(lockFile, '');
  assert.equal((await remote.cli('push', '--plan', planId, ...guards(hash))).json.errors[0].code, 'TRACKING_REF_UPDATE_FAILED');
  await rm(lockFile);
  const calls = (await remote.calls()).length;

  await git(repo, 'config', 'remote.origin.pushurl', remote.url('elsewhere'));
  assert.equal((await remote.cli('verify-push', '--plan', planId)).json.errors[0].code, 'PUSH_ENDPOINT_CHANGED');
  await git(repo, 'config', '--unset', 'remote.origin.pushurl');
  await git(repo, 'config', 'branch.feature.merge', 'refs/heads/other');
  assert.equal((await remote.cli('verify-push', '--plan', planId)).json.errors[0].code, 'PUSH_TARGET_CHANGED');
  await git(repo, 'config', 'branch.feature.merge', 'refs/heads/feature');
  assert.equal((await remote.calls()).length, calls);

  const initial = await git(repo, 'rev-parse', 'HEAD~1');
  await git(repo, 'update-ref', 'refs/remotes/origin/feature', await git(repo, 'commit-tree', '-m', 'other', `${initial}^{tree}`));
  assert.equal((await remote.cli('verify-push', '--plan', planId)).json.errors[0].code, 'TRACKING_REF_CONFLICT');
  await git(repo, 'update-ref', 'refs/remotes/origin/feature', initial);
  await git(remote.remoteDir('origin'), 'update-ref', 'refs/heads/feature', initial);
  assert.equal((await remote.cli('verify-push', '--plan', planId)).json.errors[0].code, 'REMOTE_MISMATCH');
  await git(remote.remoteDir('origin'), 'update-ref', 'refs/heads/feature', commitSha);
  assert.equal((await remote.cli('verify-push', '--plan', planId)).code, 0);
  assert.equal((await remote.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);
});
