#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const VERSION = 1;
const DEFAULT_POLICY = Object.freeze({
  protectedBranches: ['main', 'master', 'trunk'],
  denyPatterns: [
    '.git/**',
    '**/.env',
    '**/.env.*',
    '**/*.pem',
    '**/*.key',
    '**/credentials.*',
    '**/secrets/**',
    'node_modules/**',
  ],
  allowPush: false,
  requireCleanIndex: true,
  planTtlMinutes: 15,
});

export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  GIT_CONTEXT: 3,
  REQUEST_INVALID: 4,
  POLICY_DENIED: 5,
  DIRTY_INDEX: 6,
  NO_CHANGES: 7,
  PLAN_NOT_FOUND: 8,
  PLAN_EXPIRED: 9,
  PLAN_STALE: 10,
  PLAN_CONSUMED: 11,
  LOCKED: 12,
  COMMIT_FAILED: 13,
  PUSH_DENIED: 14,
  PUSH_FAILED: 15,
  INTERNAL: 16,
});

class SafeCommitError extends Error {
  constructor(code, kind, message, details = undefined) {
    super(message);
    this.name = 'SafeCommitError';
    this.exitCode = code;
    this.kind = kind;
    this.details = details;
  }
}

function fail(exitCode, kind, message, details) {
  throw new SafeCommitError(exitCode, kind, message, details);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSlashes(value) {
  return value.split(path.sep).join('/');
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      code: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

async function git(repoRoot, args, options = {}) {
  const result = await run('git', ['-c', 'core.quotepath=false', ...args], { cwd: repoRoot });
  if (!options.allowFailure && result.code !== 0) {
    fail(
      options.exitCode ?? EXIT.GIT_CONTEXT,
      options.kind ?? 'GIT_COMMAND_FAILED',
      options.message ?? `git ${args[0]} failed`,
      { stderr: result.stderr.toString('utf8').trim(), gitExitCode: result.code },
    );
  }
  return options.buffer ? result.stdout : result.stdout.toString('utf8').trim();
}

function parseArgs(argv) {
  const action = argv[0];
  if (!['check', 'inspect', 'commit', 'push'].includes(action)) {
    fail(EXIT.USAGE, 'USAGE', 'Expected one of: check, inspect, commit, push');
  }
  const options = { action, json: false, push: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--push' && action === 'commit') options.push = true;
    else if (arg === '--request' && action === 'check' && argv[index + 1]) options.request = argv[++index];
    else if (arg === '--plan' && action !== 'check' && argv[index + 1]) options.planId = argv[++index];
    else fail(EXIT.USAGE, 'USAGE', `Unknown or incomplete option: ${arg}`);
  }
  if (action === 'check' && !options.request) fail(EXIT.USAGE, 'USAGE', 'check requires --request <file>');
  if (action !== 'check' && !options.planId) fail(EXIT.USAGE, 'USAGE', `${action} requires --plan <plan-id>`);
  return options;
}

async function discoverRepo() {
  const rootResult = await run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (rootResult.code !== 0) fail(EXIT.GIT_CONTEXT, 'NOT_A_REPOSITORY', 'Current directory is not inside a Git worktree');
  const root = rootResult.stdout.toString('utf8').trim();
  const [rootReal, commonRaw, gitDirRaw] = await Promise.all([
    realpath(root),
    git(root, ['rev-parse', '--git-common-dir']),
    git(root, ['rev-parse', '--git-dir']),
  ]);
  const commonDir = await realpath(path.resolve(root, commonRaw));
  const gitDir = await realpath(path.resolve(root, gitDirRaw));
  const stateRaw = await git(root, ['rev-parse', '--git-path', 'safe-commit']);
  const stateDir = path.resolve(root, stateRaw);
  return { root, rootReal, commonDir, gitDir, stateDir, worktreeId: sha256(rootReal).slice(0, 24) };
}

async function ensureGitHookSupport(repo) {
  const env = { ...process.env, LC_ALL: 'C' };
  const result = await run('git', ['hook', '-h'], { cwd: repo.root, env });
  const help = Buffer.concat([result.stdout, result.stderr]).toString('utf8');
  if (!help.includes('git hook run')) {
    fail(EXIT.GIT_CONTEXT, 'UNSUPPORTED_GIT', 'Git 2.36 or newer with git hook run support is required');
  }
}

function validateString(value, field, { allowNewlines = false } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `${field} must be a non-empty string`);
  }
  const forbidden = allowNewlines ? /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\0-\u001f\u007f]/u;
  if (forbidden.test(value)) fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `${field} contains control characters`);
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', 'Request must be a JSON object');
  }
  const allowed = new Set(['schemaVersion', 'producer', 'taskId', 'files', 'commitMessage', 'metadata']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `Unknown request field(s): ${unknown.join(', ')}`);
  if (value.schemaVersion !== VERSION) fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `schemaVersion must be ${VERSION}`);
  validateString(value.producer, 'producer');
  validateString(value.taskId, 'taskId');
  validateString(value.commitMessage, 'commitMessage', { allowNewlines: true });
  if (!Array.isArray(value.files) || value.files.length === 0) {
    fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', 'files must be a non-empty array');
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata))) {
    fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', 'metadata must be an object when provided');
  }
  const seen = new Set();
  for (const file of value.files) {
    validateString(file, 'files[]');
    if (file.includes('\\')) fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `Path must use forward slashes: ${file}`);
    if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file)) {
      fail(EXIT.REQUEST_INVALID, 'PATH_ABSOLUTE', `Absolute path is not allowed: ${file}`);
    }
    const parts = file.split('/');
    if (parts.some((part) => part === '..')) fail(EXIT.REQUEST_INVALID, 'PATH_ESCAPE', `Parent traversal is not allowed: ${file}`);
    if (parts.some((part) => part === '' || part === '.')) fail(EXIT.REQUEST_INVALID, 'PATH_INVALID', `Path is not normalized: ${file}`);
    if (seen.has(file)) fail(EXIT.REQUEST_INVALID, 'DUPLICATE_PATH', `Duplicate path: ${file}`);
    seen.add(file);
  }
  return {
    schemaVersion: VERSION,
    producer: value.producer,
    taskId: value.taskId,
    files: [...value.files],
    commitMessage: value.commitMessage,
    metadata: value.metadata ?? {},
  };
}

function globRegex(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}

async function loadPolicy(repo) {
  const file = path.join(repo.root, '.safe-commit.json');
  let configured = {};
  try {
    configured = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', `Cannot read .safe-commit.json: ${error.message}`);
  }
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', '.safe-commit.json must be an object');
  }
  const allowed = new Set(Object.keys(DEFAULT_POLICY));
  const unknown = Object.keys(configured).filter((key) => !allowed.has(key));
  if (unknown.length) fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', `Unknown policy field(s): ${unknown.join(', ')}`);
  const policy = { ...DEFAULT_POLICY, ...configured };
  if (!Array.isArray(policy.protectedBranches) || policy.protectedBranches.some((item) => typeof item !== 'string' || !item)) {
    fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', 'protectedBranches must contain non-empty strings');
  }
  if (!Array.isArray(policy.denyPatterns) || policy.denyPatterns.some((item) => typeof item !== 'string' || !item)) {
    fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', 'denyPatterns must contain non-empty strings');
  }
  if (typeof policy.allowPush !== 'boolean') fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', 'allowPush must be boolean');
  if (policy.requireCleanIndex !== true) {
    fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', 'safe-commit v1 requires requireCleanIndex=true');
  }
  if (!Number.isInteger(policy.planTtlMinutes) || policy.planTtlMinutes < 1 || policy.planTtlMinutes > 1440) {
    fail(EXIT.POLICY_DENIED, 'POLICY_INVALID', 'planTtlMinutes must be an integer from 1 to 1440');
  }
  return { policy, hash: sha256(stableJson(policy)) };
}

async function assertSafePath(repo, relativePath) {
  const absolute = path.resolve(repo.rootReal, ...relativePath.split('/'));
  if (!isWithin(repo.rootReal, absolute)) fail(EXIT.REQUEST_INVALID, 'PATH_ESCAPE', `Path escapes repository: ${relativePath}`);
  let cursor = absolute;
  let info;
  while (true) {
    try {
      info = await lstat(cursor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
  if (cursor === absolute && info.isDirectory()) {
    fail(EXIT.REQUEST_INVALID, 'PATH_IS_DIRECTORY', `Request paths must name files, not directories: ${relativePath}`);
  }
  let resolved;
  try {
    resolved = await realpath(cursor);
  } catch (error) {
    if (error.code !== 'ENOENT' || !info.isSymbolicLink()) throw error;
    let target = path.resolve(path.dirname(cursor), await readlink(cursor));
    if (!isWithin(repo.rootReal, target)) {
      fail(EXIT.REQUEST_INVALID, 'SYMLINK_ESCAPE', `Path resolves outside repository: ${relativePath}`);
    }
    while (true) {
      try {
        await lstat(target);
        break;
      } catch (targetError) {
        if (targetError.code !== 'ENOENT') throw targetError;
        const parent = path.dirname(target);
        if (parent === target) throw targetError;
        target = parent;
      }
    }
    resolved = await realpath(target);
  }
  if (!isWithin(repo.rootReal, resolved)) {
    fail(EXIT.REQUEST_INVALID, 'SYMLINK_ESCAPE', `Path resolves outside repository: ${relativePath}`);
  }
}

function assertAllowedByPolicy(files, policy) {
  const matchers = policy.denyPatterns.map((pattern) => [pattern, globRegex(pattern)]);
  for (const file of files) {
    const denied = matchers.find(([, matcher]) => matcher.test(file));
    if (denied) fail(EXIT.POLICY_DENIED, 'PATH_DENIED', `Path is denied by policy pattern ${denied[0]}: ${file}`);
  }
}

function parseStatus(buffer) {
  const tokens = buffer.toString('utf8').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const entry = { status, path: normalizeSlashes(record.slice(3)) };
    if (/[RC]/u.test(status)) entry.originalPath = normalizeSlashes(tokens[++index]);
    entries.push(entry);
  }
  return entries;
}

async function statusEntries(repo) {
  const output = await git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { buffer: true });
  return parseStatus(output);
}

function statusMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const paths = entry.originalPath ? [entry.path, entry.originalPath] : [entry.path];
    for (const item of paths) {
      const values = map.get(item) ?? [];
      values.push(entry.status);
      map.set(item, values);
    }
  }
  return map;
}

async function ensureCleanIndex(repo) {
  const result = await run('git', ['diff', '--cached', '--quiet', '--exit-code'], { cwd: repo.root });
  if (result.code === 1) fail(EXIT.DIRTY_INDEX, 'DIRTY_INDEX', 'Git index must be empty before check or commit');
  if (result.code !== 0) fail(EXIT.GIT_CONTEXT, 'GIT_COMMAND_FAILED', 'Unable to inspect Git index');
}

async function currentIdentity(repo) {
  const [head, branch] = await Promise.all([
    git(repo.root, ['rev-parse', 'HEAD'], { message: 'Repository must have an initial commit' }),
    git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }),
  ]);
  if (!branch) fail(EXIT.GIT_CONTEXT, 'DETACHED_HEAD', 'Detached HEAD is not supported');
  return { head, branch };
}

async function fingerprintFile(repo, relativePath, status) {
  const diff = await git(repo.root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', relativePath], { buffer: true });
  const absolute = path.resolve(repo.root, ...relativePath.split('/'));
  let working = 'missing';
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) working = `symlink:${await readlink(absolute)}`;
    else if (info.isFile()) {
      const hashed = await git(repo.root, ['hash-object', '--no-filters', '--', relativePath]);
      working = `file:${info.mode & 0o7777}:${hashed}`;
    } else working = `other:${info.mode}`;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return sha256(Buffer.concat([Buffer.from(`${status}\0${working}\0`, 'utf8'), diff]));
}

async function readIndexEntry(repo, relativePath) {
  const output = await git(repo.root, ['ls-files', '--stage', '-z', '--', relativePath], { buffer: true });
  const record = output.toString('utf8').split('\0').find(Boolean);
  if (!record) return null;
  const match = /^(\d+) ([a-f0-9]+) 0\t/iu.exec(record);
  if (!match) fail(EXIT.GIT_CONTEXT, 'INDEX_INVALID', `Cannot parse index entry for ${relativePath}`);
  return { path: relativePath, mode: match[1], hash: match[2] };
}

async function expectedIndexEntries(repo, files) {
  const fileMode = await git(repo.root, ['config', '--bool', '--get', 'core.fileMode'], { allowFailure: true });
  const entries = [];
  for (const relativePath of files) {
    const absolute = path.resolve(repo.root, ...relativePath.split('/'));
    let info;
    try { info = await lstat(absolute); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const existing = await readIndexEntry(repo, relativePath);
    let mode;
    if (info.isSymbolicLink()) mode = '120000';
    else if (fileMode === 'false') mode = existing ? existing.mode : '100644';
    else mode = info.mode & 0o111 ? '100755' : '100644';
    const hash = await git(repo.root, ['hash-object', `--path=${relativePath}`, '--', relativePath]);
    entries.push({ path: relativePath, mode, hash });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function actualIndexEntries(repo, files) {
  const entries = [];
  for (const relativePath of files) {
    const entry = await readIndexEntry(repo, relativePath);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectState(repo, files) {
  const entries = await statusEntries(repo);
  const byPath = statusMap(entries);
  const fileSet = new Set(files);
  const state = [];
  for (const file of files) {
    const statuses = byPath.get(file);
    if (!statuses?.length) {
      const ignored = await run('git', ['check-ignore', '--quiet', '--', file], { cwd: repo.root });
      if (ignored.code === 0) fail(EXIT.NO_CHANGES, 'FILE_IGNORED', `Requested file is ignored by Git: ${file}`);
      if (ignored.code > 1) fail(EXIT.GIT_CONTEXT, 'GIT_COMMAND_FAILED', `Unable to check whether Git ignores ${file}`);
      fail(EXIT.NO_CHANGES, 'FILE_UNCHANGED', `Requested file has no Git change: ${file}`);
    }
    const status = [...new Set(statuses)].sort().join(',');
    state.push({ path: file, status, hash: await fingerprintFile(repo, file, status) });
  }
  const ignoredFiles = [];
  for (const entry of entries) {
    for (const item of entry.originalPath ? [entry.originalPath, entry.path] : [entry.path]) {
      if (!fileSet.has(item) && !ignoredFiles.some((value) => value.path === item)) {
        ignoredFiles.push({ path: item, status: entry.status });
      }
    }
  }
  ignoredFiles.sort((a, b) => a.path.localeCompare(b.path));
  return { files: state, ignoredFiles };
}

async function ensureStateDirs(repo) {
  await mkdir(path.join(repo.stateDir, 'plans'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(repo.stateDir, 'locks'), { recursive: true, mode: 0o700 });
}

function planPath(repo, planId) {
  if (!/^[a-f0-9]{64}$/u.test(planId ?? '')) fail(EXIT.PLAN_NOT_FOUND, 'PLAN_NOT_FOUND', 'Invalid plan id');
  return path.join(repo.stateDir, 'plans', `${planId}.json`);
}

async function savePlan(repo, plan, { exclusive = false } = {}) {
  await ensureStateDirs(repo);
  const target = planPath(repo, plan.id);
  if (exclusive) {
    const handle = await open(target, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`, 'utf8'); } finally { await handle.close(); }
    return;
  }
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function loadPlan(repo, planId) {
  try {
    const plan = JSON.parse(await readFile(planPath(repo, planId), 'utf8'));
    if (plan.version !== VERSION || plan.id !== planId) fail(EXIT.PLAN_NOT_FOUND, 'PLAN_INVALID', 'Plan data is invalid');
    return plan;
  } catch (error) {
    if (error instanceof SafeCommitError) throw error;
    if (error.code === 'ENOENT' || error instanceof SyntaxError) fail(EXIT.PLAN_NOT_FOUND, 'PLAN_NOT_FOUND', `Plan not found: ${planId}`);
    throw error;
  }
}

function baseOutput(action, plan = undefined) {
  return {
    ok: true,
    action,
    producer: plan?.request?.producer ?? null,
    taskId: plan?.request?.taskId ?? null,
    planId: plan?.id ?? null,
    branch: plan?.branch ?? null,
    files: plan?.files ?? [],
    ignoredFiles: plan?.ignoredFiles ?? [],
    commitMessage: plan?.request?.commitMessage ?? null,
    commitSha: plan?.commitSha ?? null,
    pushed: plan?.pushed ?? false,
    expiresAt: plan?.expiresAt ?? null,
    state: plan?.state ?? null,
    errors: [],
  };
}

async function check(repo, options) {
  let raw;
  try { raw = JSON.parse(await readFile(path.resolve(options.request), 'utf8')); }
  catch (error) { fail(EXIT.REQUEST_INVALID, 'REQUEST_INVALID', `Cannot read request JSON: ${error.message}`); }
  const request = validateRequest(raw);
  const { policy, hash: policyHash } = await loadPolicy(repo);
  const identity = await currentIdentity(repo);
  if (policy.protectedBranches.includes(identity.branch)) {
    fail(EXIT.POLICY_DENIED, 'PROTECTED_BRANCH', `Direct commits to protected branch ${identity.branch} are denied`);
  }
  await ensureCleanIndex(repo);
  assertAllowedByPolicy(request.files, policy);
  for (const file of request.files) await assertSafePath(repo, file);
  const snapshot = await collectState(repo, request.files);
  const indexEntries = await expectedIndexEntries(repo, request.files);
  const now = Date.now();
  const plan = {
    version: VERSION,
    id: randomBytes(32).toString('hex'),
    state: 'ready',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + policy.planTtlMinutes * 60_000).toISOString(),
    repo: { commonDir: repo.commonDir, worktree: repo.rootReal, gitDir: repo.gitDir },
    head: identity.head,
    branch: identity.branch,
    policyHash,
    request,
    files: snapshot.files,
    indexEntries,
    ignoredFiles: snapshot.ignoredFiles,
    commitSha: null,
    pushed: false,
  };
  await savePlan(repo, plan, { exclusive: true });
  return baseOutput('check', plan);
}

function ensureUsablePlan(repo, plan) {
  if (plan.repo.commonDir !== repo.commonDir || plan.repo.worktree !== repo.rootReal || plan.repo.gitDir !== repo.gitDir) {
    fail(EXIT.PLAN_STALE, 'PLAN_REPOSITORY_CHANGED', 'Plan belongs to a different repository or worktree');
  }
  if (plan.state !== 'ready') fail(EXIT.PLAN_CONSUMED, 'PLAN_CONSUMED', `Plan is already ${plan.state}`);
  if (Date.now() > Date.parse(plan.expiresAt)) fail(EXIT.PLAN_EXPIRED, 'PLAN_EXPIRED', 'Plan has expired; run check again');
}

async function verifyPlan(repo, plan) {
  ensureUsablePlan(repo, plan);
  const [{ policy, hash: policyHash }, identity] = await Promise.all([loadPolicy(repo), currentIdentity(repo)]);
  if (policyHash !== plan.policyHash) fail(EXIT.PLAN_STALE, 'POLICY_CHANGED', 'Repository policy changed; run check again');
  if (identity.head !== plan.head) fail(EXIT.PLAN_STALE, 'HEAD_CHANGED', 'HEAD changed; run check again');
  if (identity.branch !== plan.branch) fail(EXIT.PLAN_STALE, 'BRANCH_CHANGED', 'Branch changed; run check again');
  if (policy.protectedBranches.includes(identity.branch)) fail(EXIT.POLICY_DENIED, 'PROTECTED_BRANCH', `Branch ${identity.branch} is protected`);
  await ensureCleanIndex(repo);
  assertAllowedByPolicy(plan.request.files, policy);
  for (const file of plan.request.files) await assertSafePath(repo, file);
  const snapshot = await collectState(repo, plan.request.files);
  if (stableJson(snapshot.files) !== stableJson(plan.files)) {
    fail(EXIT.PLAN_STALE, 'FILES_CHANGED', 'Requested files changed after check; run check again');
  }
  const indexEntries = await expectedIndexEntries(repo, plan.request.files);
  if (!Array.isArray(plan.indexEntries) || stableJson(indexEntries) !== stableJson(plan.indexEntries)) {
    fail(EXIT.PLAN_STALE, 'STAGED_CONTENT_CHANGED', 'The content Git would stage changed after check; run check again');
  }
  return policy;
}

async function acquireLock(repo, ttlMinutes) {
  await ensureStateDirs(repo);
  const lockDir = path.join(repo.stateDir, 'locks', repo.worktreeId);
  const ownerFile = path.join(lockDir, 'owner.json');
  const token = randomBytes(16).toString('hex');
  try {
    await mkdir(lockDir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = {};
    let age = 0;
    try {
      owner = JSON.parse(await readFile(ownerFile, 'utf8'));
      age = Date.now() - (await stat(lockDir)).mtimeMs;
    } catch { /* malformed lock remains active until it is old */ }
    let alive = Number.isInteger(owner.pid);
    if (alive) {
      try { process.kill(owner.pid, 0); } catch (killError) { alive = killError.code === 'EPERM'; }
    }
    if (alive || age <= ttlMinutes * 60_000) fail(EXIT.LOCKED, 'LOCKED', 'Another safe-commit operation holds this worktree lock');
    const staleDir = `${lockDir}.stale.${process.pid}.${token}`;
    try { await rename(lockDir, staleDir); }
    catch { fail(EXIT.LOCKED, 'LOCKED', 'Another safe-commit operation changed the worktree lock'); }
    try { await mkdir(lockDir, { mode: 0o700 }); }
    catch {
      await rm(staleDir, { recursive: true, force: true });
      fail(EXIT.LOCKED, 'LOCKED', 'Another safe-commit operation acquired the worktree lock');
    }
    await rm(staleDir, { recursive: true, force: true });
  }
  await writeFile(ownerFile, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), { mode: 0o600 });
  return async () => {
    try {
      const owner = JSON.parse(await readFile(ownerFile, 'utf8'));
      if (owner.token === token) await rm(lockDir, { recursive: true, force: true });
    } catch { /* another process owns or removed it */ }
  };
}

async function stagedPaths(repo) {
  const output = await git(repo.root, ['diff', '--cached', '--name-status', '--no-renames', '-z'], { buffer: true });
  const tokens = output.toString('utf8').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const files = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) files.push(normalizeSlashes(tokens[index + 1]));
  return files.sort();
}

async function assertIndexMatchesPlan(repo, plan) {
  const actualPaths = await stagedPaths(repo);
  const expectedPaths = [...plan.request.files].sort();
  if (stableJson(actualPaths) !== stableJson(expectedPaths)) {
    fail(EXIT.PLAN_STALE, 'STAGED_SET_MISMATCH', 'Staged paths do not exactly match the plan', { expectedPaths, actualPaths });
  }
  const actualEntries = await actualIndexEntries(repo, plan.request.files);
  if (stableJson(actualEntries) !== stableJson(plan.indexEntries)) {
    fail(EXIT.PLAN_STALE, 'STAGED_CONTENT_MISMATCH', 'Staged content does not exactly match the reviewed plan', {
      expectedEntries: plan.indexEntries,
      actualEntries,
    });
  }
}

async function resolveHooksDir(repo) {
  const configured = await git(repo.root, ['config', '--path', '--get', 'core.hooksPath'], { allowFailure: true });
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(repo.root, configured);
  return path.resolve(repo.root, await git(repo.root, ['rev-parse', '--git-path', 'hooks']));
}

function verifiedHookSource(originalHooksDir, hookName, approvedTree) {
  const hookConfig = `core.hooksPath=${originalHooksDir}`;
  return `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const original = spawnSync(
  'git',
  ['-c', ${JSON.stringify(hookConfig)}, 'hook', 'run', '--ignore-missing', ${JSON.stringify(hookName)}, '--', ...process.argv.slice(2)],
  { shell: false, stdio: 'inherit', windowsHide: true },
);
if (original.error) {
  console.error('safe-commit: could not run original ${hookName} hook:', original.error.message);
  process.exit(1);
}
if (original.status !== 0) process.exit(original.status ?? 1);

const tree = spawnSync('git', ['write-tree'], {
  encoding: 'utf8',
  shell: false,
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
if (tree.error || tree.status !== 0) {
  console.error('safe-commit: could not verify the index after Git hooks');
  process.exit(1);
}
if (tree.stdout.trim() !== ${JSON.stringify(approvedTree)}) {
  console.error('SAFE_COMMIT_INDEX_CHANGED: a Git hook changed the reviewed index; run check again');
  process.exit(1);
}
`;
}

async function createVerifiedHooks(repo, approvedTree) {
  const originalHooksDir = await resolveHooksDir(repo);
  const directory = path.join(repo.stateDir, 'hook-runs', `${repo.worktreeId}.${process.pid}.${randomBytes(12).toString('hex')}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const hookName of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
    const hookFile = path.join(directory, hookName);
    await writeFile(hookFile, verifiedHookSource(originalHooksDir, hookName, approvedTree), { mode: 0o700 });
    await chmod(hookFile, 0o700);
  }
  return {
    directory,
    cleanup: async () => { await rm(directory, { recursive: true, force: true }); },
  };
}

async function cleanupStaging(repo) {
  // v1 requires an empty index before acquiring the lock, so every staged entry
  // observed after a failed operation was introduced during this operation.
  await run('git', ['reset', '--quiet'], { cwd: repo.root });
}

async function verifyCommittedTree(repo, plan, commitSha = plan.commitSha) {
  const objectId = /^[a-f0-9]{40,64}$/u;
  if (!objectId.test(commitSha ?? '') || !objectId.test(plan.approvedTree ?? '')) {
    fail(EXIT.COMMIT_FAILED, 'COMMIT_TREE_MISMATCH', 'Committed plan lacks a valid commit or approved tree; push is blocked', {
      commitSha: commitSha ?? null,
      expectedTree: plan.approvedTree ?? null,
      actualTree: null,
    });
  }
  const committedTree = await git(repo.root, ['rev-parse', `${commitSha}^{tree}`], { allowFailure: true });
  if (committedTree !== plan.approvedTree) {
    fail(EXIT.COMMIT_FAILED, 'COMMIT_TREE_MISMATCH', 'Commit tree does not match the approved tree; push is blocked', {
      commitSha,
      expectedTree: plan.approvedTree,
      actualTree: committedTree || null,
    });
  }
  return committedTree;
}
async function pushCommittedPlan(repo, plan, policy) {
  if (!policy.allowPush) fail(EXIT.PUSH_DENIED, 'PUSH_DENIED', 'Push is disabled by repository policy');
  const identity = await currentIdentity(repo);
  if (identity.branch !== plan.branch || identity.head !== plan.commitSha) {
    fail(EXIT.PLAN_STALE, 'HEAD_CHANGED', 'Current branch/HEAD no longer matches the committed plan');
  }
  await verifyCommittedTree(repo, plan);
  const remote = await git(repo.root, ['config', '--get', `branch.${plan.branch}.remote`], { allowFailure: true });
  const mergeRef = await git(repo.root, ['config', '--get', `branch.${plan.branch}.merge`], { allowFailure: true });
  if (!remote || !mergeRef?.startsWith('refs/heads/') || remote === '.') {
    fail(EXIT.PUSH_FAILED, 'UPSTREAM_MISSING', `Branch ${plan.branch} has no pushable upstream`, { commitSha: plan.commitSha });
  }
  const result = await run('git', ['push', '--porcelain', '--', remote, `HEAD:${mergeRef}`], { cwd: repo.root });
  if (result.code !== 0) {
    fail(EXIT.PUSH_FAILED, 'PUSH_FAILED', 'Commit succeeded but push failed; retry with push --plan', {
      commitSha: plan.commitSha,
      stderr: result.stderr.toString('utf8').trim(),
      gitExitCode: result.code,
    });
  }
  plan.pushed = true;
  plan.pushedAt = new Date().toISOString();
  await savePlan(repo, plan);
}

async function commit(repo, options) {
  const plan = await loadPlan(repo, options.planId);
  const policyForLock = (await loadPolicy(repo)).policy;
  const release = await acquireLock(repo, policyForLock.planTtlMinutes);
  let staged = false;
  let hookRun;
  try {
    const policy = await verifyPlan(repo, plan);
    if (options.push && !policy.allowPush) {
      fail(EXIT.PUSH_DENIED, 'PUSH_DENIED', 'Push is disabled by repository policy');
    }
    for (const file of plan.request.files) {
      const result = await run('git', ['add', '-A', '--', file], { cwd: repo.root });
      if (result.code !== 0) fail(EXIT.COMMIT_FAILED, 'STAGE_FAILED', `Unable to stage ${file}`, { stderr: result.stderr.toString('utf8').trim() });
      staged = true;
    }
    await assertIndexMatchesPlan(repo, plan);
    const approvedTree = await git(repo.root, ['write-tree']);
    await assertIndexMatchesPlan(repo, plan);
    hookRun = await createVerifiedHooks(repo, approvedTree);
    plan.approvedTree = approvedTree;
    plan.state = 'committing';
    plan.commitStartedAt = new Date().toISOString();
    await savePlan(repo, plan);
    const result = await run('git', ['-c', `core.hooksPath=${hookRun.directory}`, 'commit', '-m', plan.request.commitMessage], { cwd: repo.root });
    const headAfter = await git(repo.root, ['rev-parse', 'HEAD'], { allowFailure: true });
    if (result.code !== 0) {
      if (headAfter && headAfter !== plan.head) {
        plan.state = 'committed';
        plan.commitSha = headAfter;
        plan.committedAt = new Date().toISOString();
        await savePlan(repo, plan);
      } else {
        plan.state = 'ready';
        delete plan.commitStartedAt;
        await savePlan(repo, plan);
      }
      const stderr = result.stderr.toString('utf8').trim();
      const hookChangedIndex = stderr.includes('SAFE_COMMIT_INDEX_CHANGED');
      fail(hookChangedIndex ? EXIT.PLAN_STALE : EXIT.COMMIT_FAILED, hookChangedIndex ? 'HOOK_CHANGED_INDEX' : 'COMMIT_FAILED', hookChangedIndex ? 'A Git hook changed the reviewed index; run check again' : 'git commit failed', { stderr, gitExitCode: result.code, commitSha: plan.commitSha });
    }
    staged = false;
    plan.state = 'committed';
    plan.commitSha = headAfter;
    plan.committedAt = new Date().toISOString();
    await savePlan(repo, plan);
    await verifyCommittedTree(repo, plan);
    if (options.push) {
      try { await pushCommittedPlan(repo, plan, policy); }
      catch (error) {
        if (error instanceof SafeCommitError) error.result = baseOutput('commit', plan);
        throw error;
      }
    }
    return baseOutput('commit', plan);
  } catch (error) {
    if (error instanceof SafeCommitError && !error.result) error.result = baseOutput('commit', plan);
    throw error;
  } finally {
    if (staged) await cleanupStaging(repo);
    if (hookRun) await hookRun.cleanup();
    await release();
  }
}

async function pushPlan(repo, options) {
  const plan = await loadPlan(repo, options.planId);
  try {
    if (plan.repo.commonDir !== repo.commonDir || plan.repo.worktree !== repo.rootReal || plan.repo.gitDir !== repo.gitDir) {
      fail(EXIT.PLAN_STALE, 'PLAN_REPOSITORY_CHANGED', 'Plan belongs to a different repository or worktree');
    }
    if (plan.state !== 'committed' || !plan.commitSha) fail(EXIT.PLAN_CONSUMED, 'PLAN_NOT_COMMITTED', 'Plan does not contain a completed commit');
    if (plan.pushed) return baseOutput('push', plan);
    const { policy, hash: policyHash } = await loadPolicy(repo);
    if (policyHash !== plan.policyHash) fail(EXIT.PLAN_STALE, 'POLICY_CHANGED', 'Repository policy changed after check');
    const release = await acquireLock(repo, policy.planTtlMinutes);
    try {
      await pushCommittedPlan(repo, plan, policy);
      return baseOutput('push', plan);
    } finally { await release(); }
  } catch (error) {
    if (error instanceof SafeCommitError && !error.result) error.result = baseOutput('push', plan);
    throw error;
  }
}

async function inspect(repo, options) {
  const plan = await loadPlan(repo, options.planId);
  if (plan.repo.commonDir !== repo.commonDir || plan.repo.worktree !== repo.rootReal || plan.repo.gitDir !== repo.gitDir) {
    fail(EXIT.PLAN_STALE, 'PLAN_REPOSITORY_CHANGED', 'Plan belongs to a different repository or worktree');
  }
  return baseOutput('inspect', plan);
}

function human(result) {
  const lines = [`safe-commit ${result.action}: ${result.ok ? 'ok' : 'failed'}`];
  if (result.producer) lines.push(`task: ${result.producer}/${result.taskId}`);
  if (result.branch) lines.push(`branch: ${result.branch}`);
  if (result.planId) lines.push(`plan: ${result.planId}`);
  if (result.state) lines.push(`state: ${result.state}`);
  if (result.expiresAt) lines.push(`expires: ${result.expiresAt}`);
  if (result.commitMessage) lines.push(`message: ${result.commitMessage}`);
  for (const file of result.files ?? []) lines.push(`  ${file.status} ${file.path}`);
  if (result.ignoredFiles?.length) {
    lines.push('ignored unrelated changes:');
    for (const file of result.ignoredFiles) lines.push(`  ${file.status} ${file.path}`);
  }
  if (result.commitSha) lines.push(`commit: ${result.commitSha}`);
  if (result.pushed) lines.push('pushed: true');
  for (const error of result.errors ?? []) lines.push(`error [${error.code}]: ${error.message}`);
  return lines.join('\n');
}

async function main() {
  let options = { action: process.argv[2] ?? null, json: process.argv.includes('--json') };
  try {
    options = parseArgs(process.argv.slice(2));
    const repo = await discoverRepo();
    await ensureGitHookSupport(repo);
    let result;
    if (options.action === 'check') result = await check(repo, options);
    else if (options.action === 'inspect') result = await inspect(repo, options);
    else if (options.action === 'commit') result = await commit(repo, options);
    else result = await pushPlan(repo, options);
    process.stdout.write(`${options.json ? JSON.stringify(result) : human(result)}\n`);
  } catch (error) {
    const safe = error instanceof SafeCommitError
      ? error
      : new SafeCommitError(EXIT.INTERNAL, 'INTERNAL', error?.message ?? String(error));
    const result = {
      ...(safe.result ?? baseOutput(options.action)),
      ok: false,
      errors: [{ code: safe.kind, message: safe.message, ...(safe.details === undefined ? {} : { details: safe.details }) }],
    };
    const output = options.json ? JSON.stringify(result) : human(result);
    (options.json ? process.stdout : process.stderr).write(`${output}\n`);
    process.exitCode = safe.exitCode;
  }
}

await main();
