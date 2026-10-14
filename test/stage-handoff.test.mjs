import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { encodeInputs, encodeManifest } from '../tools/stage-handoff.mjs';

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
    checkpoint: {
      path: 'notes/scratchpad.md',
      summary: { stageId: 'T1', stageState: 'in_progress', progress: '0/1' },
      containsApprovedContract: true,
    },
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

// ---- Implementation channel: checkpoint binding and H1 compatibility ----

test('implementation: a checkpoint must be declared to hold the approved contract', async () => {
  const repo = await initRepo();
  await cli(repo, 'init', '--stage', 'T1');
  const base = requestDraft();
  const missing = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft({
    ...base,
    checkpoint: { path: base.checkpoint.path, summary: base.checkpoint.summary },
  }));
  assert.equal(missing.json.code, 'INPUT_INVALID');
  const notTrue = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft({
    ...base,
    checkpoint: { ...base.checkpoint, containsApprovedContract: false },
  }));
  assert.equal(notTrue.json.code, 'INPUT_INVALID');

  const ok = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(base));
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.channel, 'implementation');
  const request = await readJson(repo, ok.json.requestPath);
  assert.equal(request.checkpoint.containsApprovedContract, true);
  assert.equal(request.checkpoint.sha256, `sha256:${sha256(await readFile(path.join(repo, 'notes/scratchpad.md')))}`);
  const verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.channel, 'implementation');
  assert.equal(verified.json.nextGate, 'awaiting_codex_response');
  assert.equal((await respond(repo, 1)).code, 0);
  assert.equal((await cli(repo, 'verify', '--stage', 'T1', '--channel', 'implementation')).json.nextGate, 'codex_pass');
});

test('implementation: an H1-format request (no containsApprovedContract) still verifies', async () => {
  const repo = await initRepo();
  const { published } = await initAndPublish(repo);
  // Rebuild the record exactly as H1 wrote it: same fields, no containsApprovedContract.
  const file = path.join(repo, published.requestPath);
  const request = JSON.parse(await readFile(file, 'utf8'));
  delete request.checkpoint.containsApprovedContract;
  const bytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`, 'utf8');
  await chmod(file, 0o644);
  await writeFile(file, bytes);
  await chmod(file, 0o444);
  const indexFile = path.join(repo, published.runDir, 'index.json');
  const index = await readJson(repo, path.join(published.runDir, 'index.json'));
  await writeFile(indexFile, `${JSON.stringify({ ...index, currentRequestSha256: sha256(bytes) }, null, 2)}\n`);

  const verified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(verified.json.status, 'valid', JSON.stringify(verified.json));
  assert.equal(verified.json.channel, 'implementation');
  const written = await respond(repo, 1);
  assert.equal(written.code, 0, JSON.stringify(written.json));
  assert.equal((await cli(repo, 'verify', '--stage', 'T1')).json.response.verdict, 'PASS');
});

// ---- Contract channel ----

const CONTRACT_TEXT = '# Stage Contract T1\n\n- Stage ID: T1\n- Allowed paths: `src.txt`\n\n| a | b |\n|---|---|\n';

function contractDraft(overrides = {}) {
  return {
    reason: 'initial',
    contract: {
      summary: 'Test contract.',
      taskIds: ['1.1'],
      allowedFiles: ['src.txt'],
      excluded: ['openspec/**'],
      testRequirements: ['unit tests fail first, then pass'],
      contractTestRequirements: ['none: no boundary'],
      aiEvalRequirements: ['none'],
      e2eRequirements: ['not-applicable: no UI'],
      securityImpact: ['none'],
    },
    contractText: CONTRACT_TEXT,
    openQuestions: [{
      id: 'Q1',
      question: 'Which option?',
      options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }],
      recommendation: 'A',
      rationale: 'simpler',
    }],
    priorFindings: [],
    inputFiles: ['notes/tasks.md'],
    nextAction: 'Wait for the user to request a Codex contract review.',
    ...overrides,
  };
}

function contractResponseDraft(overrides = {}) {
  return {
    verdict: 'OK',
    blockingFindings: [],
    nonBlockingFindings: [],
    suggestions: [],
    checksPerformed: ['Read the cited tasks'],
    limitations: [],
    nextAction: 'Return to the user for approval.',
    ...overrides,
  };
}

const ccli = (repo, sub, ...args) => cli(repo, sub, '--stage', 'T1', '--channel', 'contract', ...args);

async function contractPublish(repo, overrides = {}) {
  return await ccli(repo, 'publish', '--input', await draft(contractDraft(overrides)));
}

async function contractRespond(repo, revision, overrides = {}) {
  return await ccli(repo, 'respond', '--revision', String(revision), '--input', await draft(contractResponseDraft(overrides)));
}

async function contractInitAndPublish(repo, overrides = {}) {
  const init = await ccli(repo, 'init');
  assert.equal(init.code, 0, JSON.stringify(init.json));
  const published = await contractPublish(repo, overrides);
  assert.equal(published.code, 0, JSON.stringify(published.json));
  return { init: init.json, published: published.json };
}

test('contract: init, publish, respond, and verify a bound, immutable revision', async () => {
  const repo = await initRepo();
  const before = await repositorySnapshot(repo);
  const { init, published } = await contractInitAndPublish(repo);
  assert.equal(init.channel, 'contract');
  assert.match(init.runDir, /^\.agent-handoffs\/T1\/contract\/runs\/\d{8}T\d{6}Z-[0-9a-f]{8}$/u);
  const index = await readJson(repo, path.join(init.runDir, 'index.json'));
  assert.equal(index.channel, 'contract');
  assert.equal(index.currentRevision, 1);

  assert.equal(published.channel, 'contract');
  assert.match(published.requestPath, /contract\/runs\/[^/]+\/requests\/0001-contract-request\.json$/u);
  const file = path.join(repo, published.requestPath);
  assert.equal((await stat(file)).mode & 0o777, 0o444);
  const request = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(request.kind, 'contract-review-request');
  assert.equal(request.channel, 'contract');
  assert.equal(request.revision, 1);
  assert.equal(request.previousRequest, null);
  assert.equal(request.contractText, CONTRACT_TEXT);
  assert.equal(request.contractSha256, `sha256:${sha256(CONTRACT_TEXT)}`);
  assert.deepEqual(request.openQuestions, contractDraft().openQuestions);
  const inputFiles = [{ path: 'notes/tasks.md', sha256: `sha256:${sha256(await readFile(path.join(repo, 'notes/tasks.md')))}` }];
  assert.deepEqual(request.inputs, { inputsDigest: `sha256:${sha256(encodeInputs(inputFiles))}`, files: inputFiles });
  assert.equal(request.repo.currentHead, await git(repo, 'rev-parse', 'HEAD'));
  assert.deepEqual(request.changes.files.map((entry) => entry.path), ['src.txt']);

  let verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'valid', JSON.stringify(verified.json));
  assert.equal(verified.json.channel, 'contract');
  assert.equal(verified.json.nextGate, 'awaiting_codex_response');

  const written = await contractRespond(repo, 1, { nonBlockingFindings: ['N1 wording'] });
  assert.equal(written.code, 0, JSON.stringify(written.json));
  assert.equal(written.json.channel, 'contract');
  assert.match(written.json.responsePath, /responses\/0001-codex-contract-review\.json$/u);
  const response = await readJson(repo, written.json.responsePath);
  assert.equal(response.kind, 'contract-review-response');
  assert.equal(response.channel, 'contract');
  assert.deepEqual(response.source, {
    stageId: 'T1',
    runId: published.runId,
    revision: 1,
    requestPath: 'requests/0001-contract-request.json',
    requestSha256: published.requestSha256,
    changedFilesDigest: request.changes.changedFilesDigest,
    inputsDigest: request.inputs.inputsDigest,
    contractSha256: request.contractSha256,
    currentHead: request.repo.currentHead,
  });
  verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'valid');
  assert.equal(verified.json.response.verdict, 'OK');
  assert.equal(verified.json.nextGate, 'awaiting_user_approval');
  assert.ok(verified.json.notices.some((notice) => notice.code === 'USER_APPROVAL_REQUIRED'), JSON.stringify(verified.json));

  const responseBytes = await readFile(path.join(repo, written.json.responsePath));
  assert.equal((await contractRespond(repo, 1)).json.code, 'RESPONSE_EXISTS');
  assert.deepEqual(await readFile(path.join(repo, written.json.responsePath)), responseBytes);
  assert.deepEqual(await repositorySnapshot(repo), before);
});

test('contract and implementation channels are fully isolated', async () => {
  const repo = await initRepo();
  const { published: impl } = await initAndPublish(repo);
  const implIndex = path.join(repo, impl.runDir, 'index.json');
  const implIndexBytes = await readFile(implIndex);
  const implRequestBytes = await readFile(path.join(repo, impl.requestPath));

  const { published: contract } = await contractInitAndPublish(repo);
  assert.notEqual(contract.runDir, impl.runDir);
  assert.deepEqual(await readFile(implIndex), implIndexBytes);
  assert.deepEqual(await readFile(path.join(repo, impl.requestPath)), implRequestBytes);
  assert.equal(contract.revision, 1);

  const contractIndex = path.join(repo, contract.runDir, 'index.json');
  const contractIndexBytes = await readFile(contractIndex);
  assert.equal((await respond(repo, 1)).code, 0);
  const second = await cli(repo, 'publish', '--stage', 'T1', '--channel', 'implementation', '--input', await draft(requestDraft({ reason: 'manual_refresh' })));
  assert.equal(second.json.revision, 2);
  assert.deepEqual(await readFile(contractIndex), contractIndexBytes);
  assert.deepEqual(await readdir(path.join(repo, contract.runDir, 'responses')), []);

  // Wrong draft for the channel: rejected by schema, nothing written.
  const contractIntoImpl = await cli(repo, 'publish', '--stage', 'T1', '--input', await draft(contractDraft()));
  assert.equal(contractIntoImpl.json.code, 'INPUT_INVALID');
  assert.equal(contractIntoImpl.json.channel, 'implementation');
  const implIntoContract = await ccli(repo, 'publish', '--input', await draft(requestDraft({ reason: 'manual_refresh' })));
  assert.equal(implIntoContract.json.code, 'INPUT_INVALID');
  const okIntoImpl = await cli(repo, 'respond', '--stage', 'T1', '--revision', '2', '--input', await draft(contractResponseDraft()));
  assert.equal(okIntoImpl.json.code, 'INPUT_INVALID');
  const passIntoContract = await ccli(repo, 'respond', '--revision', '1', '--input', await draft(responseDraft()));
  assert.equal(passIntoContract.json.code, 'INPUT_INVALID');

  const implVerified = await cli(repo, 'verify', '--stage', 'T1');
  assert.equal(implVerified.json.channel, 'implementation');
  assert.equal(implVerified.json.currentRevision, 2);
  const contractVerified = await ccli(repo, 'verify');
  assert.equal(contractVerified.json.currentRevision, 1);
  assert.equal(contractVerified.json.response.present, false);

  // A contract record dropped into the implementation channel is invalid there.
  const foreign = path.join(repo, impl.runDir, 'requests', '0003-review-ready.json');
  await writeFile(foreign, await readFile(path.join(repo, contract.requestPath)));
  await writeFile(implIndex, `${JSON.stringify({
    ...(await readJson(repo, path.join(impl.runDir, 'index.json'))),
    currentRevision: 3,
    currentRequestPath: 'requests/0003-review-ready.json',
    currentRequestSha256: sha256(await readFile(foreign)),
  }, null, 2)}\n`);
  assert.equal((await cli(repo, 'verify', '--stage', 'T1')).json.status, 'invalid');
  assert.equal((await ccli(repo, 'verify')).json.status, 'valid');

  const badChannel = await cli(repo, 'verify', '--stage', 'T1', '--channel', 'other');
  assert.equal(badChannel.code, 2);
});

test('contract: revisions chain, never overwrite, and cap fix rounds at two', async () => {
  const repo = await initRepo();
  const { published: first } = await contractInitAndPublish(repo);
  const firstBytes = await readFile(path.join(repo, first.requestPath));
  assert.equal((await contractPublish(repo)).json.code, 'INPUT_INVALID');
  assert.equal((await contractPublish(repo, { reason: 'targeted_fix' })).json.code, 'INPUT_INVALID');
  const withFindings = await ccli(repo, 'init', '--new-run');
  assert.equal(withFindings.code, 0);
  assert.equal((await contractPublish(repo, {
    priorFindings: [{ finding: 'B1', previousFinding: null, fixRound: 1, resolution: 'fixed' }],
  })).json.code, 'INPUT_INVALID');
  assert.equal((await contractPublish(repo)).code, 0);

  assert.equal((await contractRespond(repo, 1, { verdict: 'NEEDS_CHANGES', blockingFindings: ['B1 scope too wide'] })).code, 0);
  assert.equal((await ccli(repo, 'verify')).json.nextGate, 'stopped_on_codex_verdict');
  for (const round of [3, 0]) {
    const refused = await contractPublish(repo, {
      reason: 'contract_revision',
      priorFindings: [{ finding: 'B1 scope too wide', previousFinding: null, fixRound: round, resolution: 'narrowed' }],
    });
    assert.equal(refused.json.code, 'INPUT_INVALID', `fixRound ${round}`);
  }
  const second = await contractPublish(repo, {
    reason: 'contract_revision',
    contractText: `${CONTRACT_TEXT}\n- Narrowed scope.\n`,
    priorFindings: [{ finding: 'B1 scope too wide', previousFinding: null, fixRound: 1, resolution: 'narrowed' }],
  });
  assert.equal(second.code, 0, JSON.stringify(second.json));
  assert.equal(second.json.revision, 2);
  assert.equal((await contractRespond(repo, 2)).code, 0);
  const third = await contractPublish(repo, { reason: 'user_revision' });
  assert.equal(third.code, 0, JSON.stringify(third.json));

  const runDir = second.json.runDir;
  const request2 = await readJson(repo, second.json.requestPath);
  const request2Bytes = await readFile(path.join(repo, second.json.requestPath));
  assert.deepEqual(request2.previousRequest, {
    path: 'requests/0001-contract-request.json',
    sha256: sha256(await readFile(path.join(repo, runDir, 'requests', '0001-contract-request.json'))),
  });
  assert.equal((await readJson(repo, third.json.requestPath)).previousRequest.sha256, sha256(request2Bytes));
  assert.deepEqual(await readFile(path.join(repo, first.requestPath)), firstBytes);
  assert.equal((await ccli(repo, 'verify')).json.status, 'valid');

  // Editing the contract text inside a stored record breaks its contractSha256.
  const file = path.join(repo, third.json.requestPath);
  const tampered = JSON.parse(await readFile(file, 'utf8'));
  tampered.contractText = 'something else\n';
  const tamperedBytes = Buffer.from(`${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  await chmod(file, 0o644);
  await writeFile(file, tamperedBytes);
  const index = await readJson(repo, path.join(runDir, 'index.json'));
  await writeFile(path.join(repo, runDir, 'index.json'), `${JSON.stringify({ ...index, currentRequestSha256: sha256(tamperedBytes) }, null, 2)}\n`);
  const verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'invalid');
  assert.ok(codes(verified.json).includes('CONTRACT_HASH_MISMATCH'), JSON.stringify(verified.json));
});

test('contract: fix rounds are tracked per finding across revisions', async () => {
  const repo = await initRepo();
  const { published } = await contractInitAndPublish(repo);
  const runDir = published.runDir;
  const finding = (text, previousFinding, fixRound) => ({ finding: text, previousFinding, fixRound, resolution: 'addressed' });
  const fix = (priorFindings, reason = 'contract_revision') => contractPublish(repo, { reason, priorFindings });
  const refusedWith = async (priorFindings, code, reason) => {
    const result = await fix(priorFindings, reason);
    assert.equal(result.json.code, code, JSON.stringify(priorFindings));
  };
  const scope = 'B1 scope too wide';
  const e2e = 'B2 missing E2E';
  const reworded = 'B3 E2E still missing';
  assert.equal((await contractRespond(repo, 1, { verdict: 'NEEDS_CHANGES', blockingFindings: [scope, e2e] })).code, 0);

  // Every blocking finding of the previous response is listed exactly once, nothing else.
  await refusedWith([finding(scope, null, 1)], 'INPUT_INVALID');
  await refusedWith([finding(scope, null, 1), finding(e2e, null, 1), finding('B9 invented', null, 1)], 'INPUT_INVALID');
  await refusedWith([finding(scope, null, 1), finding(scope, null, 1), finding(e2e, null, 1)], 'INPUT_INVALID');
  // The round is derived from history, not taken from the publisher.
  await refusedWith([finding(scope, null, 2), finding(e2e, null, 1)], 'INPUT_INVALID');
  const unknownLink = await fix([finding(scope, 'B0 never reported', 2), finding(e2e, null, 1)]);
  assert.match(unknownLink.json.message, /previousFinding must be a finding listed by an earlier revision/u);
  const round1 = [finding(scope, null, 1), finding(e2e, null, 1)];
  assert.equal((await fix(round1)).code, 0);

  // Without a response to the previous revision, its findings carry over unchanged.
  await refusedWith([], 'INPUT_INVALID', 'manual_refresh');
  await refusedWith([finding(scope, scope, 2), finding(e2e, null, 1)], 'INPUT_INVALID', 'manual_refresh');
  const carried = await fix(round1.map((item) => ({ ...item, resolution: 'addressed, inputs refreshed' })), 'manual_refresh');
  assert.equal(carried.code, 0, JSON.stringify(carried.json));
  assert.equal((await contractRespond(repo, 3, { verdict: 'NEEDS_CHANGES', blockingFindings: [scope, reworded] })).code, 0);

  // A repeated finding must link to itself, and a reworded one may link to the original.
  await refusedWith([finding(scope, null, 1), finding(reworded, e2e, 2)], 'INPUT_INVALID');
  await refusedWith([finding(scope, scope, 1), finding(reworded, e2e, 2)], 'INPUT_INVALID');
  await refusedWith([finding(scope, e2e, 2), finding(reworded, e2e, 2)], 'INPUT_INVALID');
  assert.equal((await fix([finding(scope, scope, 2), finding(reworded, e2e, 2)])).code, 0);
  assert.equal((await contractRespond(repo, 4, { verdict: 'NEEDS_CHANGES', blockingFindings: [e2e] })).code, 0);

  // A third fix round for the same finding is refused and writes nothing; so is reusing
  // an earlier round, switching back to an earlier wording, or dropping the finding.
  const indexBytes = await readFile(path.join(repo, runDir, 'index.json'));
  await refusedWith([finding(e2e, e2e, 2)], 'FIX_ROUND_LIMIT');
  await refusedWith([finding(e2e, reworded, 2)], 'INPUT_INVALID');
  await refusedWith([finding(e2e, null, 1)], 'INPUT_INVALID');
  await refusedWith([], 'INPUT_INVALID', 'user_revision');
  assert.deepEqual(await readFile(path.join(repo, runDir, 'index.json')), indexBytes);
  assert.equal((await readdir(path.join(repo, runDir, 'requests'))).length, 4);
  const verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'valid');
  assert.equal(verified.json.nextGate, 'stopped_on_codex_verdict');

  // After OK there is nothing to fix, so a later revision lists no findings.
  await ccli(repo, 'init', '--new-run');
  assert.equal((await contractPublish(repo)).code, 0);
  assert.equal((await contractRespond(repo, 1)).code, 0);
  await refusedWith([finding(scope, null, 1)], 'INPUT_INVALID', 'user_revision');
  assert.equal((await fix([], 'user_revision')).code, 0);
});

test('contract: input, worktree, HEAD, or contract changes make the review stale', async () => {
  const repo = await initRepo();
  await contractInitAndPublish(repo);
  assert.equal((await contractRespond(repo, 1)).code, 0);

  await writeFile(path.join(repo, 'notes/tasks.md'), '- [ ] 1.1 task (edited)\n');
  let verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'stale');
  assert.ok(codes(verified.json).includes('INPUTS_CHANGED'), JSON.stringify(verified.json));
  assert.equal(verified.json.nextGate, null);
  await writeFile(path.join(repo, 'notes/tasks.md'), '- [ ] 1.1 task\n');
  assert.equal((await ccli(repo, 'verify')).json.status, 'valid');

  await rm(path.join(repo, 'notes/tasks.md'));
  assert.ok(codes((await ccli(repo, 'verify')).json).includes('INPUTS_CHANGED'));
  await writeFile(path.join(repo, 'notes/tasks.md'), '- [ ] 1.1 task\n');

  await writeFile(path.join(repo, 'src.txt'), 'edited\n');
  assert.ok(codes((await ccli(repo, 'verify')).json).includes('DIGEST_CHANGED'));
  await writeFile(path.join(repo, 'src.txt'), 'two\n');

  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'move HEAD');
  verified = await ccli(repo, 'verify');
  assert.ok(codes(verified.json).includes('HEAD_CHANGED'), JSON.stringify(verified.json));

  // A changed contract is a new revision; the old OK no longer applies.
  const next = await contractPublish(repo, { reason: 'user_revision', contractText: `${CONTRACT_TEXT}\nchanged\n` });
  assert.equal(next.code, 0, JSON.stringify(next.json));
  const current = await ccli(repo, 'verify');
  assert.equal(current.json.status, 'valid');
  assert.equal(current.json.response.present, false);
  assert.equal(current.json.nextGate, 'awaiting_codex_response');
  const old = await ccli(repo, 'verify', '--revision', '1');
  assert.ok(codes(old.json).includes('NOT_CURRENT_REVISION'));
  assert.equal(old.json.nextGate, null);
  assert.equal((await contractRespond(repo, 1)).json.code, 'NOT_CURRENT_REVISION');

  await writeFile(path.join(repo, 'notes/tasks.md'), 'edited before Codex answered\n');
  const refused = await contractRespond(repo, 2);
  assert.equal(refused.json.code, 'REQUEST_STALE');
  assert.ok(codes(refused.json).includes('INPUTS_CHANGED'));
});

test('contract: a response cannot approve the contract on the user\'s behalf', async () => {
  const repo = await initRepo();
  const { published } = await contractInitAndPublish(repo);
  for (const overrides of [
    { verdict: 'APPROVED' },
    { verdict: 'PASS' },
    { approved: true },
    { userApproved: true },
    { decision: 'approve' },
  ]) {
    const refused = await contractRespond(repo, 1, overrides);
    assert.equal(refused.json.code, 'INPUT_INVALID', JSON.stringify(overrides));
  }
  assert.deepEqual(await readdir(path.join(repo, published.runDir, 'responses')), []);

  // A hand-written response carrying an approval field is invalid, not usable.
  const request = await readJson(repo, published.requestPath);
  const forged = {
    schemaVersion: 1,
    kind: 'contract-review-response',
    channel: 'contract',
    reviewer: 'codex',
    generatedAt: '2026-10-14T00:00:00Z',
    source: {
      stageId: 'T1',
      runId: published.runId,
      revision: 1,
      requestPath: 'requests/0001-contract-request.json',
      requestSha256: published.requestSha256,
      changedFilesDigest: request.changes.changedFilesDigest,
      inputsDigest: request.inputs.inputsDigest,
      contractSha256: request.contractSha256,
      currentHead: request.repo.currentHead,
    },
    ...contractResponseDraft(),
    userApproved: true,
  };
  await writeFile(path.join(repo, published.runDir, 'responses', '0001-codex-contract-review.json'), JSON.stringify(forged));
  const verified = await ccli(repo, 'verify');
  assert.equal(verified.json.status, 'invalid');
  assert.equal(verified.json.nextGate, null);
  assert.equal(verified.json.message, 'handoff unavailable or invalid — perform direct repository review');
});

test('contract: sensitive data fails closed for requests and responses', async () => {
  const repo = await initRepo();
  const { published } = await contractInitAndPublish(repo);
  const runDir = published.runDir;
  const indexBytes = await readFile(path.join(repo, runDir, 'index.json'));
  const leaks = [
    { contractText: `${CONTRACT_TEXT}\nUse password: hunter2 locally\n` },
    { contractText: `${CONTRACT_TEXT}\nDATABASE_URL=postgres://app:pw@db/errlog\n` },
    { contractText: `${CONTRACT_TEXT}\nContact parent@mail-provider.org\n` },
    { contractText: `${CONTRACT_TEXT}\nPhone 13812345678\n` },
    { contractText: `${CONTRACT_TEXT}\n13812345678 at the start of a line\n` },
    { contractText: `${CONTRACT_TEXT}\n-----BEGIN RSA PRIVATE KEY-----\n` },
    { nextAction: 'Use token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  ];
  for (const leak of leaks) {
    const result = await contractPublish(repo, { reason: 'manual_refresh', ...leak });
    assert.equal(result.json.code, 'SENSITIVE_DATA', JSON.stringify(leak));
  }
  const leakyResponse = await contractRespond(repo, 1, { suggestions: ['Log in with password: hunter2'] });
  assert.equal(leakyResponse.json.code, 'SENSITIVE_DATA');
  assert.deepEqual(await readFile(path.join(repo, runDir, 'index.json')), indexBytes);
  assert.deepEqual(await readdir(path.join(repo, runDir, 'requests')), ['0001-contract-request.json']);
  assert.deepEqual(await readdir(path.join(repo, runDir, 'responses')), []);
  const synthetic = await contractPublish(repo, {
    reason: 'manual_refresh',
    contractText: `${CONTRACT_TEXT}\nSeed identity dev-parent@example.test; POSTGRES_PASSWORD=<redacted>\n`,
  });
  assert.equal(synthetic.code, 0, JSON.stringify(synthetic.json));
});

test('contract: contractText and inputFiles are validated', async () => {
  const repo = await initRepo();
  await ccli(repo, 'init');
  const cases = [
    { contractText: '' },
    { contractText: 'x'.repeat(32 * 1024 + 1) },
    { contractText: 'bell \u0007 character' },
    { inputFiles: [] },
    { inputFiles: ['../outside.md'] },
    { inputFiles: ['/etc/hosts'] },
    { inputFiles: ['missing.md'] },
    { inputFiles: ['notes/tasks.md', 'notes/tasks.md'] },
    { inputFiles: ['notes'] },
    { openQuestions: [{ id: 'Q1', question: 'q', options: [], recommendation: 'A', rationale: 'r' }] },
  ];
  for (const overrides of cases) {
    const result = await contractPublish(repo, overrides);
    assert.equal(result.json.code, 'INPUT_INVALID', JSON.stringify(overrides).slice(0, 80));
  }
  const multiline = await contractPublish(repo, { contractText: `${'line\twith tab\n'.repeat(100)}` });
  assert.equal(multiline.code, 0, JSON.stringify(multiline.json));
});

test('contract: interrupted writes and locks are reported, never repaired', async () => {
  const repo = await initRepo();
  const { published } = await contractInitAndPublish(repo);
  const runDir = published.runDir;
  const requestBytes = await readFile(path.join(repo, published.requestPath));
  const indexBytes = await readFile(path.join(repo, runDir, 'index.json'));
  const leftovers = [
    { file: path.join(runDir, 'requests', '.tmp-0002-deadbeef'), code: 'ORPHAN_TEMP_FILE' },
    { file: path.join(runDir, '.index.tmp-deadbeef'), code: 'ORPHAN_TEMP_FILE' },
    { file: path.join(runDir, 'responses', '.tmp-0001-deadbeef'), code: 'ORPHAN_TEMP_FILE' },
    { file: path.join(runDir, 'requests', '0002-contract-request.json'), code: 'UNINDEXED_REQUEST' },
    { lock: path.join(runDir, '.lock'), code: 'LOCK_PRESENT' },
  ];
  for (const leftover of leftovers) {
    if (leftover.lock) await mkdir(path.join(repo, leftover.lock));
    else await writeFile(path.join(repo, leftover.file), requestBytes);
    const verified = await ccli(repo, 'verify');
    assert.equal(verified.json.status, 'stale', JSON.stringify(verified.json));
    assert.ok(codes(verified.json).includes(leftover.code), JSON.stringify(verified.json));
    assert.equal(verified.json.nextGate, null);
    assert.equal((await contractPublish(repo, { reason: 'manual_refresh' })).code, 1);
    assert.equal((await contractRespond(repo, 1)).code, 1);
    assert.deepEqual(await readFile(path.join(repo, published.requestPath)), requestBytes);
    assert.deepEqual(await readFile(path.join(repo, runDir, 'index.json')), indexBytes);
    if (leftover.lock) await rmdir(path.join(repo, leftover.lock));
    else await rm(path.join(repo, leftover.file), { force: true });
    assert.equal((await ccli(repo, 'verify')).json.status, 'valid');
  }
});

test('contract: input paths with spaces, tabs, newlines, and quotes digest unambiguously', async () => {
  const repo = await initRepo();
  const names = ['spec with space.md', 'spec\twith\ttab.md', 'spec\nwith\nnewline.md', 'spec "quoted".md'];
  for (const name of names) await writeFile(path.join(repo, name), `${name}\n`);
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-q', '-m', 'inputs');
  await writeFile(path.join(repo, 'src.txt'), 'two\n');
  const { published } = await contractInitAndPublish(repo, { inputFiles: names });
  const request = await readJson(repo, published.requestPath);
  for (const name of names) {
    const entry = request.inputs.files.find((file) => file.path === name);
    assert.equal(entry.sha256, `sha256:${sha256(`${name}\n`)}`);
  }
  assert.equal(request.inputs.inputsDigest, `sha256:${sha256(encodeInputs(request.inputs.files))}`);
  assert.equal((await ccli(repo, 'verify')).json.status, 'valid');

  // Under "content\tpath\n" these two sets produce identical bytes.
  const one = [{ path: 'a\nsha256:11\tb', sha256: 'sha256:00' }];
  const two = [{ path: 'a', sha256: 'sha256:00' }, { path: 'b', sha256: 'sha256:11' }];
  assert.notDeepEqual(encodeInputs(one), encodeInputs(two));
  assert.deepEqual(encodeInputs([...two].reverse()), encodeInputs(two));
  assert.ok(encodeInputs([]).toString('utf8').startsWith('errlog-contract-inputs/v1\0'));
});
