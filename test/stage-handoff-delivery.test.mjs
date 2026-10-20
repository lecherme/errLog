import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { FINGERPRINT_KEYS, parseCheckpointState, publishImmutable, reviewFingerprint } from '../tools/stage-handoff.mjs';

const TOOLS = path.resolve(import.meta.dirname, '..', 'tools');
const HANDOFF = path.join(TOOLS, 'stage-handoff.mjs');
const SAFE_COMMIT = path.join(TOOLS, 'safe-commit.mjs');
const URL_SENTINEL = 'url-sentinel-61d0';
const CREDENTIAL_SENTINEL = 'credential-sentinel-a83f';
const temporaryPaths = [];
let draftNumber = 0;

after(async () => {
  for (const target of temporaryPaths) await rm(target, { recursive: true, force: true });
});

async function command(cwd, executable, args, env = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function git(cwd, ...args) {
  const result = await command(cwd, 'git', args);
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const endpointHash = (url) => sha256(Buffer.concat([
  Buffer.from('errlog-push-endpoint/v1\0', 'utf8'), Buffer.from(url, 'utf8'), Buffer.from('\0', 'utf8'),
]));
const codes = (json) => (json.reasons ?? []).map((reason) => reason.code);

async function draftFile(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'delivery-draft-'));
  temporaryPaths.push(dir);
  const file = path.join(dir, `draft-${++draftNumber}.json`);
  await writeFile(file, JSON.stringify(content));
  return file;
}

// Same test-only ssh transport as test/safe-commit.test.mjs: no network, every call logged.
const WRAPPER_SOURCE = `
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const fixture = process.env.DELIVERY_TEST_FIXTURE;
const [host, cmd] = process.argv.slice(-2);
const match = /^(git-receive-pack|git-upload-pack) '(.+)'$/.exec(cmd);
if (!match || !host.endsWith('example.invalid')) process.exit(255);
const service = match[1];
const name = path.basename(match[2]);
const mode = existsSync(path.join(fixture, 'mode')) ? readFileSync(path.join(fixture, 'mode'), 'utf8').trim() : '';
appendFileSync(path.join(fixture, 'calls.log'), service + ' ' + name + '\\n');
if (mode === 'fail-all' || (mode === 'fail-upload' && service === 'git-upload-pack')) {
  process.stderr.write('fatal: ${URL_SENTINEL} ${CREDENTIAL_SENTINEL}\\n');
  process.stdout.write('${URL_SENTINEL} ${CREDENTIAL_SENTINEL}\\n');
  process.exit(128);
}
const result = spawnSync('git', [service.slice(4), path.join(fixture, 'remotes', name)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
`;

const SCRATCHPAD = (state) => [
  '# Scratchpad',
  '',
  '## Implementation Checkpoint',
  '',
  '- stageId: T1',
  `- stageState: ${state}`,
  '',
  '## Notes',
  '',
].join('\n');

const TASKS = '## 1. Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n';

// A temporary repository with a pushable upstream, a PASS implementation handoff, and the
// closure edits (checkbox + checkpoint) that happen between that review and safe-commit check.
async function createStage({
  files = { 'src.txt': 'one\n' },
  changes = async (repo) => { await writeFile(path.join(repo, 'src.txt'), 'two\n'); },
  allowedFiles = ['src.txt', 'notes/scratchpad.md'],
  checkpoint = 'notes/scratchpad.md',
  taskIds = ['1.1'],
  scratchpadBeforeReview = SCRATCHPAD('implementing'),
  closure = true,
} = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'delivery-test-'));
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'delivery-remote-'));
  temporaryPaths.push(repo, fixture);
  await git(repo, 'init', '-q', '--initial-branch=feature');
  await git(repo, 'config', 'user.name', 'Delivery Test');
  await git(repo, 'config', 'user.email', 'delivery@example.invalid');
  await mkdir(path.join(repo, 'notes'));
  await writeFile(path.join(repo, '.gitignore'), '.agent-handoffs/\n');
  await writeFile(path.join(repo, '.safe-commit.json'), `${JSON.stringify({
    protectedBranches: ['main', 'master', 'trunk'],
    denyPatterns: ['.git/**', '**/.env', 'node_modules/**'],
    allowPush: true,
    requireCleanIndex: true,
    planTtlMinutes: 15,
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'notes', 'scratchpad.md'), SCRATCHPAD('planning'));
  await writeFile(path.join(repo, 'notes', 'tasks.md'), TASKS);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, name)), { recursive: true });
    await writeFile(path.join(repo, name), content);
  }
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-q', '-m', 'initial');

  await mkdir(path.join(fixture, 'remotes'));
  await writeFile(path.join(fixture, 'wrapper.mjs'), WRAPPER_SOURCE);
  await writeFile(path.join(fixture, 'calls.log'), '');
  const env = {
    ...process.env,
    DELIVERY_TEST_FIXTURE: fixture,
    GIT_SSH_COMMAND: `"${process.execPath}" "${path.join(fixture, 'wrapper.mjs')}"`,
    GIT_SSH_VARIANT: 'simple',
  };
  const url = (name) => `ssh://git.example.invalid/${name}.git`;
  const remoteDir = (name) => path.join(fixture, 'remotes', `${name}.git`);
  await git(fixture, 'clone', '--bare', '-q', repo, remoteDir('origin'));
  await git(repo, 'remote', 'add', 'origin', url('origin'));
  assert.equal((await command(repo, 'git', ['fetch', '-q', 'origin'], env)).code, 0);
  await git(repo, 'branch', '--set-upstream-to=origin/feature');
  await writeFile(path.join(fixture, 'calls.log'), '');

  const stage = {
    repo,
    fixture,
    env,
    url,
    remoteDir,
    async handoff(...args) {
      const result = await command(repo, process.execPath, [HANDOFF, ...args, '--json'], env);
      try {
        return { code: result.code, json: JSON.parse(result.stdout), stdout: result.stdout };
      } catch {
        return assert.fail(`non-JSON output (exit ${result.code}): ${result.stdout}${result.stderr}`);
      }
    },
    async safeCommit(...args) {
      const result = await command(repo, process.execPath, [SAFE_COMMIT, ...args, '--json'], env);
      return { code: result.code, json: JSON.parse(result.stdout), stdout: result.stdout };
    },
    async calls() {
      return (await readFile(path.join(fixture, 'calls.log'), 'utf8')).split('\n').filter(Boolean);
    },
    async setMode(mode) {
      await writeFile(path.join(fixture, 'mode'), mode);
    },
    async gitEnv(...args) {
      const result = await command(repo, 'git', args, env);
      assert.equal(result.code, 0, result.stderr);
      return result.stdout.trim();
    },
  };

  await writeFile(path.join(repo, 'notes', 'scratchpad.md'), scratchpadBeforeReview);
  await changes(repo);
  const implInit = await stage.handoff('init', '--stage', 'T1', '--channel', 'implementation');
  assert.equal(implInit.code, 0, implInit.stdout);
  stage.implementationRunId = implInit.json.runId;
  const published = await stage.handoff('publish', '--stage', 'T1', '--input', await draftFile({
    reason: 'initial',
    contract: { summary: 'Delivery test stage.', taskIds, allowedFiles },
    checkpoint: checkpoint === null ? null : {
      path: checkpoint,
      summary: { stageId: 'T1', stageState: 'implementing', progress: '1/1' },
      containsApprovedContract: true,
    },
    verification: [{ name: 'unit', redactedCommand: 'node --test', exitCode: 0, result: 'PASS', conciseSummary: 'All tests pass.' }],
    claudeReview: {
      reviewerType: 'claude-subagent-fresh-readonly', round: 1, verdict: 'PASS', blockingFindings: [], nonBlockingFindings: [], fixesApplied: [],
    },
    contractDeviations: [],
    safeCommitPlanId: null,
    nextAction: 'Wait for the Codex implementation review.',
  }));
  assert.equal(published.code, 0, published.stdout);
  const reviewed = await stage.handoff('respond', '--stage', 'T1', '--revision', '1', '--input', await draftFile(responseDraft()));
  assert.equal(reviewed.code, 0, reviewed.stdout);
  if (closure) await applyClosure(stage, { checkpoint, taskIds });
  return stage;
}

async function applyClosure(stage, { checkpoint = 'notes/scratchpad.md', taskIds = ['1.1'] } = {}) {
  if (checkpoint === null) return;
  let tasks = await readFile(path.join(stage.repo, 'notes', 'tasks.md'), 'utf8');
  for (const id of taskIds) tasks = tasks.replace(`- [ ] ${id} `, `- [x] ${id} `);
  await writeFile(path.join(stage.repo, 'notes', 'tasks.md'), tasks);
  const scratchpad = await readFile(path.join(stage.repo, checkpoint), 'utf8');
  await writeFile(path.join(stage.repo, checkpoint), scratchpad.replace(/- stageState: \S+/u, '- stageState: ready_for_safe_commit'));
}

function responseDraft(overrides = {}) {
  return {
    verdict: 'PASS',
    blockingFindings: [],
    nonBlockingFindings: [],
    checksPerformed: ['Read the record'],
    limitations: [],
    nextAction: 'Return to the user.',
    ...overrides,
  };
}

let requestNumber = 0;
async function check(stage, files = ['notes/scratchpad.md', 'notes/tasks.md', 'src.txt'], commitMessage = 'feat: delivery test') {
  const dir = path.join(stage.repo, '.git', 'safe-commit', 'requests');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `request-${++requestNumber}.json`);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, producer: 'test', taskId: 'T1', files, commitMessage }));
  const result = await stage.safeCommit('check', '--request', file);
  assert.equal(result.code, 0, result.stdout);
  return result.json.planId;
}

async function initDelivery(stage) {
  const result = await stage.handoff('init', '--stage', 'T1', '--channel', 'delivery');
  assert.equal(result.code, 0, result.stdout);
  return result.json;
}

async function publish(stage, kind, draft) {
  return await stage.handoff('publish', '--stage', 'T1', '--channel', 'delivery', '--kind', kind, '--input', await draftFile(draft));
}

const commitReadyDraft = (stage, planId, overrides = {}) => ({
  reason: 'initial',
  implementation: { runId: stage.implementationRunId, revision: 1 },
  planId,
  priorFindings: [],
  nextAction: 'Stop for the Codex commit review.',
  ...overrides,
});
const pushReadyDraft = (overrides = {}) => ({ reason: 'initial', priorFindings: [], nextAction: 'Stop for the Codex push review.', ...overrides });
const resultDraft = { nextAction: 'Stop and report.' };

async function respond(stage, sequence, overrides = {}) {
  return await stage.handoff('respond', '--stage', 'T1', '--channel', 'delivery', '--revision', String(sequence), '--input', await draftFile(responseDraft(overrides)));
}

async function verify(stage) {
  return (await stage.handoff('verify', '--stage', 'T1', '--channel', 'delivery')).json;
}

async function record(stage, relative) {
  return JSON.parse(await readFile(path.join(stage.repo, relative), 'utf8'));
}

async function planFile(stage, planId) {
  return path.join(stage.repo, '.git', 'safe-commit', 'plans', `${planId}.json`);
}

async function editPlan(stage, planId, edit) {
  const file = await planFile(stage, planId);
  const plan = JSON.parse(await readFile(file, 'utf8'));
  edit(plan);
  await writeFile(file, JSON.stringify(plan));
}

function ok(result, label = '') {
  assert.equal(result.code, 0, `${label} ${result.stdout}`);
  return result.json;
}

// Drives a stage from check to a published, Codex-approved push-ready record.
async function toPushApproved(stage, { files, message } = {}) {
  const planId = await check(stage, files, message);
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)), 'commit-ready');
  ok(await respond(stage, 1), 'commit review');
  const committed = await stage.safeCommit('commit', '--plan', planId);
  assert.equal(committed.code, 0, committed.stdout);
  ok(await publish(stage, 'commit-result', resultDraft), 'commit-result');
  const pushReady = ok(await publish(stage, 'push-ready', pushReadyDraft()), 'push-ready');
  ok(await respond(stage, 4), 'push review');
  return { planId, commitSha: committed.json.commitSha, pushReady: await record(stage, pushReady.recordPath) };
}

async function guardedPush(stage, planId, pushReady) {
  return await stage.safeCommit('push', '--plan', planId,
    '--endpoint-sha256', pushReady.target.endpointSha256, '--target-ref', pushReady.target.targetRef);
}

async function allHandoffText(stage) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else out.push(await readFile(target, 'utf8'));
    }
  }
  await walk(path.join(stage.repo, '.agent-handoffs'));
  return out.join('\n');
}

test('full delivery flow reaches delivered with the right gate at every step', async () => {
  const stage = await createStage();
  const statusBefore = await git(stage.repo, 'status', '--porcelain=v1');
  const planId = await check(stage);
  const init = await initDelivery(stage);
  assert.match(init.runDir, /^\.agent-handoffs\/T1\/delivery\/runs\//u);

  const ready = ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  assert.equal(ready.sequence, 1);
  assert.equal((await stat(path.join(stage.repo, ready.recordPath))).mode & 0o777, 0o444);
  const commitReady = await record(stage, ready.recordPath);
  assert.equal(commitReady.recordKind, 'commit-ready');
  assert.equal(commitReady.previousRecord, null);
  assert.equal(commitReady.plan.planId, planId);
  assert.equal(commitReady.plan.state, 'ready');
  assert.deepEqual(commitReady.closure.closureFiles, ['notes/tasks.md', 'notes/scratchpad.md'].sort());
  assert.deepEqual(commitReady.closure.checkedTaskIds, ['1.1']);
  assert.equal(commitReady.closure.checkpoint.stageState, 'ready_for_safe_commit');
  assert.equal(commitReady.inheritedReview, null);
  assert.match(commitReady.reviewFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(await git(stage.repo, 'status', '--porcelain=v1'), statusBefore);

  let state = await verify(stage);
  assert.equal(state.status, 'valid', JSON.stringify(state));
  assert.equal(state.nextGate, 'awaiting_codex_commit_review');
  assert.ok(state.planSecondsRemaining > 800);

  ok(await respond(stage, 1));
  state = await verify(stage);
  assert.equal(state.nextGate, 'awaiting_user_commit_approval');
  assert.ok(state.notices.some((notice) => notice.code === 'CODEX_PASS_IS_NOT_APPROVAL'));

  const committed = await stage.safeCommit('commit', '--plan', planId);
  assert.equal(committed.code, 0);
  assert.equal((await verify(stage)).nextGate, 'awaiting_commit_result');
  const result = ok(await publish(stage, 'commit-result', resultDraft));
  const commitResult = await record(stage, result.recordPath);
  assert.equal(commitResult.commit.sha, committed.json.commitSha);
  assert.equal(commitResult.previousRecord.sha256, sha256(await readFile(path.join(stage.repo, state.record.path))));
  assert.equal((await verify(stage)).nextGate, 'awaiting_push_ready');

  const pushReady = await record(stage, ok(await publish(stage, 'push-ready', pushReadyDraft())).recordPath);
  assert.equal(pushReady.target.endpointSha256, endpointHash(stage.url('origin')));
  assert.equal(pushReady.target.targetRef, 'refs/heads/feature');
  assert.equal(pushReady.intent.force, false);
  assert.equal(pushReady.intent.command,
    `node tools/safe-commit.mjs push --plan ${planId} --endpoint-sha256 ${pushReady.target.endpointSha256} --target-ref refs/heads/feature --json`);
  assert.equal((await verify(stage)).nextGate, 'awaiting_codex_push_review');
  ok(await respond(stage, 4));
  state = await verify(stage);
  assert.equal(state.status, 'valid');
  assert.equal(state.nextGate, 'awaiting_user_push_approval');
  assert.ok(state.notices.some((notice) => notice.code === 'CODEX_PASS_IS_NOT_APPROVAL'));

  assert.equal((await guardedPush(stage, planId, pushReady)).code, 0);
  assert.equal((await verify(stage)).nextGate, 'awaiting_push_result');
  const pushResult = await record(stage, ok(await publish(stage, 'push-result', resultDraft)).recordPath);
  assert.equal(pushResult.push.remoteSha, committed.json.commitSha);
  assert.deepEqual(pushResult.ci, { status: 'not_configured', note: 'No tracked .github/workflows/* at HEAD; this tool never queries CI.' });
  state = await verify(stage);
  assert.equal(state.status, 'valid');
  assert.equal(state.nextGate, 'delivered');
  const after = await publish(stage, 'push-ready', pushReadyDraft({ reason: 'push_retry' }));
  assert.equal(after.json.code, 'OUT_OF_ORDER');
  for (const text of [await allHandoffText(stage)]) assert.ok(!text.includes('example.invalid'));
});

test('S1.4-shaped closure: six reviewed files plus tasks.md, fenced contract ignored', async () => {
  const contract = [
    '````markdown',
    '## Implementation Checkpoint',
    '- stageState: ready_for_safe_commit',
    '````',
  ].join('\n');
  const stage = await createStage({
    files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', 'd.txt': 'd\n' },
    changes: async (repo) => {
      for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) await writeFile(path.join(repo, name), 'changed\n');
      await writeFile(path.join(repo, 'e.txt'), 'new\n');
    },
    allowedFiles: ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'notes/scratchpad.md'],
    scratchpadBeforeReview: `${SCRATCHPAD('implementing')}\nHistory: stageState: ready_for_safe_commit was planned.\n\n${contract}\n`,
  });
  const files = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'notes/scratchpad.md', 'notes/tasks.md'];
  const planId = await check(stage, files);
  await initDelivery(stage);
  const ready = await record(stage, ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId))).recordPath);
  assert.equal(ready.plan.files.length, 7);
  assert.equal(ready.closure.reviewedFiles.length, 6);
  assert.equal((await verify(stage)).status, 'valid');
});

test('closure failures write nothing', async () => {
  const cases = [
    ['extra tasks.md edit', async (stage) => {
      await writeFile(path.join(stage.repo, 'notes', 'tasks.md'), `${await readFile(path.join(stage.repo, 'notes', 'tasks.md'), 'utf8')}extra\n`);
    }, 'POST_REVIEW_CHANGES'],
    ['another stage checked', async (stage) => {
      const file = path.join(stage.repo, 'notes', 'tasks.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace('- [ ] 1.2 ', '- [x] 1.2 '));
    }, 'POST_REVIEW_CHANGES'],
    ['own task unchecked', async (stage) => {
      const file = path.join(stage.repo, 'notes', 'tasks.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace('- [x] 1.1 ', '- [ ] 1.1 ').replace('## 1. Tasks', '## 1. Tasks!'));
    }, 'POST_REVIEW_CHANGES'],
    ['checkpoint not ready', async (stage) => {
      await writeFile(path.join(stage.repo, 'notes', 'scratchpad.md'), SCRATCHPAD('implementing'));
    }, 'CHECKPOINT_NOT_READY'],
    ['reviewed file changed after review', async (stage) => {
      await writeFile(path.join(stage.repo, 'src.txt'), 'three\n');
    }, 'POST_REVIEW_CHANGES'],
  ];
  for (const [label, mutate, code] of cases) {
    const stage = await createStage();
    await mutate(stage);
    const planId = await check(stage);
    await initDelivery(stage);
    const result = await publish(stage, 'commit-ready', commitReadyDraft(stage, planId));
    assert.equal(result.json.code, code, label);
    assert.deepEqual(codes(await verify(stage)), ['NO_RECORD'], label);
  }
  const extraFile = await createStage();
  await writeFile(path.join(extraFile.repo, 'unreviewed.txt'), 'x\n');
  const extraPlan = await check(extraFile, ['notes/scratchpad.md', 'notes/tasks.md', 'src.txt', 'unreviewed.txt']);
  await initDelivery(extraFile);
  assert.equal((await publish(extraFile, 'commit-ready', commitReadyDraft(extraFile, extraPlan))).json.code, 'POST_REVIEW_CHANGES');

  const workflowStage = await createStage({ checkpoint: null, allowedFiles: ['src.txt'], closure: false });
  const tasks = path.join(workflowStage.repo, 'notes', 'tasks.md');
  await writeFile(tasks, (await readFile(tasks, 'utf8')).replace('- [ ] 1.1 ', '- [x] 1.1 '));
  const workflowPlan = await check(workflowStage, ['notes/tasks.md', 'src.txt']);
  await initDelivery(workflowStage);
  assert.equal((await publish(workflowStage, 'commit-ready', commitReadyDraft(workflowStage, workflowPlan))).json.code, 'POST_REVIEW_CHANGES');
  const workflowOnly = await check(workflowStage, ['src.txt']);
  const ready = ok(await publish(workflowStage, 'commit-ready', commitReadyDraft(workflowStage, workflowOnly)));
  assert.equal((await record(workflowStage, ready.recordPath)).closure.checkpoint, null);
});

test('authoritative checkpoint parsing ignores fences and history and rejects ambiguity', () => {
  const fence = '```\n## Implementation Checkpoint\n- stageState: ready_for_safe_commit\n```';
  assert.deepEqual(parseCheckpointState(SCRATCHPAD('ready_for_safe_commit')), { stageState: 'ready_for_safe_commit' });
  assert.deepEqual(parseCheckpointState(`${SCRATCHPAD('implementing')}\n${fence}\n`), { stageState: 'implementing' });
  assert.deepEqual(parseCheckpointState(`- stageState: ready_for_safe_commit\n${SCRATCHPAD('implementing')}`), { stageState: 'implementing' });
  assert.deepEqual(parseCheckpointState(`${fence}\n`), { error: 'CHECKPOINT_AMBIGUOUS' });
  assert.deepEqual(parseCheckpointState('# none\n'), { error: 'CHECKPOINT_AMBIGUOUS' });
  assert.deepEqual(parseCheckpointState(`${SCRATCHPAD('a')}\n${SCRATCHPAD('b')}`), { error: 'CHECKPOINT_AMBIGUOUS' });
  assert.deepEqual(parseCheckpointState('## Implementation Checkpoint\n- stageState: a\n- stageState: b\n'), { error: 'CHECKPOINT_AMBIGUOUS' });
  assert.deepEqual(parseCheckpointState('## Implementation Checkpoint\n- stageId: T1\n'), { error: 'CHECKPOINT_AMBIGUOUS' });
  const fencedInside = '## Implementation Checkpoint\n````md\n- stageState: ready_for_safe_commit\n```\n````\n- stageState: implementing\n## Next\n- stageState: x\n';
  assert.deepEqual(parseCheckpointState(fencedInside), { stageState: 'implementing' });
  assert.deepEqual(parseCheckpointState('~~~\n## Implementation Checkpoint\n~~~\n## Implementation Checkpoint\n- stageState: ok\n'), { stageState: 'ok' });
});

test('checkpoint text only in history or fences is refused through the CLI', async () => {
  const stage = await createStage({
    scratchpadBeforeReview: `${SCRATCHPAD('implementing')}\n\`\`\`\n- stageState: ready_for_safe_commit\n\`\`\`\n`,
    closure: false,
  });
  const tasks = path.join(stage.repo, 'notes', 'tasks.md');
  await writeFile(tasks, (await readFile(tasks, 'utf8')).replace('- [ ] 1.1 ', '- [x] 1.1 '));
  await writeFile(path.join(stage.repo, 'notes', 'scratchpad.md'),
    `${SCRATCHPAD('implementing')}\nHistory: stageState: ready_for_safe_commit\n\`\`\`\n- stageState: ready_for_safe_commit\n\`\`\`\n`);
  const planId = await check(stage);
  await initDelivery(stage);
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, planId))).json.code, 'CHECKPOINT_NOT_READY');
  await writeFile(path.join(stage.repo, 'notes', 'scratchpad.md'), `${SCRATCHPAD('ready_for_safe_commit')}\n${SCRATCHPAD('ready_for_safe_commit')}`);
  const second = await check(stage);
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, second))).json.code, 'CHECKPOINT_AMBIGUOUS');
});

test('binding: implementation PASS, HEAD and a well-formed inspect binding are required', async () => {
  const stage = await createStage();
  const planId = await check(stage);
  await initDelivery(stage);
  const wrongRevision = await publish(stage, 'commit-ready', commitReadyDraft(stage, planId, { implementation: { runId: stage.implementationRunId, revision: 2 } }));
  assert.equal(wrongRevision.json.code, 'IMPLEMENTATION_NOT_PASS');

  const failed = await createStage();
  const failedPublish = await failed.handoff('publish', '--stage', 'T1', '--input', await draftFile({
    reason: 'targeted_fix',
    contract: { summary: 'Delivery test stage.', taskIds: ['1.1'], allowedFiles: ['src.txt', 'notes/scratchpad.md'] },
    checkpoint: { path: 'notes/scratchpad.md', summary: { stageId: 'T1', stageState: 'ready', progress: '1/1' }, containsApprovedContract: true },
    verification: [],
    claudeReview: { reviewerType: 'x', round: 1, verdict: 'PASS', blockingFindings: [], nonBlockingFindings: [], fixesApplied: [] },
    contractDeviations: [],
    safeCommitPlanId: null,
    nextAction: 'Wait.',
  }));
  assert.equal(failedPublish.code, 0, failedPublish.stdout);
  assert.equal((await failed.handoff('respond', '--stage', 'T1', '--revision', '2', '--input', await draftFile(responseDraft({ verdict: 'FAIL', blockingFindings: ['B1 broken'] })))).code, 0);
  const failedPlan = await check(failed);
  await initDelivery(failed);
  const notPass = await publish(failed, 'commit-ready', commitReadyDraft(failed, failedPlan, { implementation: { runId: failed.implementationRunId, revision: 2 } }));
  assert.equal(notPass.json.code, 'IMPLEMENTATION_NOT_PASS');

  await git(stage.repo, 'commit', '-q', '--allow-empty', '-m', 'unrelated');
  const moved = await publish(stage, 'commit-ready', commitReadyDraft(stage, planId));
  assert.equal(moved.json.code, 'HEAD_CHANGED');

  // A stand-in safe-commit next to a copy of the tool returns a missing or malformed binding.
  for (const binding of [undefined, { head: 'x' }, { head: 'a'.repeat(40), policyHash: 'b'.repeat(64), indexEntries: [], approvedTree: null, endpoint: null, push: null }]) {
    const stub = await mkdtemp(path.join(os.tmpdir(), 'delivery-stub-'));
    temporaryPaths.push(stub);
    await copyFile(HANDOFF, path.join(stub, 'stage-handoff.mjs'));
    const real = (await stage.safeCommit('inspect', '--plan', planId)).json;
    const fake = { ...real };
    if (binding === undefined) delete fake.binding;
    else fake.binding = binding;
    await writeFile(path.join(stub, 'safe-commit.mjs'), `process.stdout.write(${JSON.stringify(JSON.stringify(fake))} + '\\n');\n`);
    const fresh = await createStage();
    const freshPlan = await check(fresh);
    await initDelivery(fresh);
    const result = await command(fresh.repo, process.execPath, [path.join(stub, 'stage-handoff.mjs'), 'publish', '--stage', 'T1', '--channel', 'delivery',
      '--kind', 'commit-ready', '--input', await draftFile(commitReadyDraft(fresh, freshPlan)), '--json'], fresh.env);
    const json = JSON.parse(result.stdout);
    assert.equal(json.code, 'PLAN_BINDING_UNAVAILABLE', result.stdout);
    assert.ok(Array.isArray(json.fields) && json.fields.length > 0);
  }
});

test('Git-entry manifest: deletion, symlink, executable mode and rename; foreign commits are refused', async () => {
  // A symlink reaches commit-ready with its own manifest kind. (safe-commit check predicts a
  // symlink's blob from the target's content, so committing one is a pre-existing limitation.)
  const linked = await createStage({
    files: { 'tool.sh': 'echo\n' },
    changes: async (repo) => { await symlink('tool.sh', path.join(repo, 'link')); },
    allowedFiles: ['link', 'notes/scratchpad.md'],
  });
  const linkedPlan = await check(linked, ['link', 'notes/scratchpad.md', 'notes/tasks.md']);
  await initDelivery(linked);
  const linkedReady = await record(linked, ok(await publish(linked, 'commit-ready', commitReadyDraft(linked, linkedPlan))).recordPath);
  assert.deepEqual(linkedReady.manifest.entries.find((entry) => entry.path === 'link').kind, 'symlink');
  assert.equal(linkedReady.manifest.entries.find((entry) => entry.path === 'link').mode, '120000');

  const stage = await createStage({
    files: { 'gone.txt': 'g\n', 'old-name.txt': 'r\n', 'tool.sh': 'echo\n' },
    changes: async (repo) => {
      await unlink(path.join(repo, 'gone.txt'));
      await rename(path.join(repo, 'old-name.txt'), path.join(repo, 'new-name.txt'));
      await chmod(path.join(repo, 'tool.sh'), 0o755);
    },
    allowedFiles: ['gone.txt', 'old-name.txt', 'new-name.txt', 'tool.sh', 'notes/scratchpad.md'],
  });
  const files = ['gone.txt', 'new-name.txt', 'notes/scratchpad.md', 'notes/tasks.md', 'old-name.txt', 'tool.sh'];
  const planId = await check(stage, files);
  await initDelivery(stage);
  const ready = await record(stage, ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId))).recordPath);
  const kinds = Object.fromEntries(ready.manifest.entries.map((entry) => [entry.path, entry.kind]));
  assert.deepEqual(kinds, {
    'gone.txt': 'deleted', 'new-name.txt': 'blob', 'notes/scratchpad.md': 'blob',
    'notes/tasks.md': 'blob', 'old-name.txt': 'deleted', 'tool.sh': 'executable',
  });
  assert.match(ready.manifest.manifestSha256, /^[0-9a-f]{64}$/u);
  ok(await respond(stage, 1));
  assert.equal((await stage.safeCommit('commit', '--plan', planId)).code, 0);
  const result = await record(stage, ok(await publish(stage, 'commit-result', resultDraft)).recordPath);
  assert.equal(result.entries.length, 6);
  assert.deepEqual(result.entries.find((entry) => entry.path === 'tool.sh').mode, '100755');

  // Commits not produced from the reviewed plan: the committed plan is pointed at a crafted
  // commit whose file set, mode, blob, message or tree differs.
  const variants = [
    ['extra file', async (repo, env, blob) => command(repo, 'git', ['update-index', '--add', '--cacheinfo', `100644,${await blob('x\n')},extra.txt`], env), 'COMMIT_ENTRY_MISMATCH'],
    ['mode', async (repo, env) => command(repo, 'git', ['update-index', '--cacheinfo', `100755,${await git(repo, 'rev-parse', 'HEAD:src.txt')},src.txt`], env), 'COMMIT_ENTRY_MISMATCH'],
    ['blob', async (repo, env, blob) => command(repo, 'git', ['update-index', '--cacheinfo', `100644,${await blob('other\n')},src.txt`], env), 'COMMIT_ENTRY_MISMATCH'],
    ['message', async () => {}, 'COMMIT_MESSAGE_MISMATCH'],
  ];
  for (const [label, edit, code] of variants) {
    const fresh = await createStage();
    const freshPlan = await check(fresh);
    await initDelivery(fresh);
    ok(await publish(fresh, 'commit-ready', commitReadyDraft(fresh, freshPlan)));
    ok(await respond(fresh, 1));
    assert.equal((await fresh.safeCommit('commit', '--plan', freshPlan)).code, 0);
    const envIndex = { ...process.env, GIT_INDEX_FILE: path.join(fresh.fixture, 'crafted-index') };
    assert.equal((await command(fresh.repo, 'git', ['read-tree', 'HEAD'], envIndex)).code, 0);
    const blob = async (content) => {
      const file = path.join(fresh.fixture, `blob-${++requestNumber}`);
      await writeFile(file, content);
      return await git(fresh.repo, 'hash-object', '-w', file);
    };
    await edit(fresh.repo, envIndex, blob);
    const tree = (await command(fresh.repo, 'git', ['write-tree'], envIndex)).stdout.trim();
    const message = label === 'message' ? 'feat: something else' : 'feat: delivery test';
    const crafted = await git(fresh.repo, 'commit-tree', '-p', 'HEAD^', '-m', message, tree);
    await git(fresh.repo, 'update-ref', 'HEAD', crafted);
    await editPlan(fresh, freshPlan, (plan) => { plan.commitSha = crafted; });
    const refused = await publish(fresh, 'commit-result', resultDraft);
    assert.equal(refused.json.code, code, `${label}: ${refused.stdout}`);
  }
  const treeCase = await createStage();
  const treePlan = await check(treeCase);
  await initDelivery(treeCase);
  ok(await publish(treeCase, 'commit-ready', commitReadyDraft(treeCase, treePlan)));
  ok(await respond(treeCase, 1));
  assert.equal((await treeCase.safeCommit('commit', '--plan', treePlan)).code, 0);
  await editPlan(treeCase, treePlan, (plan) => { plan.approvedTree = '0'.repeat(40); });
  assert.equal((await publish(treeCase, 'commit-result', resultDraft)).json.code, 'COMMIT_TREE_MISMATCH');
});

test('B14: expiry after commit never blocks the push side; an expired ready plan still fails', async () => {
  const stage = await createStage();
  const planId = await check(stage);
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  ok(await respond(stage, 1));
  assert.equal((await stage.safeCommit('commit', '--plan', planId)).code, 0);
  const past = new Date(Date.now() - 60_000).toISOString();
  await editPlan(stage, planId, (plan) => { plan.expiresAt = past; });
  ok(await publish(stage, 'commit-result', resultDraft));
  const pushReady = await record(stage, ok(await publish(stage, 'push-ready', pushReadyDraft())).recordPath);
  assert.equal((await verify(stage)).status, 'valid');
  ok(await respond(stage, 4));
  assert.equal((await verify(stage)).nextGate, 'awaiting_user_push_approval');
  assert.equal((await guardedPush(stage, planId, pushReady)).code, 0);
  ok(await publish(stage, 'push-result', resultDraft));
  assert.equal((await verify(stage)).nextGate, 'delivered');

  const expired = await createStage();
  const expiredPlan = await check(expired);
  await initDelivery(expired);
  await editPlan(expired, expiredPlan, (plan) => { plan.expiresAt = past; });
  assert.equal((await publish(expired, 'commit-ready', commitReadyDraft(expired, expiredPlan))).json.code, 'PLAN_EXPIRED');
  const fresh = await check(expired);
  ok(await publish(expired, 'commit-ready', commitReadyDraft(expired, fresh)));
  await editPlan(expired, fresh, (plan) => { plan.expiresAt = past; });
  assert.deepEqual(codes(await verify(expired)), ['PLAN_EXPIRED']);
  assert.equal((await respond(expired, 1)).json.code, 'REQUEST_STALE');
});

test('fail closed on consumed plans, changed files, HEAD, upstream, policy, ahead count and target ref', async () => {
  const stage = await createStage();
  const planId = await check(stage);
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  await editPlan(stage, planId, (plan) => { plan.expiresAt = new Date(Date.now() + 100_000).toISOString(); });
  let state = await verify(stage);
  assert.equal(state.status, 'valid');
  assert.ok(state.notices.some((notice) => notice.code === 'PLAN_NEAR_EXPIRY'));
  await writeFile(path.join(stage.repo, 'src.txt'), 'changed again\n');
  state = await verify(stage);
  assert.equal(state.status, 'stale');
  assert.ok(codes(state).includes('FILES_CHANGED') && codes(state).includes('DIGEST_CHANGED'), JSON.stringify(codes(state)));
  await writeFile(path.join(stage.repo, 'src.txt'), 'two\n');
  const policy = path.join(stage.repo, '.safe-commit.json');
  const policyBytes = await readFile(policy);
  await writeFile(policy, policyBytes.toString().replace('"planTtlMinutes": 15', '"planTtlMinutes": 16'));
  assert.ok(codes(await verify(stage)).includes('POLICY_CHANGED'));
  await writeFile(policy, policyBytes);
  await git(stage.repo, 'commit', '-q', '--allow-empty', '-m', 'moved');
  assert.ok(codes(await verify(stage)).includes('HEAD_CHANGED'));

  const consumed = await createStage();
  const consumedPlan = await check(consumed);
  assert.equal((await consumed.safeCommit('commit', '--plan', consumedPlan)).code, 0);
  await initDelivery(consumed);
  assert.equal((await publish(consumed, 'commit-ready', commitReadyDraft(consumed, consumedPlan))).json.code, 'PLAN_CONSUMED');

  const pushSide = await createStage();
  const { planId: pushPlan } = await toPushApproved(pushSide);
  await pushSide.gitEnv('push', '-q', 'origin', 'HEAD:refs/heads/elsewhere');
  await git(pushSide.repo, 'update-ref', 'refs/remotes/origin/feature', await git(pushSide.repo, 'rev-parse', 'HEAD^'));
  assert.equal((await verify(pushSide)).status, 'valid');
  const tracking = await git(pushSide.repo, 'rev-parse', 'refs/remotes/origin/feature');
  await git(pushSide.repo, 'update-ref', 'refs/remotes/origin/feature', await git(pushSide.repo, 'commit-tree', '-p', tracking, '-m', 'remote moved', `${tracking}^{tree}`));
  assert.ok(codes(await verify(pushSide)).includes('UPSTREAM_CHANGED'));
  await git(pushSide.repo, 'update-ref', 'refs/remotes/origin/feature', tracking);
  assert.equal((await verify(pushSide)).status, 'valid');
  void pushPlan;

  const ahead = await createStage();
  const aheadPlan = await check(ahead);
  await initDelivery(ahead);
  ok(await publish(ahead, 'commit-ready', commitReadyDraft(ahead, aheadPlan)));
  ok(await respond(ahead, 1));
  assert.equal((await ahead.safeCommit('commit', '--plan', aheadPlan)).code, 0);
  ok(await publish(ahead, 'commit-result', resultDraft));
  // An unrelated upstream leaves both local commits ahead of it.
  const unrelated = await git(ahead.repo, 'commit-tree', '-m', 'unrelated root', await git(ahead.repo, 'rev-parse', 'HEAD^{tree}'));
  await git(ahead.repo, 'update-ref', 'refs/remotes/origin/feature', unrelated);
  assert.equal((await publish(ahead, 'push-ready', pushReadyDraft())).json.code, 'AHEAD_NOT_SINGLE');
  await git(ahead.repo, 'update-ref', 'refs/remotes/origin/feature', await git(ahead.repo, 'rev-parse', 'HEAD~1'));
  await git(ahead.repo, 'config', 'branch.feature.merge', 'refs/heads/main');
  await git(ahead.repo, 'update-ref', 'refs/remotes/origin/main', await git(ahead.repo, 'rev-parse', 'HEAD~1'));
  assert.equal((await publish(ahead, 'push-ready', pushReadyDraft())).json.code, 'PROTECTED_BRANCH');
  await git(ahead.repo, 'config', 'branch.feature.merge', 'refs/tags/v1');
  assert.equal((await publish(ahead, 'push-ready', pushReadyDraft())).json.code, 'INVALID_TARGET_REF');
  await git(ahead.repo, 'config', 'branch.feature.merge', 'refs/heads/feature');
  ok(await publish(ahead, 'push-ready', pushReadyDraft()));
});

test('push endpoint: pushurl is bound and pushed, changes are stale, unusable endpoints are refused', async () => {
  const stage = await createStage();
  await git(stage.fixture, 'clone', '--bare', '-q', stage.remoteDir('origin'), stage.remoteDir('pushonly'));
  await git(stage.repo, 'config', 'remote.origin.pushurl', stage.url('pushonly'));
  const { planId, commitSha, pushReady } = await toPushApproved(stage);
  assert.equal(pushReady.target.endpointSha256, endpointHash(stage.url('pushonly')));
  const originBefore = await git(stage.remoteDir('origin'), 'rev-parse', 'refs/heads/feature');

  await git(stage.repo, 'config', 'remote.origin.pushurl', stage.url('origin'));
  assert.ok(codes(await verify(stage)).includes('PUSH_ENDPOINT_CHANGED'));
  const refused = await guardedPush(stage, planId, pushReady);
  assert.equal(refused.json.errors[0].code, 'PUSH_ENDPOINT_CHANGED');
  assert.deepEqual((await stage.calls()).filter((call) => call.startsWith('git-receive-pack')), []);
  await git(stage.repo, 'config', 'remote.origin.pushurl', stage.url('pushonly'));
  assert.equal((await verify(stage)).status, 'valid');
  assert.equal((await guardedPush(stage, planId, pushReady)).code, 0);
  assert.equal(await git(stage.remoteDir('pushonly'), 'rev-parse', 'refs/heads/feature'), commitSha);
  assert.equal(await git(stage.remoteDir('origin'), 'rev-parse', 'refs/heads/feature'), originBefore);
  // push-result needs the pushed, reviewed and current endpoint hashes to agree.
  await git(stage.repo, 'config', 'remote.origin.pushurl', stage.url('origin'));
  assert.equal((await publish(stage, 'push-result', resultDraft)).json.code, 'PUSH_ENDPOINT_CHANGED');
  await git(stage.repo, 'config', 'remote.origin.pushurl', stage.url('pushonly'));
  ok(await publish(stage, 'push-result', resultDraft));

  const reviewing = await createStage();
  const planReviewing = await check(reviewing);
  await initDelivery(reviewing);
  ok(await publish(reviewing, 'commit-ready', commitReadyDraft(reviewing, planReviewing)));
  ok(await respond(reviewing, 1));
  assert.equal((await reviewing.safeCommit('commit', '--plan', planReviewing)).code, 0);
  ok(await publish(reviewing, 'commit-result', resultDraft));
  ok(await publish(reviewing, 'push-ready', pushReadyDraft()));
  await git(reviewing.repo, 'config', 'remote.origin.pushurl', reviewing.url('elsewhere'));
  assert.equal((await respond(reviewing, 4)).json.code, 'REQUEST_STALE');
  const endpointCases = [
    [['/srv/local.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['file:///srv/local.git'], 'LOCAL_PUSH_ENDPOINT'],
    [['git://git.example.invalid/x.git'], 'UNSUPPORTED_PUSH_ENDPOINT'],
    [[reviewing.url('a'), reviewing.url('b')], 'MULTIPLE_PUSH_ENDPOINTS'],
  ];
  // A fresh run at push-ready time exercises the endpoint codes directly.
  const fresh = await createStage();
  const freshPlan = await check(fresh);
  await initDelivery(fresh);
  ok(await publish(fresh, 'commit-ready', commitReadyDraft(fresh, freshPlan)));
  ok(await respond(fresh, 1));
  assert.equal((await fresh.safeCommit('commit', '--plan', freshPlan)).code, 0);
  ok(await publish(fresh, 'commit-result', resultDraft));
  for (const [urls, code] of endpointCases) {
    await command(fresh.repo, 'git', ['config', '--unset-all', 'remote.origin.pushurl']);
    for (const url of urls) await git(fresh.repo, 'config', '--add', 'remote.origin.pushurl', url);
    assert.equal((await publish(fresh, 'push-ready', pushReadyDraft())).json.code, code, urls.join(' '));
  }
  await command(fresh.repo, 'git', ['config', '--unset-all', 'remote.origin.pushurl']);
  await git(fresh.repo, 'config', 'branch.feature.remote', '.');
  assert.equal((await publish(fresh, 'push-ready', pushReadyDraft())).json.code, 'NO_PUSH_ENDPOINT');
});

test('B10: a changed or protected target after review makes respond and verify stale', async () => {
  const stage = await createStage();
  const planId = await check(stage);
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  ok(await respond(stage, 1));
  assert.equal((await stage.safeCommit('commit', '--plan', planId)).code, 0);
  ok(await publish(stage, 'commit-result', resultDraft));
  const pushReady = await record(stage, ok(await publish(stage, 'push-ready', pushReadyDraft())).recordPath);
  await git(stage.repo, 'update-ref', 'refs/remotes/origin/other', await git(stage.repo, 'rev-parse', 'HEAD^'));
  await git(stage.repo, 'config', 'branch.feature.merge', 'refs/heads/other');
  assert.equal((await respond(stage, 4)).json.code, 'REQUEST_STALE');
  assert.ok(codes(await verify(stage)).includes('PUSH_TARGET_CHANGED'));
  await git(stage.repo, 'config', 'branch.feature.merge', 'refs/heads/feature');
  ok(await respond(stage, 4));
  await git(stage.repo, 'update-ref', 'refs/remotes/origin/main', await git(stage.repo, 'rev-parse', 'HEAD^'));
  await git(stage.repo, 'config', 'branch.feature.merge', 'refs/heads/main');
  assert.equal((await verify(stage)).status, 'stale');
  assert.equal((await guardedPush(stage, planId, pushReady)).json.errors[0].code, 'PROTECTED_BRANCH');
  assert.deepEqual(await stage.calls(), []);
});

test('B11 and B9: unverified pushes wait for verify-push; failing transports leak nothing', async () => {
  const stage = await createStage();
  const { planId, pushReady } = await toPushApproved(stage);
  const lockFile = path.join(stage.repo, '.git', 'refs', 'remotes', 'origin', 'feature.lock');
  await writeFile(lockFile, '');
  assert.equal((await guardedPush(stage, planId, pushReady)).json.errors[0].code, 'TRACKING_REF_UPDATE_FAILED');
  assert.equal((await verify(stage)).nextGate, 'awaiting_push_verification');
  assert.equal((await publish(stage, 'push-result', resultDraft)).json.code, 'PUSH_NOT_VERIFIED');
  assert.equal((await publish(stage, 'push-ready', pushReadyDraft({ reason: 'push_retry' }))).json.code, 'OUT_OF_ORDER');
  await rm(lockFile);
  assert.equal((await stage.safeCommit('verify-push', '--plan', planId)).code, 0);
  assert.equal((await verify(stage)).nextGate, 'awaiting_push_result');
  ok(await publish(stage, 'push-result', resultDraft));
  assert.equal((await stage.calls()).filter((call) => call.startsWith('git-receive-pack')).length, 1);

  const leaking = await createStage();
  const failingUrl = `ssh://${URL_SENTINEL}.example.invalid/origin.git`;
  await git(leaking.repo, 'remote', 'set-url', 'origin', failingUrl);
  const approved = await toPushApproved(leaking);
  await leaking.setMode('fail-all');
  const failed = await guardedPush(leaking, approved.planId, approved.pushReady);
  assert.equal(failed.json.errors[0].code, 'PUSH_FAILED');
  const failedState = await verify(leaking);
  const verifyText = JSON.stringify(failedState);
  const texts = [failed.stdout, verifyText, await allHandoffText(leaking), await readFile(await planFile(leaking, approved.planId), 'utf8')];
  for (const text of texts) assert.ok(!text.includes(URL_SENTINEL) && !text.includes(CREDENTIAL_SENTINEL), text.slice(0, 200));
  // A failed push keeps its attempt (B1): no push_retry until verify-push shows the remote unchanged.
  assert.equal(failedState.nextGate, 'awaiting_push_verification');
  assert.equal((await publish(leaking, 'push-ready', pushReadyDraft({ reason: 'push_retry' }))).json.code, 'OUT_OF_ORDER');
  await leaking.setMode('');
  assert.equal((await leaking.safeCommit('verify-push', '--plan', approved.planId)).code, 0);
  // B2: the cleared attempt voids the old push review; it never returns to push approval.
  const cleared = await verify(leaking);
  assert.equal(cleared.status, 'stale');
  assert.ok(codes(cleared).includes('PUSH_ATTEMPT_CLEARED'), JSON.stringify(codes(cleared)));
  assert.notEqual(cleared.nextGate, 'awaiting_user_push_approval');
  assert.ok(!cleared.notices.some((notice) => notice.code === 'CODEX_PASS_IS_NOT_APPROVAL'));
  const retry = await record(leaking, ok(await publish(leaking, 'push-ready', pushReadyDraft({ reason: 'push_retry' }))).recordPath);
  assert.equal(retry.plan.clearedAttempts, 1);
  const awaiting = await verify(leaking);
  assert.equal(awaiting.status, 'valid', JSON.stringify(awaiting));
  assert.equal(awaiting.nextGate, 'awaiting_codex_push_review');
  ok(await respond(leaking, 6));
  assert.equal((await verify(leaking)).nextGate, 'awaiting_user_push_approval');
  assert.equal((await guardedPush(leaking, approved.planId, retry)).code, 0);
  ok(await publish(leaking, 'push-result', resultDraft));
  assert.equal((await verify(leaking)).nextGate, 'delivered');
});

test('B5: a message-only commit-ready FAIL is fixed by delivery_fix; refusals and the round limit hold', async () => {
  const stage = await createStage();
  const first = await check(stage, undefined, 'wip');
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, first)));
  const finding = 'D1 commit message does not describe the change';
  ok(await respond(stage, 1, { verdict: 'FAIL', blockingFindings: [finding] }));
  assert.equal((await verify(stage)).nextGate, 'stopped_on_codex_verdict');
  const second = await check(stage, undefined, 'feat: describe the change');
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, second, { reason: 'plan_refresh' }))).json.code, 'OUT_OF_ORDER');
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, second, { reason: 'delivery_fix' }))).json.code, 'INPUT_INVALID');
  const fixed = (round = 1, previous = null) => [{ finding, previousFinding: previous, fixRound: round, resolution: 'Message rewritten.' }];
  const reworded = [{ finding: `${finding}.`, previousFinding: null, fixRound: 1, resolution: 'Message rewritten.' }];
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, second, { reason: 'delivery_fix', priorFindings: reworded }))).json.code, 'INPUT_INVALID');
  await writeFile(path.join(stage.repo, 'src.txt'), 'changed implementation\n');
  const changed = await check(stage, undefined, 'feat: describe the change');
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, changed, { reason: 'delivery_fix', priorFindings: fixed() }))).json.code, 'IMPLEMENTATION_CHANGED');
  await writeFile(path.join(stage.repo, 'src.txt'), 'two\n');
  const third = await check(stage, undefined, 'feat: describe the change');
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, third, { reason: 'delivery_fix', priorFindings: fixed() })));
  assert.equal((await verify(stage)).nextGate, 'awaiting_codex_commit_review');
  ok(await respond(stage, 3, { verdict: 'FAIL', blockingFindings: [finding] }));
  const fourth = await check(stage, undefined, 'feat: describe the change again');
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, fourth, { reason: 'delivery_fix', priorFindings: fixed(2, finding) })));
  ok(await respond(stage, 5, { verdict: 'FAIL', blockingFindings: [finding] }));
  const fifth = await check(stage, undefined, 'feat: describe the change once more');
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, fifth, { reason: 'delivery_fix', priorFindings: fixed(3, finding) }))).json.code, 'INPUT_INVALID');
  const limited = await publish(stage, 'commit-ready', commitReadyDraft(stage, fifth, { reason: 'delivery_fix', priorFindings: fixed(2, finding) }));
  assert.equal(limited.json.code, 'FIX_ROUND_LIMIT', limited.stdout);

  const flow = await createStage();
  const wip = await check(flow, undefined, 'wip');
  await initDelivery(flow);
  ok(await publish(flow, 'commit-ready', commitReadyDraft(flow, wip)));
  ok(await respond(flow, 1, { verdict: 'FAIL', blockingFindings: [finding] }));
  const good = await check(flow, undefined, 'feat: describe the change');
  const fix = await record(flow, ok(await publish(flow, 'commit-ready', commitReadyDraft(flow, good, { reason: 'delivery_fix', priorFindings: fixed() }))).recordPath);
  assert.equal(fix.inheritedReview, null);
  assert.equal(fix.implementation.revision, 1);
  ok(await respond(flow, 3));
  const afterPass = await publish(flow, 'commit-ready', commitReadyDraft(flow, await check(flow, undefined, 'feat: describe the change'), { reason: 'delivery_fix', priorFindings: fixed() }));
  assert.equal(afterPass.json.code, 'OUT_OF_ORDER');
  assert.equal((await flow.safeCommit('commit', '--plan', good)).code, 0);
  ok(await publish(flow, 'commit-result', resultDraft));
  assert.equal((await respond(flow, 5)).json.code, 'OUT_OF_ORDER');
  const pushReady = await record(flow, ok(await publish(flow, 'push-ready', pushReadyDraft())).recordPath);
  ok(await respond(flow, 6));
  assert.equal((await guardedPush(flow, good, pushReady)).code, 0);
  ok(await publish(flow, 'push-result', resultDraft));
  assert.equal((await verify(flow)).nextGate, 'delivered');
});

test('B6: a config-only push-ready FAIL is fixed by push_fix; a changed commit is refused', async () => {
  const stage = await createStage();
  await stage.gitEnv('push', '-q', 'origin', 'feature:refs/heads/review-target');
  await stage.gitEnv('fetch', '-q', 'origin');
  await git(stage.repo, 'config', 'branch.feature.merge', 'refs/heads/review-target');
  const planId = await check(stage);
  await initDelivery(stage);
  ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  ok(await respond(stage, 1));
  assert.equal((await stage.safeCommit('commit', '--plan', planId)).code, 0);
  ok(await publish(stage, 'commit-result', resultDraft));
  const wrong = await record(stage, ok(await publish(stage, 'push-ready', pushReadyDraft())).recordPath);
  assert.equal(wrong.target.targetRef, 'refs/heads/review-target');
  const finding = 'P1 upstream points at the wrong branch';
  ok(await respond(stage, 4, { verdict: 'FAIL', blockingFindings: [finding] }));
  assert.equal((await publish(stage, 'push-ready', pushReadyDraft({ reason: 'push_retry' }))).json.code, 'OUT_OF_ORDER');
  await git(stage.repo, 'config', 'branch.feature.merge', 'refs/heads/feature');
  const priorFindings = [{ finding, previousFinding: null, fixRound: 1, resolution: 'Upstream corrected.' }];
  assert.equal((await publish(stage, 'push-ready', pushReadyDraft({ reason: 'push_fix' }))).json.code, 'INPUT_INVALID');
  const fixed = await record(stage, ok(await publish(stage, 'push-ready', pushReadyDraft({ reason: 'push_fix', priorFindings }))).recordPath);
  assert.equal(fixed.target.targetRef, 'refs/heads/feature');
  ok(await respond(stage, 6));
  assert.equal((await guardedPush(stage, planId, fixed)).code, 0);
  ok(await publish(stage, 'push-result', resultDraft));

  // The push_fix chain has its own two-round limit.
  const rounds = await createStage();
  const roundsPlan = await check(rounds);
  await initDelivery(rounds);
  ok(await publish(rounds, 'commit-ready', commitReadyDraft(rounds, roundsPlan)));
  ok(await respond(rounds, 1));
  assert.equal((await rounds.safeCommit('commit', '--plan', roundsPlan)).code, 0);
  ok(await publish(rounds, 'commit-result', resultDraft));
  ok(await publish(rounds, 'push-ready', pushReadyDraft()));
  ok(await respond(rounds, 4, { verdict: 'FAIL', blockingFindings: [finding] }));
  const pushFix = (round, previous) => pushReadyDraft({ reason: 'push_fix', priorFindings: [{ finding, previousFinding: previous, fixRound: round, resolution: 'Retried.' }] });
  ok(await publish(rounds, 'push-ready', pushFix(1, null)));
  ok(await respond(rounds, 6, { verdict: 'FAIL', blockingFindings: [finding] }));
  ok(await publish(rounds, 'push-ready', pushFix(2, finding)));
  ok(await respond(rounds, 8, { verdict: 'FAIL', blockingFindings: [finding] }));
  assert.equal((await publish(rounds, 'push-ready', pushFix(2, finding))).json.code, 'FIX_ROUND_LIMIT');

  const changed = await createStage();
  const changedPlan = await check(changed);
  await initDelivery(changed);
  ok(await publish(changed, 'commit-ready', commitReadyDraft(changed, changedPlan)));
  ok(await respond(changed, 1));
  assert.equal((await changed.safeCommit('commit', '--plan', changedPlan)).code, 0);
  ok(await publish(changed, 'commit-result', resultDraft));
  ok(await publish(changed, 'push-ready', pushReadyDraft()));
  ok(await respond(changed, 4, { verdict: 'BLOCKED', blockingFindings: [finding] }));
  await git(changed.repo, 'commit', '-q', '--allow-empty', '-m', 'unreviewed');
  const refused = await publish(changed, 'push-ready', pushReadyDraft({ reason: 'push_fix', priorFindings: [{ finding, previousFinding: null, fixRound: 1, resolution: 'x' }] }));
  assert.equal(refused.json.code, 'COMMIT_CHANGED');
});

test('Q1: plan_refresh inherits only a direct PASS with an identical fingerprint', async () => {
  const stage = await createStage();
  const first = await check(stage);
  await initDelivery(stage);
  const original = ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, first)));
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, await check(stage), { reason: 'plan_refresh' }))).json.code, 'OUT_OF_ORDER');
  ok(await respond(stage, 1));
  const expire = (id) => editPlan(stage, id, (plan) => { plan.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  await expire(first);
  const second = await check(stage);
  const inherited = await record(stage, ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, second, { reason: 'plan_refresh' }))).recordPath);
  assert.deepEqual(inherited.inheritedReview, {
    record: original.recordPath.split('/runs/')[1].split('/').slice(1).join('/'),
    responseSha256: inherited.inheritedReview.responseSha256,
    fingerprint: inherited.reviewFingerprint,
  });
  assert.equal(inherited.reviewFingerprint, (await record(stage, original.recordPath)).reviewFingerprint);
  let state = await verify(stage);
  assert.equal(state.nextGate, 'awaiting_user_commit_approval');
  assert.ok(state.notices.some((notice) => notice.code === 'CODEX_PASS_IS_NOT_APPROVAL'));
  await expire(second);
  const third = await check(stage);
  const again = await record(stage, ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, third, { reason: 'plan_refresh' }))).recordPath);
  assert.equal(again.inheritedReview.record, inherited.inheritedReview.record);
  await expire(third);
  const differentMessage = await check(stage, undefined, 'feat: a different message');
  const notInherited = await record(stage, ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, differentMessage, { reason: 'plan_refresh' }))).recordPath);
  assert.equal(notInherited.inheritedReview, null);
  state = await verify(stage);
  assert.equal(state.nextGate, 'awaiting_codex_commit_review');
  assert.equal((await publish(stage, 'commit-result', resultDraft)).json.code, 'OUT_OF_ORDER');

  // A delivery_fix never inherits, even when an earlier direct PASS has the same fingerprint.
  const fixStage = await createStage();
  const passed = await check(fixStage);
  await initDelivery(fixStage);
  const passedRecord = await record(fixStage, ok(await publish(fixStage, 'commit-ready', commitReadyDraft(fixStage, passed))).recordPath);
  ok(await respond(fixStage, 1));
  await editPlan(fixStage, passed, (plan) => { plan.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  ok(await publish(fixStage, 'commit-ready', commitReadyDraft(fixStage, await check(fixStage, undefined, 'feat: other words'), { reason: 'plan_refresh' })));
  ok(await respond(fixStage, 3, { verdict: 'FAIL', blockingFindings: ['M1 wording'] }));
  const fixRecord = await record(fixStage, ok(await publish(fixStage, 'commit-ready', commitReadyDraft(fixStage, await check(fixStage), {
    reason: 'delivery_fix',
    priorFindings: [{ finding: 'M1 wording', previousFinding: null, fixRound: 1, resolution: 'Original message restored.' }],
  }))).recordPath);
  assert.equal(fixRecord.reviewFingerprint, passedRecord.reviewFingerprint);
  assert.equal(fixRecord.inheritedReview, null);
  assert.equal((await verify(fixStage)).nextGate, 'awaiting_codex_commit_review');
  assert.equal((await publish(fixStage, 'commit-result', resultDraft)).json.code, 'OUT_OF_ORDER');

  const failedStage = await createStage();
  const failedFirst = await check(failedStage);
  await initDelivery(failedStage);
  ok(await publish(failedStage, 'commit-ready', commitReadyDraft(failedStage, failedFirst)));
  ok(await respond(failedStage, 1, { verdict: 'BLOCKED', blockingFindings: ['X1 blocked'] }));
  await editPlan(failedStage, failedFirst, (plan) => { plan.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  assert.equal((await publish(failedStage, 'commit-ready', commitReadyDraft(failedStage, await check(failedStage), { reason: 'plan_refresh' }))).json.code, 'OUT_OF_ORDER');
});

test('Q1 fingerprint covers every reviewed component and ignores plan identity and timing', () => {
  assert.deepEqual(FINGERPRINT_KEYS, [
    'branch', 'head', 'policyHash', 'policySha256', 'files', 'manifest', 'ignoredFiles', 'commitMessage',
    'changedFilesDigest', 'closure', 'implementationRequestSha256', 'implementationResponseSha256',
  ]);
  const base = Object.fromEntries(FINGERPRINT_KEYS.map((key) => [key, `value-${key}`]));
  const hash = reviewFingerprint(base);
  for (const key of FINGERPRINT_KEYS) assert.notEqual(reviewFingerprint({ ...base, [key]: 'changed' }), hash, key);
  assert.equal(reviewFingerprint({ ...base, planId: 'x', createdAt: 'y', expiresAt: 'z', state: 'committed' }), hash);
});

test('a published record is never overwritten', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'delivery-immutable-'));
  temporaryPaths.push(dir);
  await publishImmutable(dir, '0001-commit-ready.json', Buffer.from('first\n'), 'RECORD_EXISTS');
  await assert.rejects(
    publishImmutable(dir, '0001-commit-ready.json', Buffer.from('second\n'), 'RECORD_EXISTS'),
    (error) => error.code === 'RECORD_EXISTS',
  );
  assert.equal(await readFile(path.join(dir, '0001-commit-ready.json'), 'utf8'), 'first\n');
  assert.deepEqual(await readdir(dir), ['0001-commit-ready.json']);
});

test('ordering, sensitive data, interrupted writes, immutability and channel isolation', async () => {
  const stage = await createStage();
  const planId = await check(stage);
  await initDelivery(stage);
  assert.equal((await publish(stage, 'commit-result', resultDraft)).json.code, 'OUT_OF_ORDER');
  assert.equal((await publish(stage, 'push-ready', pushReadyDraft())).json.code, 'OUT_OF_ORDER');
  // A reserved .invalid domain outside the scan's example.* allow list stands in for a real address.
  const sensitive = await check(stage, undefined, 'feat: contact owner@sentinel-mail.invalid');
  assert.equal((await publish(stage, 'commit-ready', commitReadyDraft(stage, sensitive))).json.code, 'SENSITIVE_DATA');
  const ready = ok(await publish(stage, 'commit-ready', commitReadyDraft(stage, planId)));
  const readyBytes = await readFile(path.join(stage.repo, ready.recordPath));
  assert.equal((await publish(stage, 'commit-result', resultDraft)).json.code, 'OUT_OF_ORDER');
  assert.equal((await respond(stage, 2)).json.code, 'NOT_CURRENT_REVISION');
  assert.equal((await respond(stage, 1, { checksPerformed: ['token=sentinel-token-value'] })).json.code, 'SENSITIVE_DATA');

  const runDir = path.join(stage.repo, ready.runDir);
  const temporary = path.join(runDir, 'records', '.tmp-deadbeef');
  await writeFile(temporary, 'partial');
  assert.ok(codes(await verify(stage)).includes('ORPHAN_TEMP_FILE'));
  assert.equal((await respond(stage, 1)).json.code, 'HANDOFF_NOT_VALID');
  await unlink(temporary);
  await mkdir(path.join(runDir, '.lock'));
  assert.ok(codes(await verify(stage)).includes('LOCK_PRESENT'));
  assert.equal((await respond(stage, 1)).json.code, 'LOCKED');
  await rm(path.join(runDir, '.lock'), { recursive: true });
  await writeFile(path.join(runDir, 'records', '0002-codex-commit-review.json'), '{}');
  assert.ok(codes(await verify(stage)).includes('UNINDEXED_RECORD'));
  assert.equal((await respond(stage, 1)).json.code, 'HANDOFF_NOT_VALID');
  await unlink(path.join(runDir, 'records', '0002-codex-commit-review.json'));
  ok(await respond(stage, 1));
  assert.deepEqual(await readFile(path.join(stage.repo, ready.recordPath)), readyBytes);
  assert.equal((await respond(stage, 2)).json.code, 'OUT_OF_ORDER');

  const implementation = await stage.handoff('verify', '--stage', 'T1');
  assert.equal(implementation.json.channel, 'implementation');
  assert.ok(!codes(implementation.json).includes('UNEXPECTED_ENTRY'));
  const contract = await stage.handoff('verify', '--stage', 'T1', '--channel', 'contract');
  assert.deepEqual(codes(contract.json), ['MISSING']);
  const bad = await stage.handoff('publish', '--stage', 'T1', '--kind', 'commit-ready', '--input', await draftFile({}));
  assert.equal(bad.json.code, 'USAGE');

  const unignored = await createStage();
  await writeFile(path.join(unignored.repo, '.gitignore'), '');
  assert.equal((await unignored.handoff('init', '--stage', 'T1', '--channel', 'delivery')).json.code, 'NOT_IGNORED');
});