import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { encodeManifest } from '../tools/stage-handoff.mjs';

const CLI = path.resolve(import.meta.dirname, '..', 'tools', 'stage-handoff.mjs');
const temporaryPaths = [];
let draftNumber = 0;

after(async () => {
  for (const target of temporaryPaths) await rm(target, { recursive: true, force: true });
});

async function command(cwd, executable, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function git(repo, ...args) {
  const result = await command(repo, 'git', args);
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.toString('utf8').trim();
}

async function cli(repo, ...args) {
  const result = await command(repo, process.execPath, [CLI, ...args, '--json']);
  try {
    return { code: result.code, json: JSON.parse(result.stdout.toString('utf8')) };
  } catch {
    assert.fail(`non-JSON output (exit ${result.code}): ${result.stdout}${result.stderr}`);
  }
}

const codes = (json) => (json.reasons ?? []).map((reason) => reason.code);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function initRepo({ ignore = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'stage-handoff-test-'));
  temporaryPaths.push(repo);
  await git(repo, 'init', '--initial-branch=feature');
  await git(repo, 'config', 'user.name', 'Stage Handoff Test');
  await git(repo, 'config', 'user.email', 'stage-handoff@example.invalid');
  await mkdir(path.join(repo, 'notes'));
  await writeFile(path.join(repo, '.gitignore'), ignore ? 'node_modules/\n.agent-handoffs/\n' : 'node_modules/\n');
  await writeFile(path.join(repo, 'src.txt'), 'one\n');
  await writeFile(path.join(repo, 'notes', 'scratchpad.md'), '# checkpoint\nstageState: in_progress\n');
  await writeFile(path.join(repo, 'notes', 'tasks.md'), '- [ ] 1.1 task\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-q', '-m', 'initial');
  await writeFile(path.join(repo, 'src.txt'), 'two\n');
  return repo;
}

async function draft(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stage-handoff-draft-'));
  temporaryPaths.push(dir);
  const file = path.join(dir, `draft-${++draftNumber}.json`);
  await writeFile(file, JSON.stringify(content));
  return file;
}

function requestDraft(overrides = {}) {
  return {
    reason: 'initial',
    contract: { summary: 'Test stage.', taskIds: ['1.1'], allowedFiles: ['src.txt', 'notes/scratchpad.md'] },
    checkpoint: { path: 'notes/scratchpad.md', summary: { stageId: 'T1', stageState: 'in_progress', progress: '0/1' } },
    verification: [{ name: 'unit', redactedCommand: 'node --test', exitCode: 0, result: 'PASS', conciseSummary: 'All tests pass.' }],
    claudeReview: {
      reviewerType: 'claude-subagent-fresh-readonly',
      round: 1,
      verdict: 'PASS',
      blockingFindings: [],
      nonBlockingFindings: ['N1 wording'],
      fixesApplied: [],
    },
    contractDeviations: [],
    safeCommitPlanId: null,
    nextAction: 'Wait for the user to request a Codex review.',
    ...overrides,
  };
}

function responseDraft(overrides = {}) {
  return {
    verdict: 'PASS',
    blockingFindings: [],
    nonBlockingFindings: [],
    checksPerformed: ['Read the full diff'],
    limitations: [],
    nextAction: 'Return to the user.',
    ...overrides,
  };
}

async function initAndPublish(repo, overrides = {}) {
  const init = await cli(repo, 'init', '--stage', 'T1');
  assert.equal(init.code, 0, JSON.stringify(init.json));
  const published = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft(overrides)));
  assert.equal(published.code, 0, JSON.stringify(published.json));
  return { init: init.json, published: published.json };
}

async function respond(repo, revision, overrides = {}) {
  return await cli(repo, 'respond', '--stage', 'T1', '--revision', String(revision), '--input', await draft(responseDraft(overrides)));
}

async function readJson(repo, relative) {
  return JSON.parse(await readFile(path.join(repo, relative), 'utf8'));
}

// Everything outside the ignored handoff directory: Git state plus worktree file bytes.
async function repositorySnapshot(repo) {
  const status = (await command(repo, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout.toString('hex');
  const files = {};
  for (const file of ['src.txt', 'notes/scratchpad.md', 'notes/tasks.md', '.gitignore']) {
    files[file] = sha256(await readFile(path.join(repo, file)));
  }
  return { status, head: await git(repo, 'rev-parse', 'HEAD'), files };
}

test('1. init creates a run; a second init needs --new-run', async () => {
  const repo = await initRepo();
  const first = await cli(repo, 'init', '--stage', 'T1');
  assert.equal(first.code, 0, JSON.stringify(first.json));
  assert.match(first.json.runId, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u);
  const index = await readJson(repo, path.join(first.json.runDir, 'index.json'));
  assert.deepEqual(Object.keys(index), [
    'schemaVersion', 'stageId', 'runId', 'priorRunId', 'baselineHead',
    'currentRevision', 'currentRequestPath', 'currentRequestSha256', 'updatedAt',
  ]);
  assert.equal(index.currentRevision, 0);
  assert.equal(index.currentRequestPath, null);
  assert.equal(index.baselineHead, await git(repo, 'rev-parse', 'HEAD'));
  for (const sub of ['requests', 'responses']) assert.ok((await stat(path.join(repo, first.json.runDir, sub))).isDirectory());

  const again = await cli(repo, 'init', '--stage', 'T1');
  assert.equal(again.code, 1);
  assert.equal(again.json.code, 'ACTIVE_RUN_EXISTS');

  const oldIndexBytes = await readFile(path.join(repo, first.json.runDir, 'index.json'));
  const second = await cli(repo, 'init', '--stage', 'T1', '--new-run');
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.ok(second.json.runId > first.json.runId);
  assert.equal((await readJson(repo, path.join(second.json.runDir, 'index.json'))).priorRunId, first.json.runId);
  assert.deepEqual(await readFile(path.join(repo, first.json.runDir, 'index.json')), oldIndexBytes);

  const badStage = await cli(repo, 'init', '--stage', '../x');
  assert.equal(badStage.code, 2);
});

test('2. publish writes an immutable, fully bound revision 1', async () => {
  const repo = await initRepo();
  await cli(repo, 'init', '--stage', 'T1');
  const wrongReason = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'targeted_fix' })));
  assert.equal(wrongReason.json.code, 'INPUT_INVALID');
  const unknownPlan = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ safeCommitPlanId: 'a'.repeat(64) })));
  assert.equal(unknownPlan.json.code, 'PLAN_MISSING');

  const result = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft()));
  assert.equal(result.code, 0, JSON.stringify(result.json));
  const published = result.json;
  assert.equal(published.revision, 1);
  assert.match(published.requestPath, /requests\/0001-review-ready\.json$/u);
  const file = path.join(repo, published.requestPath);
  assert.equal((await stat(file)).mode & 0o777, 0o444);
  const bytes = await readFile(file);
  assert.equal(published.requestSha256, sha256(bytes));
  const request = JSON.parse(bytes.toString('utf8'));
  assert.equal(request.kind, 'review-request');
  assert.equal(request.stageId, 'T1');
  assert.equal(request.revision, 1);
  assert.equal(request.reason, 'initial');
  assert.equal(request.previousRequest, null);
  assert.equal(request.repo.branch, 'feature');
  assert.equal(request.repo.upstream, null);
  assert.equal(request.repo.currentHead, await git(repo, 'rev-parse', 'HEAD'));
  assert.deepEqual(request.changes.files, [
    { path: 'src.txt', status: ' M', sha256: `sha256:${sha256('two\n')}`, inScope: true },
  ]);
  assert.equal(request.checkpoint.sha256, `sha256:${sha256(await readFile(path.join(repo, 'notes/scratchpad.md')))}`);
  assert.equal(request.safeCommit, null);
  assert.deepEqual(request.worktree, { clean: false, ahead: null, behind: null });
});

test('3-5. a second publish adds revision 2, moves the index, and chains to revision 1', async () => {
  const repo = await initRepo();
  const { published: first } = await initAndPublish(repo);
  const firstBytes = await readFile(path.join(repo, first.requestPath));

  const initialAgain = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft()));
  assert.equal(initialAgain.json.code, 'INPUT_INVALID');

  await writeFile(path.join(repo, 'src.txt'), 'three\n');
  await writeFile(path.join(repo, 'stray.txt'), 'x\n');
  const second = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'targeted_fix' })));
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.equal(second.json.revision, 2);
  assert.deepEqual(await readFile(path.join(repo, first.requestPath)), firstBytes);

  const index = await readJson(repo, path.join(second.json.runDir, 'index.json'));
  assert.equal(index.currentRevision, 2);
  assert.equal(index.currentRequestPath, 'requests/0002-review-ready.json');
  assert.equal(index.currentRequestSha256, sha256(await readFile(path.join(repo, second.json.requestPath))));

  const request = await readJson(repo, second.json.requestPath);
  assert.deepEqual(request.previousRequest, { path: 'requests/0001-review-ready.json', sha256: sha256(firstBytes) });
  assert.deepEqual(request.changes.files.find((file) => file.path === 'stray.txt').inScope, false);

  const verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'valid', JSON.stringify(verified.json));
  assert.deepEqual(verified.json.notices, [{ code: 'OUT_OF_SCOPE_CHANGES', detail: 'stray.txt' }]);

  const revision1 = path.join(repo, first.requestPath);
  await chmod(revision1, 0o644);
  await writeFile(revision1, Buffer.concat([firstBytes, Buffer.from(' ')]));
  const tampered = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(tampered.json.status, 'invalid');
  assert.ok(codes(tampered.json).includes('CHAIN_BROKEN'), JSON.stringify(tampered.json));
});

test('6-7. respond binds to the current request and never overwrites', async () => {
  const repo = await initRepo();
  const { published } = await initAndPublish(repo);
  const before = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(before.json.status, 'valid');
  assert.equal(before.json.response.present, false);

  const wrongRevision = await respond(repo, 2);
  assert.equal(wrongRevision.json.code, 'NOT_CURRENT_REVISION');

  const written = await respond(repo, 1, { verdict: 'FAIL', blockingFindings: ['B1 missing guard'] });
  assert.equal(written.code, 0, JSON.stringify(written.json));
  assert.match(written.json.responsePath, /responses\/0001-codex-review\.json$/u);
  const responseFile = path.join(repo, written.json.responsePath);
  assert.equal((await stat(responseFile)).mode & 0o777, 0o444);
  const response = await readJson(repo, written.json.responsePath);
  const request = await readJson(repo, published.requestPath);
  assert.equal(response.reviewer, 'codex');
  assert.deepEqual(response.source, {
    stageId: 'T1',
    runId: published.runId,
    revision: 1,
    requestPath: 'requests/0001-review-ready.json',
    requestSha256: published.requestSha256,
    changedFilesDigest: request.changes.changedFilesDigest,
    currentHead: request.repo.currentHead,
  });

  const verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'valid');
  assert.deepEqual(
    { present: verified.json.response.present, verdict: verified.json.response.verdict, bindingOk: verified.json.response.bindingOk },
    { present: true, verdict: 'FAIL', bindingOk: true },
  );

  const responseBytes = await readFile(responseFile);
  const duplicate = await respond(repo, 1);
  assert.equal(duplicate.json.code, 'RESPONSE_EXISTS');
  assert.deepEqual(await readFile(responseFile), responseBytes);
});

test('8. file, checkpoint, or HEAD changes make the request and response stale', async () => {
  const repo = await initRepo();
  await initAndPublish(repo);
  assert.equal((await respond(repo, 1)).code, 0);

  await writeFile(path.join(repo, 'src.txt'), 'changed after review\n');
  let verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'stale');
  assert.ok(codes(verified.json).includes('DIGEST_CHANGED'));
  await writeFile(path.join(repo, 'src.txt'), 'two\n');
  assert.equal((await cli(repo, 'verify', '--stage', 'T1')).json.status, 'valid');

  await writeFile(path.join(repo, 'notes/scratchpad.md'), '# checkpoint\nstageState: ready_for_safe_commit\n');
  verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.ok(codes(verified.json).includes('CHECKPOINT_CHANGED'), JSON.stringify(verified.json));
  await writeFile(path.join(repo, 'notes/scratchpad.md'), '# checkpoint\nstageState: in_progress\n');

  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'move HEAD');
  verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'stale');
  assert.ok(codes(verified.json).includes('HEAD_CHANGED'));

  const next = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'manual_refresh' })));
  assert.equal(next.code, 0);
  await writeFile(path.join(repo, 'src.txt'), 'edited before Codex answered\n');
  const refused = await respond(repo, 2);
  assert.equal(refused.json.code, 'REQUEST_STALE');
  assert.ok(codes(refused.json).includes('DIGEST_CHANGED'));
  const old = await cli(repo, 'verify', '--stage', 'T1', '--revision', '1');
  assert.ok(codes(old.json).includes('NOT_CURRENT_REVISION'));
});

test('9. sensitive data makes publish and respond fail closed', async () => {
  const repo = await initRepo();
  await initAndPublish(repo);
  const runDir = (await cli(repo, 'verify', '--stage', 'T1')).json.runDir;
  const indexBytes = await readFile(path.join(repo, runDir, 'index.json'));
  const leaks = [
    { redactedCommand: 'POSTGRES_PASSWORD=hunter2 node seed.mjs' },
    { redactedCommand: 'psql postgres://postgres:hunter2@db:5432/postgres' },
    { redactedCommand: 'curl -H "Authorization: Basic abc"' },
    { conciseSummary: 'Used token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    { conciseSummary: 'Bearer abcdefghijklmnop123 accepted' },
    { conciseSummary: 'Signed in as parent@mail-provider.org' },
    { conciseSummary: 'OTP sent to 13812345678' },
    { conciseSummary: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    { conciseSummary: 'A=1 B=2 C=3 environment' },
    { redactedCommand: 'DATABASE_URL=postgres://app@db:5432/errlog npm run db:migrate' },
    { conciseSummary: 'Session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0 reused' },
    { conciseSummary: 'Login code sent to +8613812345678' },
    { conciseSummary: 'Login code sent to 138-1234-5678' },
  ];
  for (const leak of leaks) {
    const verification = [{ ...requestDraft().verification[0], ...leak }];
    const result = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'manual_refresh', verification })));
    assert.equal(result.json.code, 'SENSITIVE_DATA', `${JSON.stringify(leak)} -> ${JSON.stringify(result.json)}`);
  }
  const leakyResponse = await respond(repo, 1, { checksPerformed: ['Logged in with password: hunter2'] });
  assert.equal(leakyResponse.json.code, 'SENSITIVE_DATA');

  assert.deepEqual(await readFile(path.join(repo, runDir, 'index.json')), indexBytes);
  assert.deepEqual(await readdir(path.join(repo, runDir, 'requests')), ['0001-review-ready.json']);
  assert.deepEqual(await readdir(path.join(repo, runDir, 'responses')), []);
  assert.deepEqual(await readdir(path.join(repo, runDir)), ['index.json', 'requests', 'responses']);

  const redacted = [{ ...requestDraft().verification[0], redactedCommand: 'POSTGRES_PASSWORD=<redacted> psql postgres://<redacted>@db/postgres' }];
  const ok = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'manual_refresh', verification: redacted })));
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
});

test('10. interrupted writes leave the previous state intact and are reported, never repaired', async () => {
  const repo = await initRepo();
  const { published } = await initAndPublish(repo);
  const runDir = published.runDir;
  const requestBytes = await readFile(path.join(repo, published.requestPath));
  const indexBytes = await readFile(path.join(repo, runDir, 'index.json'));
  const leftovers = [
    { make: () => writeFile(path.join(repo, runDir, 'requests', '.tmp-0002-deadbeef'), '{"partial'), code: 'ORPHAN_TEMP_FILE' },
    { make: () => writeFile(path.join(repo, runDir, '.index.tmp-deadbeef'), '{'), code: 'ORPHAN_TEMP_FILE' },
    { make: () => writeFile(path.join(repo, runDir, 'responses', '.tmp-0001-deadbeef'), '{'), code: 'ORPHAN_TEMP_FILE' },
    { make: () => writeFile(path.join(repo, runDir, 'requests', '0002-review-ready.json'), requestBytes), code: 'UNINDEXED_REQUEST' },
    { make: () => mkdir(path.join(repo, runDir, '.lock')), code: 'LOCK_PRESENT' },
  ];
  for (const leftover of leftovers) {
    await leftover.make();
    const verified = await cli(repo, 'verify', '--stage', 'T1');
    assert.equal(verified.json.status, 'stale', JSON.stringify(verified.json));
    assert.ok(codes(verified.json).includes(leftover.code), JSON.stringify(verified.json));
    assert.equal(verified.json.request.intact, true);
    const blocked = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'manual_refresh' })));
    assert.equal(blocked.code, 1);
    const blockedResponse = await respond(repo, 1);
    assert.equal(blockedResponse.code, 1);
    assert.deepEqual(await readFile(path.join(repo, published.requestPath)), requestBytes);
    assert.deepEqual(await readFile(path.join(repo, runDir, 'index.json')), indexBytes);
    // The user removes the leftover; nothing else is rewritten.
    for (const leftoverPath of [
      path.join(runDir, 'requests', '.tmp-0002-deadbeef'),
      path.join(runDir, '.index.tmp-deadbeef'),
      path.join(runDir, 'responses', '.tmp-0001-deadbeef'),
      path.join(runDir, 'requests', '0002-review-ready.json'),
    ]) await rm(path.join(repo, leftoverPath), { force: true });
    await rmdir(path.join(repo, runDir, '.lock')).catch(() => {});
    assert.equal((await cli(repo, 'verify', '--stage', 'T1')).json.status, 'valid');
  }
});

test('11. handoff writes never change git status; an unignored directory fails closed', async () => {
  const repo = await initRepo();
  const before = await repositorySnapshot(repo);
  await initAndPublish(repo);
  assert.equal((await respond(repo, 1)).code, 0);
  await cli(repo, 'verify', '--stage', 'T1');
  assert.deepEqual(await repositorySnapshot(repo), before);

  const unignored = await initRepo({ ignore: false });
  const refused = await cli(unignored, 'init', '--stage', 'T1');
  assert.equal(refused.json.code, 'NOT_IGNORED');
  await assert.rejects(stat(path.join(unignored, '.agent-handoffs')), { code: 'ENOENT' });
});

test('12. a missing or corrupt handoff is reported and changes nothing else', async () => {
  const repo = await initRepo();
  const before = await repositorySnapshot(repo);
  const missing = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(missing.code, 1);
  assert.equal(missing.json.status, 'unavailable');
  assert.equal(missing.json.message, 'handoff unavailable or invalid — perform direct repository review');

  const { published } = await initAndPublish(repo);
  const index = path.join(repo, published.runDir, 'index.json');
  await writeFile(index, '{ not json');
  const corrupt = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(corrupt.json.status, 'invalid');
  assert.equal(corrupt.json.message, 'handoff unavailable or invalid — perform direct repository review');
  assert.equal((await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(requestDraft({ reason: 'manual_refresh' })))).code, 1);
  assert.equal((await respond(repo, 1)).code, 1);
  assert.deepEqual(await repositorySnapshot(repo), before);
});

test('ordinary paths and review text are not mistaken for secrets', async () => {
  const repo = await initRepo();
  await writeFile(path.join(repo, 'risk-assessment-for-handoff-notes.md'), 'x\n');
  const verification = [{
    ...requestDraft().verification[0],
    redactedCommand: 'npm install playwright@1.48.2 && psql postgres://<redacted>',
    conciseSummary: 'Pinned playwright@1.48.2; task-assessment-of-the-stage done.',
  }];
  const { published } = await initAndPublish(repo, { verification });
  assert.equal(published.revision, 1);
});

test('the ignore check covers every handoff path, not just a probe', async () => {
  const repo = await initRepo({ ignore: false });
  await writeFile(
    path.join(repo, '.gitignore'),
    '.agent-handoffs/*\n!.agent-handoffs/T1/\n.agent-handoffs/T1/runs/*/index.json\n',
  );
  await mkdir(path.join(repo, '.agent-handoffs', 'T1', 'runs', 'x'), { recursive: true });
  await writeFile(path.join(repo, '.agent-handoffs', 'T1', 'runs', 'x', 'visible.json'), '{}\n');
  const refused = await cli(repo, 'init', '--stage', 'T1');
  assert.equal(refused.json.code, 'NOT_IGNORED');
});

test('verify rejects a hand-written response and a missing subdirectory with the standard message', async () => {
  const repo = await initRepo();
  const { published } = await initAndPublish(repo);
  const request = await readJson(repo, published.requestPath);
  const forged = {
    schemaVersion: 1,
    kind: 'review-response',
    reviewer: 'codex',
    generatedAt: 'whenever',
    source: {
      stageId: 'T1',
      runId: published.runId,
      revision: 1,
      requestPath: 'requests/0001-review-ready.json',
      requestSha256: published.requestSha256,
      changedFilesDigest: request.changes.changedFilesDigest,
      currentHead: request.repo.currentHead,
    },
    verdict: 'PASS',
    blockingFindings: 'none',
    nonBlockingFindings: null,
    checksPerformed: 5,
    limitations: [],
    nextAction: '',
  };
  const responseFile = path.join(repo, published.runDir, 'responses', '0001-codex-review.json');
  await writeFile(responseFile, JSON.stringify(forged));
  const verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'invalid');
  assert.ok(codes(verified.json).includes('SCHEMA_INVALID'), JSON.stringify(verified.json));

  await rm(responseFile);
  await rmdir(path.join(repo, published.runDir, 'responses'));
  const missing = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(missing.json.status, 'invalid');
  assert.equal(missing.json.message, 'handoff unavailable or invalid — perform direct repository review');
});

test('manifest: paths with spaces, tabs, newlines, and quotes are encoded unambiguously', async () => {
  const repo = await initRepo();
  const names = ['with space.txt', 'with\ttab.txt', 'with\nnewline.txt', 'with "quote".txt'];
  for (const name of names) await writeFile(path.join(repo, name), `${name}\n`);
  const { published } = await initAndPublish(repo);
  const request = await readJson(repo, published.requestPath);
  for (const name of names) {
    const entry = request.changes.files.find((file) => file.path === name);
    assert.ok(entry, `missing ${JSON.stringify(name)}`);
    assert.equal(entry.status, '??');
    assert.equal(entry.sha256, `sha256:${sha256(`${name}\n`)}`);
  }
  const rebuilt = encodeManifest(request.changes.files);
  assert.equal(request.changes.changedFilesDigest, `sha256:${sha256(rebuilt)}`);
  assert.equal((await cli(repo, 'verify', '--stage', 'T1')).json.status, 'valid');
});

test('manifest: NUL encoding separates entries a line-based encoding would conflate', () => {
  // Under "XY\tcontent\tpath\n" these two sets produce identical bytes.
  const one = [{ status: '??', sha256: 'sha256:11', path: 'a\n??\tsha256:00\tb' }];
  const two = [
    { status: '??', sha256: 'sha256:11', path: 'a' },
    { status: '??', sha256: 'sha256:00', path: 'b' },
  ];
  const bytesOne = encodeManifest(one);
  assert.notDeepEqual(bytesOne, encodeManifest(two));
  const fields = bytesOne.toString('utf8').split('\0');
  assert.deepEqual(fields, ['errlog-changed-files-manifest/v1', '??', 'sha256:11', 'a\n??\tsha256:00\tb', '']);
  assert.deepEqual(encodeManifest([...two].reverse()), encodeManifest(two));
  assert.equal(sha256(encodeManifest([])), sha256('errlog-changed-files-manifest/v1\0'));
});
