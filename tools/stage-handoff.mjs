#!/usr/bin/env node

// Cross-agent review handoff. Claude publishes immutable review requests and Codex writes
// immutable responses under the Git-ignored .agent-handoffs/ directory, in two separate
// channels: `contract` (a Stage Contract draft, before the user approves it) and
// `implementation` (a finished stage, before its task checkbox). The tool only reads Git
// and never touches the checkpoint, tasks, code, or the index. A handoff is a redacted
// review snapshot, not a source of truth. Protocol: docs/implementation-workflow.md
// ("Cross-agent review handoff").

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = 1;
const HANDOFF_DIR = '.agent-handoffs';
const MANIFEST_HEADER = 'errlog-changed-files-manifest/v1';
const INPUTS_HEADER = 'errlog-contract-inputs/v1';
const UNAVAILABLE_MESSAGE = 'handoff unavailable or invalid — perform direct repository review';
const STAGE_PATTERN = /^[A-Z][A-Za-z0-9.-]{0,15}$/u;
const RUN_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const VERDICTS = ['PASS', 'FAIL', 'BLOCKED'];
const READ_ONLY_GIT = new Set(['rev-parse', 'status', 'rev-list', 'check-ignore', 'ls-files']);
const MAX_STRING = 500;
const MAX_SUMMARY = 300;
const MAX_ITEMS = 50;
const MAX_CONTRACT_TEXT = 32 * 1024;
const ALLOWED_EMAIL_DOMAINS = ['example.test', 'example.com', 'example.invalid'];
const INDEX_KEYS = [
  'schemaVersion', 'stageId', 'runId', 'priorRunId', 'baselineHead',
  'currentRevision', 'currentRequestPath', 'currentRequestSha256', 'updatedAt',
];
const SOURCE_KEYS = ['stageId', 'runId', 'revision', 'requestPath', 'requestSha256', 'changedFilesDigest', 'currentHead'];
const CONTRACT_FIELDS = [
  'summary', 'taskIds', 'allowedFiles', 'excluded', 'testRequirements', 'contractTestRequirements',
  'aiEvalRequirements', 'e2eRequirements', 'securityImpact',
];

// The implementation channel keeps H1's layout, names, kinds, and record shapes, so H1
// handoffs verify unchanged. The contract channel lives under <stage>/contract/.
const CHANNELS = {
  implementation: {
    name: 'implementation',
    subdir: [],
    requestSuffix: 'review-ready',
    responseSuffix: 'codex-review',
    requestKind: 'review-request',
    responseKind: 'review-response',
    reasons: ['initial', 'targeted_fix', 'plan_refresh', 'manual_refresh'],
    verdicts: VERDICTS,
    passVerdict: 'PASS',
    passGate: 'codex_pass',
    indexKeys: INDEX_KEYS,
    requestKeys: [
      'schemaVersion', 'kind', 'stageId', 'runId', 'revision', 'generatedAt', 'reason', 'previousRequest',
      'repo', 'contract', 'changes', 'checkpoint', 'verification', 'claudeReview', 'contractDeviations',
      'safeCommit', 'worktree', 'nextAction',
    ],
    responseDraftKeys: ['verdict', 'blockingFindings', 'nonBlockingFindings', 'checksPerformed', 'limitations', 'nextAction'],
    responseKeys: [
      'schemaVersion', 'kind', 'reviewer', 'generatedAt', 'source', 'verdict', 'blockingFindings',
      'nonBlockingFindings', 'checksPerformed', 'limitations', 'nextAction',
    ],
    sourceKeys: SOURCE_KEYS,
    maxBytes: 64 * 1024,
  },
  contract: {
    name: 'contract',
    subdir: ['contract'],
    requestSuffix: 'contract-request',
    responseSuffix: 'codex-contract-review',
    requestKind: 'contract-review-request',
    responseKind: 'contract-review-response',
    reasons: ['initial', 'contract_revision', 'user_revision', 'manual_refresh'],
    // No verdict can mean "approved": only the user approves a Stage Contract.
    verdicts: ['OK', 'NEEDS_CHANGES', 'BLOCKED'],
    passVerdict: 'OK',
    passGate: 'awaiting_user_approval',
    indexKeys: ['schemaVersion', 'channel', ...INDEX_KEYS.slice(1)],
    requestKeys: [
      'schemaVersion', 'kind', 'channel', 'stageId', 'runId', 'revision', 'generatedAt', 'reason', 'previousRequest',
      'repo', 'contract', 'contractText', 'contractSha256', 'openQuestions', 'priorFindings', 'inputs', 'changes',
      'worktree', 'nextAction',
    ],
    responseDraftKeys: [
      'verdict', 'blockingFindings', 'nonBlockingFindings', 'suggestions', 'checksPerformed', 'limitations', 'nextAction',
    ],
    responseKeys: [
      'schemaVersion', 'kind', 'channel', 'reviewer', 'generatedAt', 'source', 'verdict', 'blockingFindings',
      'nonBlockingFindings', 'suggestions', 'checksPerformed', 'limitations', 'nextAction',
    ],
    sourceKeys: [...SOURCE_KEYS.slice(0, 6), 'inputsDigest', 'contractSha256', 'currentHead'],
    maxBytes: 128 * 1024,
  },
};
for (const ch of Object.values(CHANNELS)) {
  ch.requestPattern = new RegExp(`^(\\d{4})-${ch.requestSuffix}\\.json$`, 'u');
  ch.responsePattern = new RegExp(`^(\\d{4})-${ch.responseSuffix}\\.json$`, 'u');
}
const SENSITIVE_PATTERNS = [
  ['URL_CREDENTIALS', /[a-z][a-z0-9+.-]*:\/\/[^\s/"@]*:(?!<redacted>@)[^\s/"@]*@/iu],
  ['DATABASE_URL', /(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/(?!<redacted>)[^\s"/]/iu],
  ['AUTHORIZATION_HEADER', /authorization\s*:/iu],
  ['BEARER_TOKEN', /bearer\s+[A-Za-z0-9._~+/=-]{10,}/iu],
  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY/u],
  ['SECRET_ASSIGNMENT', /(?:password|passwd|secret|token|api[_-]?key|cookie|(?<![a-z])otp)\\?["']?\s*[:=]\s*\\?["']?(?!<redacted>(?![A-Za-z0-9]))[^\s"',;)}\]\\]/iu],
  ['AWS_ACCESS_KEY', /AKIA[0-9A-Z]{16}/u],
  ['GITHUB_TOKEN', /gh[pousr]_[A-Za-z0-9]{36}/u],
  ['API_SECRET_KEY', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/u],
  ['GOOGLE_API_KEY', /AIza[0-9A-Za-z_-]{35}/u],
  ['SLACK_TOKEN', /xox[abposr]-[A-Za-z0-9-]{10,}/u],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u],
  ['PHONE_NUMBER', /(?<![0-9A-Za-z])(?:\+?86[- ]?)?1[3-9]\d(?:[- ]?\d{4}){2}(?![0-9A-Za-z])/u],
];

class HandoffError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

function fail(code, message, extra) {
  throw new HandoffError(code, message, extra);
}

const invalidInput = (message) => fail('INPUT_INVALID', message);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
const requestName = (ch, revision) => `${String(revision).padStart(4, '0')}-${ch.requestSuffix}.json`;
const responseName = (ch, revision) => `${String(revision).padStart(4, '0')}-${ch.responseSuffix}.json`;
const serialize = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const publicReasons = (reasons) => reasons.map(({ code, detail }) => ({ code, detail }));
const byPathBytes = (a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8'));

// Canonical changed-files manifest: NUL-separated, so any POSIX path is unambiguous.
export function encodeManifest(files) {
  const sorted = [...files].sort(byPathBytes);
  const parts = [Buffer.from(`${MANIFEST_HEADER}\0`, 'utf8')];
  for (const file of sorted) parts.push(Buffer.from(`${file.status}\0${file.sha256}\0${file.path}\0`, 'utf8'));
  return Buffer.concat(parts);
}

// Canonical contract-input manifest, encoded the same way: <content> NUL <path> NUL.
export function encodeInputs(files) {
  const sorted = [...files].sort(byPathBytes);
  const parts = [Buffer.from(`${INPUTS_HEADER}\0`, 'utf8')];
  for (const file of sorted) parts.push(Buffer.from(`${file.sha256}\0${file.path}\0`, 'utf8'));
  return Buffer.concat(parts);
}

export function findSensitiveData(text) {
  const hits = new Set(SENSITIVE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name));
  // The TLD must be alphabetic, so exact package pins such as name@1.48.2 are not emails.
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/gu)) {
    const domain = match[1].toLowerCase();
    if (!ALLOWED_EMAIL_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) hits.add('EMAIL_ADDRESS');
  }
  if ((text.match(/(?<![A-Za-z0-9_])[A-Z][A-Z0-9_]*=[^\s"\\]/gu) ?? []).length >= 3) hits.add('ENVIRONMENT_DUMP');
  return [...hits];
}

function stringLeaves(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringLeaves(item, out));
  else if (isObject(value)) Object.values(value).forEach((item) => stringLeaves(item, out));
  return out;
}

// Scans the serialized record and, so that a match at the start of a line inside a
// multi-line string is not hidden behind a JSON escape, each raw string value too.
function sensitiveRules(value) {
  return [...new Set([...findSensitiveData(JSON.stringify(value)), ...findSensitiveData(stringLeaves(value).join('\n'))])];
}

function guardOutput(ch, record) {
  const bytes = serialize(record);
  if (bytes.length > ch.maxBytes) fail('INPUT_INVALID', `Record exceeds ${ch.maxBytes} bytes`);
  const rules = sensitiveRules(record);
  // Name only the rules and top-level fields, never the matched text.
  if (rules.length) {
    const fields = Object.keys(record).filter((key) => sensitiveRules(record[key]).length);
    fail('SENSITIVE_DATA', 'Sensitive data detected; nothing was written', { rules, fields });
  }
  return bytes;
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
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

async function git(root, args, { allowFailure = false } = {}) {
  if (!READ_ONLY_GIT.has(args[0])) fail('INTERNAL', `git ${args[0]} is not an allowed read-only command`);
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const result = await run('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, env });
  if (result.code !== 0 && !allowFailure) {
    fail('GIT_FAILED', `git ${args[0]} failed`, { stderr: result.stderr.toString('utf8').trim() });
  }
  return result;
}

const gitText = async (root, args) => (await git(root, args)).stdout.toString('utf8').trim();

function parseArgs(argv) {
  const command = argv[0];
  if (!['init', 'publish', 'respond', 'verify'].includes(command)) fail('USAGE', 'Expected one of: init, publish, respond, verify');
  // Without --channel the H1 behavior (implementation) applies, for compatibility.
  const options = { command, newRun: false, channel: 'implementation' };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const hasValue = argv[index + 1] !== undefined;
    if (arg === '--json') continue;
    else if (arg === '--stage' && hasValue) options.stage = argv[++index];
    else if (arg === '--channel' && hasValue) options.channel = argv[++index];
    else if (arg === '--new-run' && command === 'init') options.newRun = true;
    else if (arg === '--input' && ['publish', 'respond'].includes(command) && hasValue) options.input = argv[++index];
    else if (arg === '--revision' && ['respond', 'verify'].includes(command) && hasValue) options.revision = argv[++index];
    else fail('USAGE', `Unknown or incomplete option: ${arg}`);
  }
  if (!Object.hasOwn(CHANNELS, options.channel)) fail('USAGE', '--channel must be one of: implementation, contract');
  if (!STAGE_PATTERN.test(options.stage ?? '')) fail('USAGE', '--stage must match ^[A-Z][A-Za-z0-9.-]{0,15}$');
  if (['publish', 'respond'].includes(command) && !options.input) fail('USAGE', `${command} requires --input <draft.json>`);
  if (command === 'respond' && options.revision === undefined) fail('USAGE', 'respond requires --revision <n>');
  if (options.revision !== undefined) {
    if (!/^[1-9]\d{0,3}$/u.test(options.revision)) fail('USAGE', '--revision must be a positive integer');
    options.revision = Number(options.revision);
  }
  return options;
}

async function discoverRoot() {
  const result = await run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (result.code !== 0) fail('NOT_A_REPOSITORY', 'Current directory is not inside a Git worktree');
  return await realpath(result.stdout.toString('utf8').trim());
}

function layout(root, stage, ch) {
  const handoffDir = path.join(root, HANDOFF_DIR);
  const stageDir = path.join(handoffDir, stage);
  const channelDirs = ch.subdir.map((_, index) => path.join(stageDir, ...ch.subdir.slice(0, index + 1)));
  return { handoffDir, stageDir, channelDirs, runsDir: path.join(stageDir, ...ch.subdir, 'runs') };
}

const repoRelative = (root, target) => path.relative(root, target).split(path.sep).join('/');

async function ensureIgnored(root, stage, ch) {
  const probe = [HANDOFF_DIR, stage, ...ch.subdir, 'runs', 'probe', 'index.json'].join('/');
  const ignored = await git(root, ['check-ignore', '-q', '--', probe], { allowFailure: true });
  if (ignored.code === 1) fail('NOT_IGNORED', `${HANDOFF_DIR}/ is not ignored by Git; add it to .gitignore`);
  if (ignored.code !== 0) fail('GIT_FAILED', 'git check-ignore failed');
  const tracked = await git(root, ['ls-files', '-z', '--', HANDOFF_DIR]);
  if (tracked.stdout.length) fail('NOT_IGNORED', `${HANDOFF_DIR}/ contains tracked files`);
  // The probe alone can be fooled by negated rules; nothing under the directory may be visible.
  const visible = await git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', HANDOFF_DIR]);
  if (visible.stdout.length) fail('NOT_IGNORED', `Some files under ${HANDOFF_DIR}/ are not ignored by Git`);
}

// true for a plain directory, false if missing; symlinks and other types fail closed.
async function plainDirectory(target) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!info.isDirectory()) fail('UNSAFE_PATH', `Not a plain directory: ${path.basename(target)}`);
  return true;
}

async function readRegularFile(target) {
  const info = await lstat(target);
  if (!info.isFile()) fail('UNSAFE_PATH', `Not a regular file: ${path.basename(target)}`);
  return await readFile(target);
}

async function listRuns(paths) {
  for (const dir of [paths.handoffDir, paths.stageDir, ...paths.channelDirs, paths.runsDir]) {
    if (!(await plainDirectory(dir))) return [];
  }
  const entries = await readdir(paths.runsDir);
  const unexpected = entries.filter((name) => !RUN_PATTERN.test(name));
  if (unexpected.length) fail('UNEXPECTED_ENTRY', `Unexpected entries in runs/: ${unexpected.join(', ')}`);
  return entries.sort();
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `${stamp}-${randomBytes(4).toString('hex')}`;
}

async function syncDirectory(dir) {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeTemporary(dir, prefix, bytes) {
  const temporary = path.join(dir, `${prefix}${randomBytes(4).toString('hex')}`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await readFile(temporary)).equals(bytes)) fail('WRITE_FAILED', 'Temporary file did not read back identically');
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return temporary;
}

// link() never replaces an existing name, so a published record cannot be overwritten.
async function publishImmutable(dir, name, bytes, existsCode) {
  const temporary = await writeTemporary(dir, '.tmp-', bytes);
  const target = path.join(dir, name);
  try {
    await link(temporary, target);
  } catch (error) {
    if (error.code === 'EEXIST') fail(existsCode, `${name} already exists and is never overwritten`);
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
  await chmod(target, 0o444);
  await syncDirectory(dir);
  if (sha256(await readFile(target)) !== sha256(bytes)) fail('WRITE_FAILED', `${name} did not read back identically`);
}

async function writeIndex(runDir, index) {
  const temporary = await writeTemporary(runDir, '.index.tmp-', serialize(index));
  try {
    await rename(temporary, path.join(runDir, 'index.json'));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await syncDirectory(runDir);
}

async function withLock(runDir, action) {
  const lock = path.join(runDir, '.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') fail('LOCKED', 'A handoff lock exists (another writer, or an interrupted write); only the user may remove it');
    throw error;
  }
  try {
    return await action();
  } finally {
    await rmdir(lock).catch(() => {});
  }
}

async function readDraft(ch, file) {
  let bytes;
  try {
    bytes = await readFile(path.resolve(file));
  } catch (error) {
    fail('INPUT_INVALID', `Cannot read input: ${error.code ?? error.message}`);
  }
  if (bytes.length > ch.maxBytes) invalidInput(`Input exceeds ${ch.maxBytes} bytes`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return invalidInput('Input is not valid JSON');
  }
}

function expectKeys(value, keys, field) {
  if (!isObject(value)) invalidInput(`${field} must be an object`);
  const actual = Object.keys(value).sort().join(',');
  if (actual !== [...keys].sort().join(',')) invalidInput(`${field} must have exactly: ${keys.join(', ')}`);
}

function text(value, field, max = MAX_STRING) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalidInput(`${field} must be a single-line string of 1-${max} characters`);
  }
  return value;
}

function list(value, field, check) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) invalidInput(`${field} must be an array of at most ${MAX_ITEMS} items`);
  value.forEach((item, index) => check(item, `${field}[${index}]`));
  return value;
}

const textList = (value, field) => list(value, field, (item, name) => text(item, name));

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) invalidInput(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function normalizedRelative(value, field) {
  if (value.startsWith('/') || path.posix.normalize(value) !== value || value.split('/').includes('..')) {
    invalidInput(`${field} must be a normalized repository-relative path`);
  }
  return value;
}

function repoPath(value, field) {
  text(value, field);
  return normalizedRelative(value, field);
}

// Input files may have any POSIX name (spaces, tabs, newlines); only NUL is impossible.
function inputPath(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING || value.includes('\0')) {
    invalidInput(`${field} must be a path of 1-${MAX_STRING} characters`);
  }
  return normalizedRelative(value, field);
}

function validateReason(ch, reason, revision) {
  oneOf(reason, ch.reasons, 'reason');
  if ((revision === 1) !== (reason === 'initial')) invalidInput('reason must be "initial" for revision 1 and only for revision 1');
}

function validateRequestDraft(draft, revision) {
  expectKeys(draft, ['reason', 'contract', 'checkpoint', 'verification', 'claudeReview', 'contractDeviations', 'safeCommitPlanId', 'nextAction'], 'input');
  validateReason(CHANNELS.implementation, draft.reason, revision);
  expectKeys(draft.contract, ['summary', 'taskIds', 'allowedFiles'], 'contract');
  text(draft.contract.summary, 'contract.summary', MAX_SUMMARY);
  textList(draft.contract.taskIds, 'contract.taskIds');
  list(draft.contract.allowedFiles, 'contract.allowedFiles', repoPath);
  if (draft.checkpoint !== null) {
    // The checkpoint holds the user-approved Stage Contract; the request says so explicitly.
    expectKeys(draft.checkpoint, ['path', 'summary', 'containsApprovedContract'], 'checkpoint');
    repoPath(draft.checkpoint.path, 'checkpoint.path');
    expectKeys(draft.checkpoint.summary, ['stageId', 'stageState', 'progress'], 'checkpoint.summary');
    for (const key of ['stageId', 'stageState', 'progress']) text(draft.checkpoint.summary[key], `checkpoint.summary.${key}`);
    if (draft.checkpoint.containsApprovedContract !== true) invalidInput('checkpoint.containsApprovedContract must be true');
  }
  list(draft.verification, 'verification', (item, field) => {
    expectKeys(item, ['name', 'redactedCommand', 'exitCode', 'result', 'conciseSummary'], field);
    text(item.name, `${field}.name`);
    text(item.redactedCommand, `${field}.redactedCommand`);
    if (!Number.isInteger(item.exitCode)) invalidInput(`${field}.exitCode must be an integer`);
    oneOf(item.result, VERDICTS, `${field}.result`);
    text(item.conciseSummary, `${field}.conciseSummary`, MAX_SUMMARY);
  });
  const review = draft.claudeReview;
  expectKeys(review, ['reviewerType', 'round', 'verdict', 'blockingFindings', 'nonBlockingFindings', 'fixesApplied'], 'claudeReview');
  text(review.reviewerType, 'claudeReview.reviewerType');
  if (!Number.isInteger(review.round) || review.round < 1) invalidInput('claudeReview.round must be a positive integer');
  oneOf(review.verdict, VERDICTS, 'claudeReview.verdict');
  for (const key of ['blockingFindings', 'nonBlockingFindings', 'fixesApplied']) textList(review[key], `claudeReview.${key}`);
  list(draft.contractDeviations, 'contractDeviations', (item, field) => {
    expectKeys(item, ['description', 'userApproved'], field);
    text(item.description, `${field}.description`);
    if (typeof item.userApproved !== 'boolean') invalidInput(`${field}.userApproved must be a boolean`);
  });
  if (draft.safeCommitPlanId !== null && !HEX64.test(draft.safeCommitPlanId ?? '')) invalidInput('safeCommitPlanId must be null or a 64-hex plan ID');
  text(draft.nextAction, 'nextAction');
}

function validateContractText(value) {
  // Multi-line Markdown: newlines and tabs are allowed, other control characters are not.
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_CONTRACT_TEXT
    || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    invalidInput(`contractText must be 1-${MAX_CONTRACT_TEXT} bytes of text (newlines and tabs allowed)`);
  }
}

function validateContractDraft(draft, revision) {
  expectKeys(draft, ['reason', 'contract', 'contractText', 'openQuestions', 'priorFindings', 'inputFiles', 'nextAction'], 'input');
  validateReason(CHANNELS.contract, draft.reason, revision);
  expectKeys(draft.contract, CONTRACT_FIELDS, 'contract');
  text(draft.contract.summary, 'contract.summary', MAX_SUMMARY);
  list(draft.contract.allowedFiles, 'contract.allowedFiles', repoPath);
  if (!draft.contract.allowedFiles.length) invalidInput('contract.allowedFiles must not be empty');
  for (const key of CONTRACT_FIELDS.slice(1)) if (key !== 'allowedFiles') textList(draft.contract[key], `contract.${key}`);
  validateContractText(draft.contractText);
  list(draft.openQuestions, 'openQuestions', (item, field) => {
    expectKeys(item, ['id', 'question', 'options', 'recommendation', 'rationale'], field);
    for (const key of ['id', 'question', 'recommendation', 'rationale']) text(item[key], `${field}.${key}`);
    list(item.options, `${field}.options`, (option, name) => {
      expectKeys(option, ['label', 'description'], name);
      text(option.label, `${name}.label`);
      text(option.description, `${name}.description`);
    });
    if (item.options.length < 2) invalidInput(`${field}.options must list at least two alternatives`);
  });
  // Each blocking finding gets at most two fix rounds; checkFixRounds enforces the history.
  list(draft.priorFindings, 'priorFindings', (item, field) => {
    expectKeys(item, ['finding', 'previousFinding', 'fixRound', 'resolution'], field);
    text(item.finding, `${field}.finding`);
    if (item.previousFinding !== null) text(item.previousFinding, `${field}.previousFinding`);
    if (item.fixRound !== 1 && item.fixRound !== 2) invalidInput(`${field}.fixRound must be 1 or 2`);
    text(item.resolution, `${field}.resolution`);
  });
  if (draft.reason === 'initial' && draft.priorFindings.length) invalidInput('priorFindings must be empty for revision 1');
  list(draft.inputFiles, 'inputFiles', inputPath);
  if (!draft.inputFiles.length) invalidInput('inputFiles must not be empty');
  if (new Set(draft.inputFiles).size !== draft.inputFiles.length) invalidInput('inputFiles must not repeat a path');
  text(draft.nextAction, 'nextAction');
}

function validateResponseDraft(ch, draft) {
  expectKeys(draft, ch.responseDraftKeys, 'input');
  oneOf(draft.verdict, ch.verdicts, 'verdict');
  for (const key of ch.responseDraftKeys.filter((name) => !['verdict', 'nextAction'].includes(name))) textList(draft[key], key);
  text(draft.nextAction, 'nextAction');
}

async function contentOf(root, filePath) {
  const target = path.join(root, filePath);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return 'deleted';
    throw error;
  }
  if (info.isSymbolicLink()) return `symlink:${sha256(await readlink(target, { encoding: 'buffer' }))}`;
  if (info.isFile()) return `sha256:${sha256(await readFile(target))}`;
  return fail('UNSUPPORTED_PATH', `Changed path is neither a file nor a symlink: ${filePath}`);
}

async function collectChanges(root, allowedFiles) {
  const { stdout } = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  const entries = [];
  let start = 0;
  for (let end = stdout.indexOf(0, start); end !== -1; start = end + 1, end = stdout.indexOf(0, start)) {
    const record = stdout.subarray(start, end);
    if (record.length < 4 || record[2] !== 0x20) fail('GIT_FAILED', 'Unexpected git status output');
    const rawPath = record.subarray(3);
    const filePath = rawPath.toString('utf8');
    if (!Buffer.from(filePath, 'utf8').equals(rawPath)) fail('UNSUPPORTED_PATH', 'A changed path is not valid UTF-8');
    entries.push({ path: filePath, status: record.subarray(0, 2).toString('latin1'), sha256: await contentOf(root, filePath) });
  }
  entries.sort(byPathBytes);
  return {
    changedFilesDigest: `sha256:${sha256(encodeManifest(entries))}`,
    files: entries.map((entry) => ({ ...entry, inScope: allowedFiles.includes(entry.path) })),
  };
}

// Content of every contract input as it is now; a missing or non-regular file shows up
// as a different value, so it makes the request stale.
async function collectInputs(root, inputFiles) {
  const files = [];
  for (const filePath of inputFiles) {
    let content;
    try {
      content = await contentOf(root, filePath);
    } catch (error) {
      if (!(error instanceof HandoffError)) throw error;
      content = 'unsupported';
    }
    files.push({ path: filePath, sha256: content });
  }
  files.sort(byPathBytes);
  return { inputsDigest: `sha256:${sha256(encodeInputs(files))}`, files };
}

async function repoFacts(root) {
  const head = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = await gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstreamResult = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true });
  const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.toString('utf8').trim() : null;
  let ahead = null;
  let behind = null;
  if (upstream) [ahead, behind] = (await gitText(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).split(/\s+/u).map(Number);
  return { head, branch, upstream, ahead, behind };
}

async function checkpointHash(root, relativePath) {
  try {
    return `sha256:${sha256(await readRegularFile(path.join(root, relativePath)))}`;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof HandoffError) return null;
    throw error;
  }
}

// Read-only: safe-commit's own inspect command, never its private plan files.
async function planInfo(root, planId) {
  const cli = path.join(import.meta.dirname, 'safe-commit.mjs');
  const result = await run(process.execPath, [cli, 'inspect', '--plan', planId, '--json'], { cwd: root });
  let output = null;
  try {
    output = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    // Treated as a missing plan below.
  }
  if (!output?.ok) return null;
  const pick = (files) => (files ?? []).map((file) => ({ path: file.path, status: file.status }));
  return { planId, state: output.state, expiresAt: output.expiresAt, files: pick(output.files), ignoredFiles: pick(output.ignoredFiles) };
}

function validateIndex(ch, index, stage, runId) {
  expectKeys(index, ch.indexKeys, 'index.json');
  const revision = index.currentRevision;
  const ok = index.schemaVersion === VERSION
    && (ch.name === 'implementation' || index.channel === ch.name)
    && index.stageId === stage
    && index.runId === runId
    && (index.priorRunId === null || RUN_PATTERN.test(index.priorRunId))
    && /^[0-9a-f]{40,64}$/u.test(index.baselineHead)
    && Number.isInteger(revision) && revision >= 0
    && (revision === 0
      ? index.currentRequestPath === null && index.currentRequestSha256 === null
      : index.currentRequestPath === `requests/${requestName(ch, revision)}` && HEX64.test(index.currentRequestSha256))
    && typeof index.updatedAt === 'string';
  if (!ok) invalidInput('index.json fields are inconsistent');
}

function validateRequestRecord(ch, request, stage, runId, revision) {
  expectKeys(request, ch.requestKeys, `request ${revision}`);
  let ok = request.schemaVersion === VERSION
    && request.kind === ch.requestKind
    && request.stageId === stage
    && request.runId === runId
    && request.revision === revision
    && isObject(request.repo) && isObject(request.contract) && isObject(request.changes)
    && Array.isArray(request.contract.allowedFiles) && Array.isArray(request.changes.files);
  if (ch.name === 'implementation') ok &&= isObject(request.checkpoint);
  else {
    ok &&= request.channel === ch.name
      && typeof request.contractText === 'string'
      && isObject(request.inputs) && Array.isArray(request.inputs.files);
  }
  if (!ok) invalidInput(`request ${revision} identity fields are inconsistent`);
  for (const file of request.changes.files) expectKeys(file, ['path', 'status', 'sha256', 'inScope'], `request ${revision} changes.files[]`);
  if (request.changes.changedFilesDigest !== `sha256:${sha256(encodeManifest(request.changes.files))}`) {
    fail('MANIFEST_MISMATCH', `request ${revision} changedFilesDigest does not match its changes.files`);
  }
  if (ch.name === 'contract') {
    for (const file of request.inputs.files) expectKeys(file, ['path', 'sha256'], `request ${revision} inputs.files[]`);
    if (request.inputs.inputsDigest !== `sha256:${sha256(encodeInputs(request.inputs.files))}`) {
      fail('INPUTS_MISMATCH', `request ${revision} inputsDigest does not match its inputs.files`);
    }
    if (request.contractSha256 !== `sha256:${sha256(request.contractText)}`) {
      fail('CONTRACT_HASH_MISMATCH', `request ${revision} contractSha256 does not match its contractText`);
    }
  }
}

function expectedSource(ch, state, revision) {
  const request = state.requests.get(revision);
  const source = {
    stageId: request.json.stageId,
    runId: request.json.runId,
    revision,
    requestPath: `requests/${requestName(ch, revision)}`,
    requestSha256: sha256(request.bytes),
    changedFilesDigest: request.json.changes.changedFilesDigest,
    currentHead: request.json.repo.currentHead,
  };
  if (ch.name === 'contract') {
    source.inputsDigest = request.json.inputs.inputsDigest;
    source.contractSha256 = request.json.contractSha256;
  }
  return Object.fromEntries(ch.sourceKeys.map((key) => [key, source[key]]));
}

// Structural checks of the active run. Reasons carry a severity: invalid (corrupt or
// inconsistent), stale (interrupted write or lock), or unavailable (no handoff).
async function loadRun(root, stage, ch, { ownLock = false, runId = null } = {}) {
  const reasons = [];
  const add = (severity, code, detail) => reasons.push({ severity, code, detail });
  const state = { reasons, runId: null, runDir: null, index: null, requests: new Map(), responses: new Map() };
  let runs;
  try {
    runs = await listRuns(layout(root, stage, ch));
  } catch (error) {
    if (!(error instanceof HandoffError)) throw error;
    add('invalid', error.code, error.message);
    return state;
  }
  if (!runs.length) {
    add('unavailable', 'MISSING', `No ${ch.name} handoff exists for stage ${stage}`);
    return state;
  }
  // A writer pins the run it locked; a newer run created meanwhile must not be mixed in.
  if (runId && runs.at(-1) !== runId) add('stale', 'RUN_CHANGED', `A newer run ${runs.at(-1)} exists`);
  state.runId = runId ?? runs.at(-1);
  state.runDir = path.join(layout(root, stage, ch).runsDir, state.runId);
  try {
    await inspectRun(ch, state, stage, ownLock, add);
  } catch (error) {
    if (!(error instanceof HandoffError)) throw error;
    add('invalid', error.code === 'INPUT_INVALID' ? 'SCHEMA_INVALID' : error.code, error.message);
  }
  return state;
}

async function inspectRun(ch, state, stage, ownLock, add) {
  const { runDir, runId } = state;
  for (const name of await readdir(runDir)) {
    if (name === 'index.json') continue;
    if (name === 'requests' || name === 'responses') await plainDirectory(path.join(runDir, name));
    else if (name === '.lock') {
      if (!ownLock) add('stale', 'LOCK_PRESENT', 'A writer is active or a write was interrupted');
    } else if (name.startsWith('.index.tmp-')) add('stale', 'ORPHAN_TEMP_FILE', name);
    else add('invalid', 'UNEXPECTED_ENTRY', name);
  }
  for (const name of ['requests', 'responses']) {
    if (!(await plainDirectory(path.join(runDir, name)))) return add('invalid', 'SCHEMA_INVALID', `${name}/ is missing`);
  }
  let index;
  try {
    index = JSON.parse((await readRegularFile(path.join(runDir, 'index.json'))).toString('utf8'));
  } catch (error) {
    if (error instanceof HandoffError) throw error;
    return add('invalid', 'SCHEMA_INVALID', 'index.json is missing or not valid JSON');
  }
  validateIndex(ch, index, stage, runId);
  state.index = index;
  const current = index.currentRevision;

  const requestsDir = path.join(runDir, 'requests');
  const published = [];
  for (const name of await readdir(requestsDir)) {
    const match = ch.requestPattern.exec(name);
    if (match && Number(match[1]) >= 1) published.push(Number(match[1]));
    else if (name.startsWith('.tmp-')) add('stale', 'ORPHAN_TEMP_FILE', `requests/${name}`);
    else add('invalid', 'UNEXPECTED_ENTRY', `requests/${name}`);
  }
  for (const revision of published.filter((value) => value > current)) {
    if (revision === current + 1) add('stale', 'UNINDEXED_REQUEST', `requests/${requestName(ch, revision)}`);
    else add('invalid', 'UNEXPECTED_ENTRY', `requests/${requestName(ch, revision)}`);
  }
  for (let revision = 1; revision <= current; revision += 1) {
    if (!published.includes(revision)) return add('invalid', 'CHAIN_BROKEN', `requests/${requestName(ch, revision)} is missing`);
    const bytes = await readRegularFile(path.join(requestsDir, requestName(ch, revision)));
    let json;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch {
      return add('invalid', 'SCHEMA_INVALID', `requests/${requestName(ch, revision)} is not valid JSON`);
    }
    validateRequestRecord(ch, json, stage, runId, revision);
    if (sensitiveRules(json).length) add('invalid', 'SENSITIVE_DATA', `requests/${requestName(ch, revision)}`);
    const previous = revision === 1
      ? null
      : { path: `requests/${requestName(ch, revision - 1)}`, sha256: sha256(state.requests.get(revision - 1).bytes) };
    if (JSON.stringify(json.previousRequest) !== JSON.stringify(previous)) {
      add('invalid', 'CHAIN_BROKEN', `requests/${requestName(ch, revision)} does not match the previous request`);
    }
    state.requests.set(revision, { bytes, json });
  }
  if (current > 0 && sha256(state.requests.get(current).bytes) !== index.currentRequestSha256) {
    add('invalid', 'HASH_MISMATCH', 'The current request does not match index.json');
  }

  const responsesDir = path.join(runDir, 'responses');
  for (const name of await readdir(responsesDir)) {
    const match = ch.responsePattern.exec(name);
    const revision = match ? Number(match[1]) : 0;
    if (name.startsWith('.tmp-')) {
      add('stale', 'ORPHAN_TEMP_FILE', `responses/${name}`);
      continue;
    }
    if (!state.requests.has(revision)) {
      add('invalid', 'UNEXPECTED_ENTRY', `responses/${name}`);
      continue;
    }
    const bytes = await readRegularFile(path.join(responsesDir, name));
    let json;
    try {
      json = JSON.parse(bytes.toString('utf8'));
      expectKeys(json, ch.responseKeys, `responses/${name}`);
      // A response may have been written by hand, so check its content like respond does.
      validateResponseDraft(ch, Object.fromEntries(ch.responseDraftKeys.map((key) => [key, json[key]])));
      if (typeof json.generatedAt !== 'string' || Number.isNaN(Date.parse(json.generatedAt))) invalidInput('generatedAt is not a timestamp');
    } catch (error) {
      if (error instanceof HandoffError || error instanceof SyntaxError) {
        add('invalid', 'SCHEMA_INVALID', `responses/${name} is not a valid response`);
        continue;
      }
      throw error;
    }
    const expected = expectedSource(ch, state, revision);
    const bindingOk = json.schemaVersion === VERSION
      && json.kind === ch.responseKind
      && (ch.name === 'implementation' || json.channel === ch.name)
      && json.reviewer === 'codex'
      && ch.verdicts.includes(json.verdict)
      && isObject(json.source)
      && JSON.stringify(ch.sourceKeys.map((key) => json.source[key])) === JSON.stringify(ch.sourceKeys.map((key) => expected[key]))
      && Object.keys(json.source).length === ch.sourceKeys.length;
    if (!bindingOk) add('invalid', 'RESPONSE_BINDING_MISMATCH', `responses/${name} is not bound to its request`);
    if (sensitiveRules(json).length) add('invalid', 'SENSITIVE_DATA', `responses/${name}`);
    state.responses.set(revision, { bytes, json, bindingOk });
  }
}

// Live checks: does the request still describe the repository as it is now?
async function freshness(root, ch, request) {
  const reasons = [];
  const add = (code, detail) => reasons.push({ severity: 'stale', code, detail });
  const facts = await repoFacts(root);
  if (facts.head !== request.repo.currentHead) add('HEAD_CHANGED', `HEAD is ${facts.head}`);
  const changes = await collectChanges(root, request.contract.allowedFiles);
  if (changes.changedFilesDigest !== request.changes.changedFilesDigest) add('DIGEST_CHANGED', 'The changed files differ from the request');
  let plan = null;
  if (ch.name === 'contract') {
    const inputs = await collectInputs(root, request.inputs.files.map((file) => file.path));
    if (inputs.inputsDigest !== request.inputs.inputsDigest) add('INPUTS_CHANGED', 'The contract input files differ from the request');
    return { reasons, plan };
  }
  if (request.checkpoint.path !== null && (await checkpointHash(root, request.checkpoint.path)) !== request.checkpoint.sha256) {
    add('CHECKPOINT_CHANGED', request.checkpoint.path);
  }
  if (request.safeCommit) {
    plan = await planInfo(root, request.safeCommit.planId);
    if (!plan) add('PLAN_MISSING', request.safeCommit.planId);
    else if (plan.state !== 'ready') add('PLAN_CONSUMED', `Plan state is ${plan.state}`);
    else if (Date.now() > Date.parse(plan.expiresAt)) add('PLAN_EXPIRED', `Plan expired at ${plan.expiresAt}`);
  }
  return { reasons, plan };
}

async function activeRunDir(root, stage, ch) {
  const runs = await listRuns(layout(root, stage, ch));
  if (!runs.length) fail('NO_RUN', `No ${ch.name} run exists for stage ${stage}; run init first`);
  return path.join(layout(root, stage, ch).runsDir, runs.at(-1));
}

function requireValid(state) {
  if (state.reasons.length) {
    fail('HANDOFF_NOT_VALID', 'The existing handoff does not verify; nothing was written', { reasons: publicReasons(state.reasons) });
  }
}

async function init(root, options) {
  const { stage } = options;
  const ch = CHANNELS[options.channel];
  await ensureIgnored(root, stage, ch);
  const paths = layout(root, stage, ch);
  const runs = await listRuns(paths);
  const priorRunId = runs.at(-1) ?? null;
  if (priorRunId && !options.newRun) fail('ACTIVE_RUN_EXISTS', `Stage ${stage} already has ${ch.name} run ${priorRunId}; pass --new-run to start another`);
  let runId = newRunId();
  for (let attempt = 0; priorRunId && runId <= priorRunId && attempt < 64; attempt += 1) runId = newRunId();
  if (priorRunId && runId <= priorRunId) fail('RUN_ID_ORDER', 'The clock is behind the latest run ID');
  const baselineHead = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
  await mkdir(paths.runsDir, { recursive: true, mode: 0o700 });
  await listRuns(paths);
  const runDir = path.join(paths.runsDir, runId);
  await mkdir(runDir, { mode: 0o700 });
  await mkdir(path.join(runDir, 'requests'), { mode: 0o700 });
  await mkdir(path.join(runDir, 'responses'), { mode: 0o700 });
  const index = {
    schemaVersion: VERSION,
    stageId: stage,
    runId,
    priorRunId,
    baselineHead,
    currentRevision: 0,
    currentRequestPath: null,
    currentRequestSha256: null,
    updatedAt: timestamp(),
  };
  await writeIndex(runDir, ch.name === 'implementation' ? index : { schemaVersion: VERSION, channel: ch.name, ...index });
  return { ok: true, command: 'init', channel: ch.name, status: 'created', stageId: stage, runId, priorRunId, runDir: repoRelative(root, runDir) };
}

async function buildImplementationRequest(root, draft, base) {
  let checkpoint = { path: null, sha256: null, summary: 'not-applicable' };
  if (draft.checkpoint) {
    const hash = await checkpointHash(root, draft.checkpoint.path);
    if (!hash) invalidInput('checkpoint.path is not a regular file in the repository');
    const { stageId, stageState, progress } = draft.checkpoint.summary;
    checkpoint = { path: draft.checkpoint.path, sha256: hash, summary: { stageId, stageState, progress }, containsApprovedContract: true };
  }
  let safeCommit = null;
  if (draft.safeCommitPlanId) {
    safeCommit = await planInfo(root, draft.safeCommitPlanId);
    if (!safeCommit) fail('PLAN_MISSING', 'safe-commit inspect does not know this plan');
    if (safeCommit.state !== 'ready' || Date.now() > Date.parse(safeCommit.expiresAt)) {
      fail('PLAN_NOT_READY', `The plan is ${safeCommit.state} and expires at ${safeCommit.expiresAt}; run check again first`);
    }
  }
  const { summary, taskIds, allowedFiles } = draft.contract;
  const changes = await collectChanges(root, allowedFiles);
  return {
    ...base,
    contract: { summary, taskIds, allowedFiles },
    changes,
    checkpoint,
    verification: draft.verification,
    claudeReview: draft.claudeReview,
    contractDeviations: draft.contractDeviations,
    safeCommit,
    worktree: { clean: changes.files.length === 0, ahead: base.facts.ahead, behind: base.facts.behind },
    nextAction: draft.nextAction,
  };
}

async function buildContractRequest(root, draft, base) {
  for (const filePath of draft.inputFiles) {
    let info;
    try {
      info = await lstat(path.join(root, filePath));
    } catch {
      info = null;
    }
    if (!info?.isFile()) invalidInput('Every inputFiles entry must be a regular file in the repository');
  }
  const contract = Object.fromEntries(CONTRACT_FIELDS.map((key) => [key, draft.contract[key]]));
  const changes = await collectChanges(root, contract.allowedFiles);
  return {
    schemaVersion: VERSION,
    kind: base.kind,
    channel: 'contract',
    ...base,
    contract,
    contractText: draft.contractText,
    contractSha256: `sha256:${sha256(draft.contractText)}`,
    openQuestions: draft.openQuestions,
    priorFindings: draft.priorFindings,
    inputs: await collectInputs(root, draft.inputFiles),
    changes,
    worktree: { clean: changes.files.length === 0, ahead: base.facts.ahead, behind: base.facts.behind },
    nextAction: draft.nextAction,
  };
}

// Contract revision n must list exactly the blocking findings of the response to n-1, or
// repeat n-1's findings unchanged when n-1 has no response yet. A finding's round is
// derived from this run's history: findings linked through previousFinding share one
// count, a finding reported again must link to itself, and a third round is refused.
function checkFixRounds(state, draft, revision) {
  if (revision === 1) return;
  const previous = state.requests.get(revision - 1).json.priorFindings;
  const response = state.responses.get(revision - 1)?.json;
  const keys = (items) => JSON.stringify(items.map(({ finding, previousFinding, fixRound }) => [finding, previousFinding, fixRound]));
  if (!response) {
    if (keys(draft.priorFindings) !== keys(previous)) {
      invalidInput('Revision n-1 has no response yet, so priorFindings must repeat its findings unchanged');
    }
    return;
  }
  const open = response.verdict === CHANNELS.contract.passVerdict ? [] : response.blockingFindings;
  const listed = draft.priorFindings.map((item) => item.finding);
  if (new Set(listed).size !== listed.length || listed.length !== new Set(open).size || !open.every((item) => listed.includes(item))) {
    invalidInput('priorFindings must list each blocking finding of the previous response exactly once, and nothing else');
  }
  const rootOf = new Map();
  const maxRound = new Map();
  for (let earlier = 2; earlier < revision; earlier += 1) {
    for (const item of state.requests.get(earlier).json.priorFindings) {
      const root = item.previousFinding === null ? item.finding : rootOf.get(item.previousFinding) ?? item.previousFinding;
      if (!rootOf.has(item.finding)) rootOf.set(item.finding, root);
      maxRound.set(root, Math.max(maxRound.get(root) ?? 0, item.fixRound));
    }
  }
  for (const [position, item] of draft.priorFindings.entries()) {
    const field = `priorFindings[${position}]`;
    if (rootOf.has(item.finding) && item.previousFinding !== item.finding) {
      invalidInput(`${field} was reported before, so previousFinding must be the same finding`);
    }
    if (item.previousFinding !== null && !rootOf.has(item.previousFinding)) {
      invalidInput(`${field}.previousFinding must be a finding listed by an earlier revision of this run`);
    }
    const round = item.previousFinding === null ? 1 : maxRound.get(rootOf.get(item.previousFinding)) + 1;
    if (round > 2) fail('FIX_ROUND_LIMIT', `${field} would be fix round ${round}; stop and report to the user`);
    if (item.fixRound !== round) invalidInput(`${field}.fixRound must be ${round}`);
  }
}

async function publish(root, options) {
  const { stage } = options;
  const ch = CHANNELS[options.channel];
  await ensureIgnored(root, stage, ch);
  const draft = await readDraft(ch, options.input);
  const runDir = await activeRunDir(root, stage, ch);
  return await withLock(runDir, async () => {
    const state = await loadRun(root, stage, ch, { ownLock: true, runId: path.basename(runDir) });
    requireValid(state);
    const revision = state.index.currentRevision + 1;
    if (ch.name === 'implementation') validateRequestDraft(draft, revision);
    else {
      validateContractDraft(draft, revision);
      checkFixRounds(state, draft, revision);
    }
    const facts = await repoFacts(root);
    const base = {
      schemaVersion: VERSION,
      kind: ch.requestKind,
      stageId: stage,
      runId: state.runId,
      revision,
      generatedAt: timestamp(),
      reason: draft.reason,
      previousRequest: revision === 1
        ? null
        : { path: `requests/${requestName(ch, revision - 1)}`, sha256: sha256(state.requests.get(revision - 1).bytes) },
      repo: { branch: facts.branch, upstream: facts.upstream, baselineHead: state.index.baselineHead, currentHead: facts.head },
      facts,
    };
    const built = ch.name === 'implementation'
      ? await buildImplementationRequest(root, draft, base)
      : await buildContractRequest(root, draft, base);
    // Key order follows the channel's record schema; `facts` is not part of the record.
    const request = Object.fromEntries(ch.requestKeys.map((key) => [key, built[key]]));
    const bytes = guardOutput(ch, request);
    const requestsDir = path.join(runDir, 'requests');
    await publishImmutable(requestsDir, requestName(ch, revision), bytes, 'REQUEST_EXISTS');
    const requestSha256 = sha256(bytes);
    await writeIndex(runDir, {
      ...state.index,
      currentRevision: revision,
      currentRequestPath: `requests/${requestName(ch, revision)}`,
      currentRequestSha256: requestSha256,
      updatedAt: timestamp(),
    });
    return {
      ok: true,
      command: 'publish',
      channel: ch.name,
      status: 'published',
      stageId: stage,
      runId: state.runId,
      runDir: repoRelative(root, runDir),
      revision,
      requestPath: repoRelative(root, path.join(requestsDir, requestName(ch, revision))),
      requestSha256,
      changedFilesDigest: request.changes.changedFilesDigest,
      ...(ch.name === 'contract' ? { inputsDigest: request.inputs.inputsDigest, contractSha256: request.contractSha256 } : {}),
    };
  });
}

async function respond(root, options) {
  const { stage } = options;
  const ch = CHANNELS[options.channel];
  await ensureIgnored(root, stage, ch);
  const draft = await readDraft(ch, options.input);
  validateResponseDraft(ch, draft);
  const runDir = await activeRunDir(root, stage, ch);
  return await withLock(runDir, async () => {
    const state = await loadRun(root, stage, ch, { ownLock: true, runId: path.basename(runDir) });
    requireValid(state);
    const current = state.index.currentRevision;
    if (current === 0 || options.revision !== current) {
      fail('NOT_CURRENT_REVISION', `Revision ${options.revision} is not the current request (current: ${current})`);
    }
    if (state.responses.has(current)) fail('RESPONSE_EXISTS', `${responseName(ch, current)} already exists and is never overwritten`);
    const stale = await freshness(root, ch, state.requests.get(current).json);
    if (stale.reasons.length) {
      fail('REQUEST_STALE', 'The request no longer matches the repository; ask for a new request revision', { reasons: publicReasons(stale.reasons) });
    }
    const built = {
      schemaVersion: VERSION,
      kind: ch.responseKind,
      channel: ch.name,
      reviewer: 'codex',
      generatedAt: timestamp(),
      source: expectedSource(ch, state, current),
      ...Object.fromEntries(ch.responseDraftKeys.map((key) => [key, draft[key]])),
    };
    const response = Object.fromEntries(ch.responseKeys.map((key) => [key, built[key]]));
    const bytes = guardOutput(ch, response);
    const responsesDir = path.join(runDir, 'responses');
    await publishImmutable(responsesDir, responseName(ch, current), bytes, 'RESPONSE_EXISTS');
    return {
      ok: true,
      command: 'respond',
      channel: ch.name,
      status: 'responded',
      stageId: stage,
      runId: state.runId,
      revision: current,
      responsePath: repoRelative(root, path.join(responsesDir, responseName(ch, current))),
      responseSha256: sha256(bytes),
    };
  });
}

async function verify(root, options) {
  const { stage } = options;
  const ch = CHANNELS[options.channel];
  const result = {
    ok: false,
    command: 'verify',
    channel: ch.name,
    status: null,
    stageId: stage,
    runId: null,
    runDir: null,
    revision: null,
    currentRevision: null,
    request: null,
    response: null,
    plan: null,
    nextGate: null,
    reasons: [],
    notices: [],
  };
  const reasons = [];
  try {
    await ensureIgnored(root, stage, ch);
  } catch (error) {
    if (!(error instanceof HandoffError)) throw error;
    reasons.push({ severity: 'invalid', code: error.code, detail: error.message });
  }
  const state = await loadRun(root, stage, ch);
  reasons.push(...state.reasons);
  result.runId = state.runId;
  result.runDir = state.runDir && repoRelative(root, state.runDir);
  const current = state.index?.currentRevision ?? null;
  result.currentRevision = current;
  const intact = !reasons.some((reason) => reason.severity !== 'stale');
  if (current === 0) reasons.push({ severity: 'unavailable', code: 'NO_REQUEST', detail: 'No request has been published' });
  if (current > 0) {
    const revision = options.revision ?? current;
    result.revision = revision;
    if (revision > current) reasons.push({ severity: 'invalid', code: 'NO_SUCH_REVISION', detail: `Current revision is ${current}` });
    else {
      if (revision !== current) reasons.push({ severity: 'stale', code: 'NOT_CURRENT_REVISION', detail: `Current revision is ${current}` });
      const request = state.requests.get(revision);
      result.request = request
        ? { path: repoRelative(root, path.join(state.runDir, 'requests', requestName(ch, revision))), sha256: sha256(request.bytes), intact }
        : { path: null, sha256: null, intact: false };
      const response = state.responses.get(revision);
      result.response = {
        path: response ? repoRelative(root, path.join(state.runDir, 'responses', responseName(ch, revision))) : null,
        present: Boolean(response),
        verdict: response?.json.verdict ?? null,
        bindingOk: response ? response.bindingOk : null,
      };
      if (request && intact) {
        const live = await freshness(root, ch, request.json);
        reasons.push(...live.reasons);
        result.plan = live.plan;
        result.notices = request.json.changes.files
          .filter((file) => !file.inScope)
          .map((file) => ({ code: 'OUT_OF_SCOPE_CHANGES', detail: file.path }));
      }
    }
  }
  const severities = new Set(reasons.map((reason) => reason.severity));
  result.status = ['unavailable', 'invalid', 'stale'].find((severity) => severities.has(severity)) ?? 'valid';
  result.ok = result.status === 'valid';
  result.reasons = publicReasons(reasons);
  if (result.ok) {
    // The next workflow gate. A contract OK still needs the user's own approval.
    const verdict = result.response.verdict;
    if (verdict === null) result.nextGate = 'awaiting_codex_response';
    else if (verdict === ch.passVerdict) result.nextGate = ch.passGate;
    else result.nextGate = 'stopped_on_codex_verdict';
    if (ch.name === 'contract' && verdict === 'OK') {
      result.notices.push({ code: 'USER_APPROVAL_REQUIRED', detail: 'Codex OK is not approval; the user must approve the Stage Contract' });
    }
  } else result.message = UNAVAILABLE_MESSAGE;
  return result;
}

async function main() {
  const command = process.argv[2] ?? null;
  let channel = null;
  try {
    const options = parseArgs(process.argv.slice(2));
    channel = options.channel;
    const root = await discoverRoot();
    const handlers = { init, publish, respond, verify };
    const result = await handlers[options.command](root, options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const known = error instanceof HandoffError;
    const output = {
      ok: false,
      command,
      channel,
      code: known ? error.code : 'INTERNAL',
      message: error?.message ?? String(error),
      ...(known ? error.extra : {}),
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = known && error.code === 'USAGE' ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
