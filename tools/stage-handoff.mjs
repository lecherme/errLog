#!/usr/bin/env node

// Cross-agent review handoff. Claude publishes immutable review requests and Codex writes
// immutable responses under the Git-ignored .agent-handoffs/ directory, in three separate
// channels: `contract` (a Stage Contract draft, before the user approves it),
// `implementation` (a finished stage, before its task checkbox), and `delivery` (the
// commit and push gates, as one append-only chain of records). The tool only reads Git
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
const READ_ONLY_GIT = new Set(['rev-parse', 'status', 'rev-list', 'check-ignore', 'ls-files', 'diff-tree', 'cat-file', 'config']);
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
  // Own layout and record shapes; see the delivery section below.
  delivery: {
    name: 'delivery',
    subdir: ['delivery'],
    requestSuffix: 'delivery-record',
    responseSuffix: 'delivery-record',
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
  if (args[0] === 'config' && !(args.length === 3 && args[1] === '--get' && /^branch\..+\.(?:remote|merge)$/u.test(args[2]))) {
    fail('INTERNAL', 'Only git config --get branch.<b>.remote|merge is allowed');
  }
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
    else if (arg === '--kind' && command === 'publish' && hasValue) options.kind = argv[++index];
    else fail('USAGE', `Unknown or incomplete option: ${arg}`);
  }
  if (!Object.hasOwn(CHANNELS, options.channel)) fail('USAGE', '--channel must be one of: implementation, contract, delivery');
  if (options.kind !== undefined && options.channel !== 'delivery') fail('USAGE', '--kind is only valid for publish --channel delivery');
  if (command === 'publish' && options.channel === 'delivery' && !DELIVERY_PUBLISH_KINDS.includes(options.kind)) {
    fail('USAGE', `publish --channel delivery requires --kind ${DELIVERY_PUBLISH_KINDS.join('|')}`);
  }
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
export async function publishImmutable(dir, name, bytes, existsCode) {
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

// ---------------------------------------------------------------------------------------
// Delivery channel (H3). One run is a single append-only chain of records under
// <stage>/delivery/runs/<run>/records/: commit-ready -> codex-commit-review ->
// commit-result -> push-ready -> codex-push-review -> push-result. Every fact is computed
// by the tool from Git and safe-commit inspect. No record approves anything: commit and
// push stay separate user-approved safe-commit commands that this tool never runs. Push
// endpoints appear only as the hash safe-commit inspect reports; this tool never sees a URL.

const DELIVERY_PUBLISH_KINDS = ['commit-ready', 'commit-result', 'push-ready', 'push-result'];
const REVIEW_KIND = { 'commit-ready': 'codex-commit-review', 'push-ready': 'codex-push-review' };
const RECORD_PATTERN = /^(\d{4})-(commit-ready|codex-commit-review|commit-result|push-ready|codex-push-review|push-result)\.json$/u;
const DELIVERY_INDEX_KEYS = [
  'schemaVersion', 'channel', 'stageId', 'runId', 'priorRunId', 'baselineHead',
  'currentSequence', 'currentRecordPath', 'currentRecordSha256', 'updatedAt',
];
const RECORD_BASE_KEYS = ['schemaVersion', 'kind', 'channel', 'recordKind', 'stageId', 'runId', 'sequence', 'generatedAt', 'previousRecord'];
const RECORD_KEYS = {
  'commit-ready': [
    'reason', 'implementation', 'repo', 'worktree', 'plan', 'policySha256', 'manifest', 'closure',
    'reviewFingerprint', 'inheritedReview', 'priorFindings', 'nextAction',
  ],
  'commit-result': ['commitReady', 'review', 'commit', 'entries', 'plan', 'worktree', 'repo', 'nextAction'],
  'push-ready': [
    'reason', 'commitResult', 'commitSha', 'plan', 'target', 'intent', 'repo', 'worktree', 'policySha256',
    'priorFindings', 'nextAction',
  ],
  'push-result': ['pushReady', 'review', 'commitSha', 'push', 'repo', 'worktree', 'ci', 'nextAction'],
  'codex-commit-review': ['reviewer', 'source', ...CHANNELS.implementation.responseDraftKeys],
  'codex-push-review': ['reviewer', 'source', ...CHANNELS.implementation.responseDraftKeys],
};
const COMMIT_READY_REASONS = ['initial', 'plan_refresh', 'delivery_fix', 'targeted_fix'];
const PUSH_READY_REASONS = ['initial', 'push_retry', 'push_fix'];
const MANIFEST_KINDS = { 100644: 'blob', 100755: 'executable', 120000: 'symlink' };
const PASS_NOTICE = { code: 'CODEX_PASS_IS_NOT_APPROVAL', detail: 'Codex PASS is not approval; the user must approve this gate explicitly' };
const recordName = (sequence, kind) => `${String(sequence).padStart(4, '0')}-${kind}.json`;
const recordRef = (rec) => ({ path: `records/${recordName(rec.sequence, rec.kind)}`, sha256: sha256(rec.bytes) });

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Q1 review equivalence: everything a commit review judges. Only the plan's identity and
// timing (planId, createdAt, expiresAt, state) are left out, so they are not parameters.
export const FINGERPRINT_KEYS = [
  'branch', 'head', 'policyHash', 'policySha256', 'files', 'manifest', 'ignoredFiles', 'commitMessage',
  'changedFilesDigest', 'closure', 'implementationRequestSha256', 'implementationResponseSha256',
];

export function reviewFingerprint(parts) {
  return sha256(canonicalJson(Object.fromEntries(FINGERPRINT_KEYS.map((key) => [key, parts[key]]))));
}

// The stage state lives only in the checkpoint's own section: exactly one unfenced
// "## Implementation Checkpoint" heading, up to the next unfenced "## " heading, with
// exactly one unfenced "- stageState: <value>" line. Fenced text (an embedded contract)
// and the same words elsewhere in the file never count.
export function parseCheckpointState(content) {
  let fence = null;
  let sections = 0;
  let inSection = false;
  const states = [];
  for (const line of content.split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      continue;
    }
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }
    if (line.startsWith('## ')) {
      inSection = line.trimEnd() === '## Implementation Checkpoint';
      if (inSection) sections += 1;
      continue;
    }
    const state = inSection ? /^- stageState: (\S.*)$/u.exec(line.trimEnd()) : null;
    if (state) states.push(state[1]);
  }
  if (sections !== 1 || states.length !== 1) return { error: 'CHECKPOINT_AMBIGUOUS' };
  return { stageState: states[0] };
}

// safe-commit inspect, including the binding facts this channel depends on. A missing or
// malformed binding is reported by field name; nothing is recomputed in its place.
async function inspectPlan(root, planId) {
  const cli = path.join(import.meta.dirname, 'safe-commit.mjs');
  const result = await run(process.execPath, [cli, 'inspect', '--plan', planId, '--json'], { cwd: root });
  let output = null;
  try {
    output = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    // Treated as a missing plan below.
  }
  if (!output?.ok) fail('PLAN_MISSING', 'safe-commit inspect does not know this plan');
  const binding = output.binding;
  const objectId = (value) => typeof value === 'string' && /^[0-9a-f]{40,64}$/u.test(value);
  const fields = [];
  if (!isObject(binding)) fields.push('binding');
  else {
    if (!objectId(binding.head)) fields.push('binding.head');
    if (!HEX64.test(binding.policyHash ?? '')) fields.push('binding.policyHash');
    if (!Array.isArray(binding.indexEntries) || binding.indexEntries.some((entry) => !isObject(entry)
      || typeof entry.path !== 'string' || !/^\d{6}$/u.test(entry.mode ?? '') || !objectId(entry.hash))) fields.push('binding.indexEntries');
    if (binding.approvedTree !== null && !objectId(binding.approvedTree)) fields.push('binding.approvedTree');
    const endpoint = binding.endpoint;
    if (!isObject(endpoint) || !(endpoint.sha256 === null ? typeof endpoint.error === 'string' : HEX64.test(endpoint.sha256 ?? '') && endpoint.error === null)) {
      fields.push('binding.endpoint');
    }
    const push = binding.push;
    if (push !== null && !(isObject(push) && ['attempted', 'pushed', 'verified'].includes(push.state) && HEX64.test(push.endpointSha256 ?? '')
      && typeof push.targetRef === 'string' && objectId(push.commitSha) && typeof push.trackingRef === 'string'
      && (push.remoteSha === null || objectId(push.remoteSha)))) fields.push('binding.push');
    if (!Number.isInteger(binding.clearedAttempts) || binding.clearedAttempts < 0) fields.push('binding.clearedAttempts');
  }
  if (fields.length) fail('PLAN_BINDING_UNAVAILABLE', 'safe-commit inspect returned no usable binding; nothing was written', { fields });
  return output;
}

async function policySha256(root) {
  try {
    return `sha256:${sha256(await readRegularFile(path.join(root, '.safe-commit.json')))}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function protectedBranches(root) {
  try {
    const policy = JSON.parse((await readRegularFile(path.join(root, '.safe-commit.json'))).toString('utf8'));
    if (Array.isArray(policy.protectedBranches)) return policy.protectedBranches;
  } catch {
    // safe-commit's default list applies when the policy file is missing or unreadable.
  }
  return ['main', 'master', 'trunk'];
}

async function configValue(root, branch, key) {
  const result = await git(root, ['config', '--get', `branch.${branch}.${key}`], { allowFailure: true });
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

async function revParse(root, ...args) {
  const result = await git(root, ['rev-parse', ...args], { allowFailure: true });
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

function buildManifest(planFiles, indexEntries) {
  const byPath = new Map(indexEntries.map((entry) => [entry.path, entry]));
  const entries = planFiles.map(({ path: filePath, status }) => {
    const entry = byPath.get(filePath);
    const item = entry
      ? { path: filePath, status, kind: MANIFEST_KINDS[entry.mode], mode: entry.mode, blobId: entry.hash }
      : { path: filePath, status, kind: 'deleted', mode: '000000', blobId: null };
    if (!item.kind) fail('MANIFEST_INCONSISTENT', `${filePath} has an unsupported Git mode`);
    if (!status.includes('R') && (item.kind === 'deleted') !== status.includes('D')) {
      fail('MANIFEST_INCONSISTENT', `${filePath}: plan status ${status} does not match its index entry; nothing was written`);
    }
    return item;
  });
  entries.sort(byPathBytes);
  return { entries, manifestSha256: sha256(canonicalJson(entries)) };
}

// Closure delta (B1): after the implementation review only the checkpoint and its sibling
// tasks.md may change, and tasks.md only by checking this stage's task boxes.
async function checkClosure(root, request, plan, implementationChangedCode) {
  const reviewed = new Map(request.changes.files.filter((file) => file.inScope).map((file) => [file.path, file.sha256]));
  const checkpointPath = request.checkpoint.path;
  const tasksPath = checkpointPath === null ? null : path.posix.join(path.posix.dirname(checkpointPath), 'tasks.md');
  const allowed = checkpointPath === null ? [] : [checkpointPath, tasksPath];
  const planPaths = plan.files.map((file) => file.path);
  const closureFiles = allowed.filter((file) => planPaths.includes(file)).sort();
  const expected = new Set([...reviewed.keys(), ...closureFiles]);
  if (planPaths.length !== expected.size || !planPaths.every((file) => expected.has(file))) {
    fail('POST_REVIEW_CHANGES', 'The plan files differ from the reviewed files plus the closure files; nothing was written');
  }
  for (const [filePath, reviewedHash] of reviewed) {
    if (allowed.includes(filePath)) continue;
    if ((await contentOf(root, filePath)) !== reviewedHash) {
      fail(implementationChangedCode, `${filePath} changed after the implementation review; nothing was written`);
    }
  }
  let checkedTaskIds = [];
  if (closureFiles.includes(tasksPath)) {
    const current = (await readRegularFile(path.join(root, tasksPath))).toString('utf8');
    const escape = (id) => id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    let reverted = current;
    for (const id of request.contract.taskIds) {
      if (!new RegExp(`^- \\[x\\] ${escape(id)} `, 'mu').test(current)) fail('POST_REVIEW_CHANGES', `Task ${id} is not checked in ${tasksPath}`);
      reverted = reverted.replace(new RegExp(`^- \\[x\\] (${escape(id)} )`, 'gmu'), '- [ ] $1');
    }
    let baseline = reviewed.get(tasksPath);
    if (!baseline) {
      const blob = await git(root, ['cat-file', 'blob', `HEAD:${tasksPath}`], { allowFailure: true });
      baseline = blob.code === 0 ? `sha256:${sha256(blob.stdout)}` : null;
    }
    if (`sha256:${sha256(reverted)}` !== baseline) {
      fail('POST_REVIEW_CHANGES', `${tasksPath} changed beyond this stage's checkboxes; nothing was written`);
    }
    checkedTaskIds = [...request.contract.taskIds];
  }
  let checkpoint = null;
  if (checkpointPath !== null) {
    let content;
    try {
      content = (await readRegularFile(path.join(root, checkpointPath))).toString('utf8');
    } catch {
      fail('CHECKPOINT_NOT_READY', `${checkpointPath} is not a readable checkpoint`);
    }
    const parsed = parseCheckpointState(content);
    if (parsed.error) fail(parsed.error, `${checkpointPath} has zero or more than one authoritative checkpoint section or stageState line`);
    if (parsed.stageState !== 'ready_for_safe_commit') fail('CHECKPOINT_NOT_READY', `${checkpointPath} stageState is not ready_for_safe_commit`);
    checkpoint = { path: checkpointPath, sha256: `sha256:${sha256(content)}`, stageState: parsed.stageState };
  }
  return {
    reviewedFiles: [...reviewed].map(([filePath, hash]) => ({ path: filePath, sha256: hash })).sort(byPathBytes),
    closureFiles,
    checkedTaskIds,
    checkpoint,
  };
}

// The implementation request and PASS response a commit-ready binds.
async function implementationPass(root, stage, ref) {
  const impl = await loadRun(root, stage, CHANNELS.implementation);
  const usable = impl.runId === ref.runId && !impl.reasons.some((reason) => reason.severity === 'invalid' || reason.severity === 'unavailable');
  const request = usable ? impl.requests.get(ref.revision) : null;
  const response = usable ? impl.responses.get(ref.revision) : null;
  if (!request || !response || response.json.verdict !== 'PASS' || !response.bindingOk) {
    fail('IMPLEMENTATION_NOT_PASS', 'The bound implementation revision has no valid Codex PASS in the latest implementation run');
  }
  const runRelative = (dir, name) => repoRelative(root, path.join(impl.runDir, dir, name));
  return {
    request: request.json,
    ref: {
      runId: ref.runId,
      revision: ref.revision,
      requestPath: runRelative('requests', requestName(CHANNELS.implementation, ref.revision)),
      requestSha256: sha256(request.bytes),
      responsePath: runRelative('responses', responseName(CHANNELS.implementation, ref.revision)),
      responseSha256: sha256(response.bytes),
    },
  };
}

async function computeCommitReady(root, stage, draft, { implementationChangedCode = 'POST_REVIEW_CHANGES' } = {}) {
  const { request, ref } = await implementationPass(root, stage, draft.implementation);
  const plan = await inspectPlan(root, draft.planId);
  if (plan.state !== 'ready') fail('PLAN_CONSUMED', `Plan state is ${plan.state}`);
  const secondsRemaining = Math.floor((Date.parse(plan.expiresAt) - Date.now()) / 1000);
  if (!(secondsRemaining > 0)) fail('PLAN_EXPIRED', `Plan expired at ${plan.expiresAt}`);
  const facts = await repoFacts(root);
  if (facts.head !== request.repo.currentHead || facts.head !== plan.binding.head) {
    fail('HEAD_CHANGED', 'HEAD differs from the implementation review or the plan; nothing was written');
  }
  const closure = await checkClosure(root, request, plan, implementationChangedCode);
  const changes = await collectChanges(root, plan.files.map((file) => file.path));
  const policy = await policySha256(root);
  const manifest = buildManifest(plan.files, plan.binding.indexEntries);
  const fingerprint = reviewFingerprint({
    branch: facts.branch,
    head: plan.binding.head,
    policyHash: plan.binding.policyHash,
    policySha256: policy,
    files: plan.files,
    manifest,
    ignoredFiles: plan.ignoredFiles,
    commitMessage: plan.commitMessage,
    changedFilesDigest: changes.changedFilesDigest,
    closure,
    implementationRequestSha256: ref.requestSha256,
    implementationResponseSha256: ref.responseSha256,
  });
  return {
    implementation: ref,
    repo: { branch: facts.branch, upstream: facts.upstream, head: facts.head, ahead: facts.ahead, behind: facts.behind },
    worktree: changes,
    plan: {
      planId: draft.planId,
      state: plan.state,
      expiresAt: plan.expiresAt,
      secondsRemaining,
      files: plan.files,
      ignoredFiles: plan.ignoredFiles,
      commitMessage: plan.commitMessage,
      commitMessageSha256: sha256(plan.commitMessage ?? ''),
      binding: { head: plan.binding.head, policyHash: plan.binding.policyHash, indexEntries: plan.binding.indexEntries },
    },
    policySha256: policy,
    manifest,
    closure,
    reviewFingerprint: fingerprint,
  };
}

// diff-tree entries of a commit against its parent: [{ path, status, mode, blobId }].
async function commitEntries(root, parent, commit) {
  const { stdout } = await git(root, ['diff-tree', '-r', '--raw', '--no-renames', '-z', parent, commit]);
  const tokens = stdout.toString('utf8').split('\0');
  const entries = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const [, , newMode, , newBlob, status] = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/u.exec(tokens[index]) ?? [];
    if (!status) fail('GIT_FAILED', 'Unexpected diff-tree output');
    entries.push({ path: tokens[index + 1], status, mode: newMode, blobId: status === 'D' ? null : newBlob });
  }
  return entries.sort(byPathBytes);
}

async function computeCommitResult(root, records) {
  const readyRec = records.findLast((rec) => rec.kind === 'commit-ready');
  const last = records.at(-1);
  const ready = readyRec.json;
  const plan = await inspectPlan(root, ready.plan.planId);
  if (plan.state !== 'committed' || !plan.commitSha) fail('PLAN_NOT_COMMITTED', 'The approved plan has not been committed by safe-commit');
  const head = await revParse(root, '--verify', 'HEAD');
  if (head !== plan.commitSha) fail('HEAD_CHANGED', 'HEAD is not the commit safe-commit recorded for this plan');
  const parents = (await gitText(root, ['rev-list', '--parents', '-n', '1', head])).split(' ');
  if (parents.length !== 2 || parents[1] !== ready.repo.head) fail('COMMIT_ENTRY_MISMATCH', 'The commit is not a single-parent child of the reviewed HEAD');
  const entries = await commitEntries(root, parents[1], head);
  const expected = ready.manifest.entries;
  const category = (status) => (status.includes('?') || status.includes('A') ? 'A' : 'M');
  const matches = entries.length === expected.length && expected.every((item, index) => {
    const actual = entries[index];
    if (actual.path !== item.path) return false;
    if (item.kind === 'deleted') return actual.status === 'D';
    const actualCategory = actual.status === 'T' ? 'M' : actual.status;
    return actualCategory === category(item.status) && actual.mode === item.mode && actual.blobId === item.blobId;
  });
  if (!matches) fail('COMMIT_ENTRY_MISMATCH', 'The committed Git entries differ from the reviewed manifest; nothing was written');
  const tree = await revParse(root, `${head}^{tree}`);
  if (tree !== plan.binding.approvedTree) fail('COMMIT_TREE_MISMATCH', 'The commit tree differs from the approved tree; nothing was written');
  const raw = (await git(root, ['cat-file', 'commit', head])).stdout.toString('utf8');
  const message = raw.slice(raw.indexOf('\n\n') + 2);
  if (message.replace(/\n+$/u, '') !== (ready.plan.commitMessage ?? '').replace(/\n+$/u, '')) {
    fail('COMMIT_MESSAGE_MISMATCH', 'The commit message differs from the approved plan; nothing was written');
  }
  const changes = await collectChanges(root, []);
  const remaining = changes.files.map((file) => file.path).sort();
  const ignored = ready.plan.ignoredFiles.map((file) => file.path).sort();
  if (canonicalJson(remaining) !== canonicalJson(ignored)) {
    fail('WORKTREE_CHANGED', 'The changes left after the commit are not exactly the plan\'s ignored files');
  }
  const facts = await repoFacts(root);
  return {
    commitReady: recordRef(readyRec),
    review: last.kind === 'codex-commit-review'
      ? { ...recordRef(last), inherited: false }
      : { ...ready.inheritedReview, inherited: true },
    commit: { sha: head, parent: parents[1], tree, messageSha256: sha256(ready.plan.commitMessage ?? '') },
    entries,
    plan: { planId: ready.plan.planId, state: plan.state },
    worktree: changes,
    repo: { ahead: facts.ahead, behind: facts.behind },
  };
}

async function computePushReady(root, records) {
  const resultRec = records.findLast((rec) => rec.kind === 'commit-result');
  const commitSha = resultRec.json.commit.sha;
  const planId = resultRec.json.plan.planId;
  const plan = await inspectPlan(root, planId);
  const head = await revParse(root, '--verify', 'HEAD');
  const changes = await collectChanges(root, []);
  if (head !== commitSha || (await revParse(root, `${head}^{tree}`)) !== plan.binding.approvedTree
    || changes.changedFilesDigest !== resultRec.json.worktree.changedFilesDigest) {
    fail('COMMIT_CHANGED', 'HEAD, the commit tree or the worktree differ from the commit-result; nothing was written');
  }
  if (plan.state !== 'committed') fail('PLAN_CONSUMED', `Plan state is ${plan.state}`);
  if (plan.pushed || plan.binding.push) fail('OUT_OF_ORDER', 'This plan was already pushed or a push was attempted; use verify-push');
  const branch = await gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = await configValue(root, branch, 'remote');
  const targetRef = await configValue(root, branch, 'merge');
  if (!remote || !targetRef) fail('UPSTREAM_MISSING', `Branch ${branch} has no upstream`);
  if (!targetRef.startsWith('refs/heads/')) fail('INVALID_TARGET_REF', 'The upstream target is not a refs/heads/<branch> ref');
  const targetBranch = targetRef.slice('refs/heads/'.length);
  if ((await protectedBranches(root)).includes(targetBranch)) fail('PROTECTED_BRANCH', 'The upstream target branch is protected');
  if (plan.binding.endpoint.error) fail(plan.binding.endpoint.error, 'safe-commit cannot resolve a single usable push endpoint');
  const trackingRef = await revParse(root, '--symbolic-full-name', '@{upstream}');
  if (trackingRef !== `refs/remotes/${remote}/${targetBranch}`) fail('UNSUPPORTED_UPSTREAM', 'The upstream tracking ref is not refs/remotes/<remote>/<branch>');
  const trackingSha = await revParse(root, '--verify', trackingRef);
  const ahead = (await gitText(root, ['rev-list', `${trackingRef}..HEAD`])).split('\n').filter(Boolean);
  if (ahead.length !== 1 || ahead[0] !== commitSha) fail('AHEAD_NOT_SINGLE', 'Exactly the reviewed commit must be ahead of the upstream');
  const behind = Number(await gitText(root, ['rev-list', '--count', `HEAD..${trackingRef}`]));
  if (behind !== 0) fail('BEHIND_UPSTREAM', 'The branch is behind its upstream');
  const endpointSha256 = plan.binding.endpoint.sha256;
  return {
    commitResult: recordRef(resultRec),
    commitSha,
    plan: { planId, state: plan.state, pushed: plan.pushed, clearedAttempts: plan.binding.clearedAttempts },
    target: { remote, targetRef, trackingRef, trackingSha, endpointSha256 },
    intent: {
      refspec: `${commitSha}:${targetRef}`,
      force: false,
      command: `node tools/safe-commit.mjs push --plan ${planId} --endpoint-sha256 ${endpointSha256} --target-ref ${targetRef} --json`,
    },
    repo: { ahead: ahead.length, behind },
    worktree: { changedFilesDigest: changes.changedFilesDigest },
    policySha256: await policySha256(root),
  };
}

async function computePushResult(root, records) {
  const readyRec = records.findLast((rec) => rec.kind === 'push-ready');
  const ready = readyRec.json;
  const plan = await inspectPlan(root, ready.plan.planId);
  const push = plan.binding.push;
  if (!plan.pushed || !push || push.state !== 'verified') {
    fail('PUSH_NOT_VERIFIED', 'The push is not recorded as verified by safe-commit; run verify-push first');
  }
  if (push.endpointSha256 !== ready.target.endpointSha256 || plan.binding.endpoint.sha256 !== ready.target.endpointSha256) {
    fail('PUSH_ENDPOINT_CHANGED', 'The pushed, reviewed and current endpoint hashes differ; report this as a delivery anomaly');
  }
  if (push.targetRef !== ready.target.targetRef || push.commitSha !== ready.commitSha) {
    fail('PUSH_TARGET_CHANGED', 'The pushed target or commit differs from the reviewed push-ready; report this as a delivery anomaly');
  }
  if (push.remoteSha !== ready.commitSha) fail('REMOTE_MISMATCH', 'The push endpoint does not hold the reviewed commit');
  const trackingSha = await revParse(root, '--verify', ready.target.trackingRef);
  if (trackingSha !== ready.commitSha) fail('TRACKING_MISMATCH', 'The local tracking ref is not the pushed commit');
  const facts = await repoFacts(root);
  if (facts.ahead !== 0 || facts.behind !== 0) fail('NOT_SYNCED', 'The branch is not in sync with its upstream');
  const workflows = await git(root, ['ls-files', '-z', '--', '.github/workflows/']);
  return {
    pushReady: recordRef(readyRec),
    review: recordRef(records.at(-1)),
    commitSha: ready.commitSha,
    push: { endpointSha256: push.endpointSha256, targetRef: push.targetRef, remoteSha: push.remoteSha, trackingSha },
    repo: { ahead: facts.ahead, behind: facts.behind },
    worktree: await collectChanges(root, []),
    ci: workflows.stdout.length
      ? { status: 'unknown', note: 'Tracked workflows exist; this tool never queries CI, so the status must not be treated as passed.' }
      : { status: 'not_configured', note: 'No tracked .github/workflows/* at HEAD; this tool never queries CI.' },
  };
}

// The next record a run accepts, from its records so far. Returns an error message or null.
function transitionError(records, kind, reason) {
  const last = records.at(-1);
  const verdictOf = (rec) => rec?.json.verdict;
  if (records.some((rec) => rec.kind === 'push-result')) return 'The run is delivered and read-only';
  switch (kind) {
    case 'commit-ready':
      if (records.some((rec) => rec.kind === 'commit-result')) return 'The plan was already committed in this run';
      if (!last) return reason === 'initial' ? null : 'The first record must be a commit-ready with reason initial';
      if (reason === 'initial') return 'Only the first record has reason initial';
      if (!['commit-ready', 'codex-commit-review'].includes(last.kind)) return 'A commit-ready cannot follow this record';
      if (reason === 'plan_refresh') return last.kind === 'codex-commit-review' && verdictOf(last) !== 'PASS' ? 'After FAIL or BLOCKED use delivery_fix or targeted_fix' : null;
      return last.kind === 'codex-commit-review' && verdictOf(last) !== 'PASS' ? null : `${reason} needs a FAIL or BLOCKED commit review`;
    case 'codex-commit-review':
      return last?.kind === 'commit-ready' ? null : 'Only the current commit-ready can be reviewed';
    case 'commit-result':
      if (last?.kind === 'codex-commit-review' && verdictOf(last) === 'PASS') return null;
      return last?.kind === 'commit-ready' && last.json.inheritedReview ? null : 'commit-result needs a Codex PASS (direct or inherited) on the current commit-ready';
    case 'push-ready':
      if (reason === 'initial') return last?.kind === 'commit-result' ? null : 'push-ready with reason initial must follow commit-result';
      if (last?.kind !== 'codex-push-review') return `${reason} must follow a Codex push review`;
      if (reason === 'push_retry') return verdictOf(last) === 'PASS' ? null : 'After FAIL or BLOCKED use push_fix';
      return verdictOf(last) !== 'PASS' ? null : 'push_fix needs a FAIL or BLOCKED push review';
    case 'codex-push-review':
      return last?.kind === 'push-ready' ? null : 'Only the current push-ready can be reviewed';
    case 'push-result':
      return last?.kind === 'codex-push-review' && verdictOf(last) === 'PASS' ? null : 'push-result needs a Codex PASS on the current push-ready';
    default:
      return 'Unknown record kind';
  }
}

// delivery_fix and push_fix list the previous review's blocking findings verbatim; rounds
// are derived along the commit-ready or push-ready chain, and a third round is refused.
function checkDeliveryFixRounds(records, kind, draft) {
  const isFix = ['delivery_fix', 'push_fix'].includes(draft.reason);
  if (!isFix) {
    if (draft.priorFindings.length) invalidInput('priorFindings must be empty unless the reason is delivery_fix or push_fix');
    return;
  }
  const open = records.at(-1).json.blockingFindings;
  const listed = draft.priorFindings.map((item) => item.finding);
  if (!listed.length || new Set(listed).size !== listed.length || listed.length !== new Set(open).size || !open.every((item) => listed.includes(item))) {
    invalidInput('priorFindings must list each blocking finding of the previous review exactly once, and nothing else');
  }
  const rootOf = new Map();
  const maxRound = new Map();
  for (const rec of records.filter((item) => item.kind === kind)) {
    for (const item of rec.json.priorFindings) {
      const origin = item.previousFinding === null ? item.finding : rootOf.get(item.previousFinding) ?? item.previousFinding;
      if (!rootOf.has(item.finding)) rootOf.set(item.finding, origin);
      maxRound.set(origin, Math.max(maxRound.get(origin) ?? 0, item.fixRound));
    }
  }
  for (const [position, item] of draft.priorFindings.entries()) {
    const field = `priorFindings[${position}]`;
    if (rootOf.has(item.finding) && item.previousFinding !== item.finding) invalidInput(`${field} was reported before, so previousFinding must be the same finding`);
    if (item.previousFinding !== null && !rootOf.has(item.previousFinding)) invalidInput(`${field}.previousFinding must be a finding listed earlier in this chain`);
    const round = item.previousFinding === null ? 1 : maxRound.get(rootOf.get(item.previousFinding)) + 1;
    if (round > 2) fail('FIX_ROUND_LIMIT', `${field} would be fix round ${round}; stop and report to the user`);
    if (item.fixRound !== round) invalidInput(`${field}.fixRound must be ${round}`);
  }
}

function validatePriorFindings(value) {
  list(value, 'priorFindings', (item, field) => {
    expectKeys(item, ['finding', 'previousFinding', 'fixRound', 'resolution'], field);
    text(item.finding, `${field}.finding`);
    if (item.previousFinding !== null) text(item.previousFinding, `${field}.previousFinding`);
    if (item.fixRound !== 1 && item.fixRound !== 2) invalidInput(`${field}.fixRound must be 1 or 2`);
    text(item.resolution, `${field}.resolution`);
  });
}

function validateDeliveryDraft(kind, draft) {
  if (kind === 'commit-ready') {
    expectKeys(draft, ['reason', 'implementation', 'planId', 'priorFindings', 'nextAction'], 'input');
    oneOf(draft.reason, COMMIT_READY_REASONS, 'reason');
    expectKeys(draft.implementation, ['runId', 'revision'], 'implementation');
    if (!RUN_PATTERN.test(draft.implementation.runId ?? '')) invalidInput('implementation.runId must be a run ID');
    if (!Number.isInteger(draft.implementation.revision) || draft.implementation.revision < 1) invalidInput('implementation.revision must be a positive integer');
    if (!HEX64.test(draft.planId ?? '')) invalidInput('planId must be a 64-hex plan ID');
    validatePriorFindings(draft.priorFindings);
  } else if (kind === 'push-ready') {
    expectKeys(draft, ['reason', 'priorFindings', 'nextAction'], 'input');
    oneOf(draft.reason, PUSH_READY_REASONS, 'reason');
    validatePriorFindings(draft.priorFindings);
  } else expectKeys(draft, ['nextAction'], 'input');
  text(draft.nextAction, 'nextAction');
}

function validateDeliveryIndex(index, stage, runId) {
  expectKeys(index, DELIVERY_INDEX_KEYS, 'index.json');
  const current = index.currentSequence;
  const ok = index.schemaVersion === VERSION
    && index.channel === 'delivery'
    && index.stageId === stage
    && index.runId === runId
    && (index.priorRunId === null || RUN_PATTERN.test(index.priorRunId))
    && /^[0-9a-f]{40,64}$/u.test(index.baselineHead)
    && Number.isInteger(current) && current >= 0
    && (current === 0
      ? index.currentRecordPath === null && index.currentRecordSha256 === null
      : RECORD_PATTERN.exec(index.currentRecordPath?.replace(/^records\//u, '') ?? '')?.[1] === String(current).padStart(4, '0')
        && index.currentRecordPath.startsWith('records/') && HEX64.test(index.currentRecordSha256))
    && typeof index.updatedAt === 'string';
  if (!ok) invalidInput('index.json fields are inconsistent');
}

// Structural checks of the active delivery run; reasons carry a severity like loadRun's.
async function loadDelivery(root, stage, { ownLock = false, runId = null } = {}) {
  const ch = CHANNELS.delivery;
  const reasons = [];
  const add = (severity, code, detail) => reasons.push({ severity, code, detail });
  const state = { reasons, runId: null, runDir: null, index: null, records: [] };
  let runs;
  try {
    runs = await listRuns(layout(root, stage, ch));
  } catch (error) {
    if (!(error instanceof HandoffError)) throw error;
    add('invalid', error.code, error.message);
    return state;
  }
  if (!runs.length) {
    add('unavailable', 'MISSING', `No delivery handoff exists for stage ${stage}`);
    return state;
  }
  if (runId && runs.at(-1) !== runId) add('stale', 'RUN_CHANGED', `A newer run ${runs.at(-1)} exists`);
  state.runId = runId ?? runs.at(-1);
  state.runDir = path.join(layout(root, stage, ch).runsDir, state.runId);
  try {
    await inspectDeliveryRun(state, stage, ownLock, add);
  } catch (error) {
    if (!(error instanceof HandoffError)) throw error;
    add('invalid', error.code === 'INPUT_INVALID' ? 'SCHEMA_INVALID' : error.code, error.message);
  }
  return state;
}

async function inspectDeliveryRun(state, stage, ownLock, add) {
  const { runDir, runId } = state;
  for (const name of await readdir(runDir)) {
    if (name === 'index.json') continue;
    if (name === 'records') await plainDirectory(path.join(runDir, name));
    else if (name === '.lock') {
      if (!ownLock) add('stale', 'LOCK_PRESENT', 'A writer is active or a write was interrupted');
    } else if (name.startsWith('.index.tmp-')) add('stale', 'ORPHAN_TEMP_FILE', name);
    else add('invalid', 'UNEXPECTED_ENTRY', name);
  }
  const recordsDir = path.join(runDir, 'records');
  if (!(await plainDirectory(recordsDir))) return add('invalid', 'SCHEMA_INVALID', 'records/ is missing');
  let index;
  try {
    index = JSON.parse((await readRegularFile(path.join(runDir, 'index.json'))).toString('utf8'));
  } catch (error) {
    if (error instanceof HandoffError) throw error;
    return add('invalid', 'SCHEMA_INVALID', 'index.json is missing or not valid JSON');
  }
  validateDeliveryIndex(index, stage, runId);
  state.index = index;
  const current = index.currentSequence;
  const names = new Map();
  for (const name of await readdir(recordsDir)) {
    const match = RECORD_PATTERN.exec(name);
    if (name.startsWith('.tmp-')) add('stale', 'ORPHAN_TEMP_FILE', `records/${name}`);
    else if (!match || Number(match[1]) < 1 || names.has(Number(match[1]))) add('invalid', 'UNEXPECTED_ENTRY', `records/${name}`);
    else if (Number(match[1]) > current) {
      add(Number(match[1]) === current + 1 ? 'stale' : 'invalid', Number(match[1]) === current + 1 ? 'UNINDEXED_RECORD' : 'UNEXPECTED_ENTRY', `records/${name}`);
    } else names.set(Number(match[1]), { name, kind: match[2] });
  }
  for (let sequence = 1; sequence <= current; sequence += 1) {
    const entry = names.get(sequence);
    if (!entry) return add('invalid', 'CHAIN_BROKEN', `Record ${sequence} is missing`);
    const bytes = await readRegularFile(path.join(recordsDir, entry.name));
    let json;
    try {
      json = JSON.parse(bytes.toString('utf8'));
      expectKeys(json, [...RECORD_BASE_KEYS, ...RECORD_KEYS[entry.kind]], `records/${entry.name}`);
    } catch (error) {
      if (error instanceof HandoffError || error instanceof SyntaxError) return add('invalid', 'SCHEMA_INVALID', `records/${entry.name} is not a valid record`);
      throw error;
    }
    const identity = json.schemaVersion === VERSION && json.kind === 'delivery-record' && json.channel === 'delivery'
      && json.recordKind === entry.kind && json.stageId === stage && json.runId === runId && json.sequence === sequence;
    if (!identity) add('invalid', 'SCHEMA_INVALID', `records/${entry.name} identity fields are inconsistent`);
    const previous = state.records.at(-1);
    if (JSON.stringify(json.previousRecord) !== JSON.stringify(previous ? recordRef(previous) : null)) {
      add('invalid', 'CHAIN_BROKEN', `records/${entry.name} does not match the previous record`);
    }
    const reason = ['commit-ready', 'push-ready'].includes(entry.kind) ? json.reason : null;
    const order = transitionError(state.records, entry.kind, reason);
    if (order) add('invalid', 'OUT_OF_ORDER', `records/${entry.name}: ${order}`);
    if (REVIEW_KIND[previous?.kind] === entry.kind) {
      const bound = isObject(json.source) && json.reviewer === 'codex'
        && json.source.recordPath === recordRef(previous).path && json.source.recordSha256 === recordRef(previous).sha256;
      if (!bound) add('invalid', 'RESPONSE_BINDING_MISMATCH', `records/${entry.name} is not bound to the record it reviews`);
    }
    if (sensitiveRules(json).length) add('invalid', 'SENSITIVE_DATA', `records/${entry.name}`);
    state.records.push({ sequence, kind: entry.kind, bytes, json });
  }
  if (current > 0 && sha256(state.records.at(-1).bytes) !== index.currentRecordSha256) {
    add('invalid', 'HASH_MISMATCH', 'The current record does not match index.json');
  }
}

// Live freshness of a commit-ready or push-ready record, by kind (B14: only commit-ready
// depends on the plan's expiry; a committed plan stays pushable). Returns stale reasons.
async function deliveryFreshness(root, stage, rec) {
  const reasons = [];
  const add = (code, detail) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ severity: 'stale', code, detail });
  };
  const json = rec.json;
  const attempt = async (action) => {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof HandoffError)) throw error;
      add(error.code, error.message);
      return null;
    }
  };
  if (rec.kind === 'commit-ready') {
    const plan = await attempt(() => inspectPlan(root, json.plan.planId));
    if (!plan) return reasons;
    if (plan.state !== 'ready') add('PLAN_CONSUMED', `Plan state is ${plan.state}`);
    else if (Date.now() > Date.parse(plan.expiresAt)) add('PLAN_EXPIRED', `Plan expired at ${plan.expiresAt}`);
    const facts = await repoFacts(root);
    if (facts.head !== json.repo.head) add('HEAD_CHANGED', `HEAD is ${facts.head}`);
    if (facts.upstream !== json.repo.upstream || facts.ahead !== json.repo.ahead || facts.behind !== json.repo.behind) add('UPSTREAM_CHANGED', 'The upstream changed');
    const changes = await collectChanges(root, json.plan.files.map((file) => file.path));
    if (changes.changedFilesDigest !== json.worktree.changedFilesDigest) add('DIGEST_CHANGED', 'The changed files differ from the record');
    const contentByPath = (files) => canonicalJson(files.filter((file) => file.inScope).map(({ path: filePath, sha256: hash }) => [filePath, hash]));
    if (canonicalJson(plan.files) !== canonicalJson(json.plan.files) || contentByPath(changes.files) !== contentByPath(json.worktree.files)) {
      add('FILES_CHANGED', 'A planned file changed');
    }
    if ((await policySha256(root)) !== json.policySha256) add('POLICY_CHANGED', '.safe-commit.json changed');
    const binding = { head: plan.binding.head, policyHash: plan.binding.policyHash, indexEntries: plan.binding.indexEntries };
    if (canonicalJson(binding) !== canonicalJson(json.plan.binding)) add('FINGERPRINT_CHANGED', 'The plan binding changed');
    const implementationChangedCode = json.reason === 'delivery_fix' ? 'IMPLEMENTATION_CHANGED' : 'POST_REVIEW_CHANGES';
    const fresh = await attempt(() => computeCommitReady(root, stage, { implementation: json.implementation, planId: json.plan.planId }, { implementationChangedCode }));
    if (fresh && fresh.reviewFingerprint !== json.reviewFingerprint) add('FINGERPRINT_CHANGED', 'The review fingerprint changed');
    return reasons;
  }
  const plan = await attempt(() => inspectPlan(root, json.plan.planId));
  if (!plan) return reasons;
  if (plan.state !== 'committed' || plan.pushed || plan.binding.push) add('PLAN_CONSUMED', 'The plan is not committed and unpushed');
  // A push attempt cleared by verify-push after this record voids its review: retry only
  // through a new push_retry record, a fresh Codex PASS and a new user approval.
  if (plan.binding.clearedAttempts !== json.plan.clearedAttempts) {
    add('PUSH_ATTEMPT_CLEARED', 'A push attempt was cleared after this push-ready; publish push_retry for a new review');
  }
  if ((await revParse(root, '--verify', 'HEAD')) !== json.commitSha) add('HEAD_CHANGED', 'HEAD is not the reviewed commit');
  const branch = await gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if ((await configValue(root, branch, 'merge')) !== json.target.targetRef || (await configValue(root, branch, 'remote')) !== json.target.remote) {
    add('PUSH_TARGET_CHANGED', 'The upstream remote or target ref changed');
  }
  if ((await revParse(root, '--symbolic-full-name', '@{upstream}')) !== json.target.trackingRef
    || (await revParse(root, '--verify', json.target.trackingRef)) !== json.target.trackingSha) add('UPSTREAM_CHANGED', 'The upstream changed');
  if (plan.binding.endpoint.sha256 !== json.target.endpointSha256) add('PUSH_ENDPOINT_CHANGED', 'The push endpoint changed');
  if ((await collectChanges(root, [])).changedFilesDigest !== json.worktree.changedFilesDigest) add('DIGEST_CHANGED', 'The worktree changed');
  if ((await policySha256(root)) !== json.policySha256) add('POLICY_CHANGED', '.safe-commit.json changed');
  return reasons;
}

async function deliveryInit(root, options) {
  const { stage } = options;
  const ch = CHANNELS.delivery;
  await ensureIgnored(root, stage, ch);
  const paths = layout(root, stage, ch);
  const runs = await listRuns(paths);
  const priorRunId = runs.at(-1) ?? null;
  if (priorRunId && !options.newRun) fail('ACTIVE_RUN_EXISTS', `Stage ${stage} already has delivery run ${priorRunId}; pass --new-run to start another`);
  let runId = newRunId();
  for (let attempt = 0; priorRunId && runId <= priorRunId && attempt < 64; attempt += 1) runId = newRunId();
  if (priorRunId && runId <= priorRunId) fail('RUN_ID_ORDER', 'The clock is behind the latest run ID');
  const baselineHead = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
  await mkdir(paths.runsDir, { recursive: true, mode: 0o700 });
  await listRuns(paths);
  const runDir = path.join(paths.runsDir, runId);
  await mkdir(runDir, { mode: 0o700 });
  await mkdir(path.join(runDir, 'records'), { mode: 0o700 });
  await writeIndex(runDir, {
    schemaVersion: VERSION,
    channel: 'delivery',
    stageId: stage,
    runId,
    priorRunId,
    baselineHead,
    currentSequence: 0,
    currentRecordPath: null,
    currentRecordSha256: null,
    updatedAt: timestamp(),
  });
  return { ok: true, command: 'init', channel: 'delivery', status: 'created', stageId: stage, runId, priorRunId, runDir: repoRelative(root, runDir) };
}

async function appendRecord(root, state, kind, body) {
  const sequence = state.index.currentSequence + 1;
  const previous = state.records.at(-1);
  const record = {
    schemaVersion: VERSION,
    kind: 'delivery-record',
    channel: 'delivery',
    recordKind: kind,
    stageId: state.index.stageId,
    runId: state.runId,
    sequence,
    generatedAt: timestamp(),
    previousRecord: previous ? recordRef(previous) : null,
    ...Object.fromEntries(RECORD_KEYS[kind].map((key) => [key, body[key]])),
  };
  const bytes = guardOutput(CHANNELS.delivery, record);
  const recordsDir = path.join(state.runDir, 'records');
  const name = recordName(sequence, kind);
  await publishImmutable(recordsDir, name, bytes, 'RECORD_EXISTS');
  const recordSha256 = sha256(bytes);
  await writeIndex(state.runDir, {
    ...state.index,
    currentSequence: sequence,
    currentRecordPath: `records/${name}`,
    currentRecordSha256: recordSha256,
    updatedAt: timestamp(),
  });
  return { sequence, recordPath: repoRelative(root, path.join(recordsDir, name)), recordSha256 };
}

async function deliveryPublish(root, options) {
  const { stage, kind } = options;
  const ch = CHANNELS.delivery;
  await ensureIgnored(root, stage, ch);
  const draft = await readDraft(ch, options.input);
  validateDeliveryDraft(kind, draft);
  const runDir = await activeRunDir(root, stage, ch);
  return await withLock(runDir, async () => {
    const state = await loadDelivery(root, stage, { ownLock: true, runId: path.basename(runDir) });
    requireValid(state);
    const { records } = state;
    const order = transitionError(records, kind, draft.reason ?? null);
    if (order) fail('OUT_OF_ORDER', `${order}; nothing was written`);
    checkDeliveryFixRounds(records, kind, { reason: draft.reason, priorFindings: draft.priorFindings ?? [] });
    let body;
    if (kind === 'commit-ready') {
      const previous = records.findLast((rec) => rec.kind === 'commit-ready');
      if (draft.reason === 'plan_refresh') {
        const previousPlan = await inspectPlan(root, previous.json.plan.planId);
        if (previousPlan.state === 'ready' && Date.now() <= Date.parse(previousPlan.expiresAt)) {
          fail('OUT_OF_ORDER', 'The previous plan is still usable; plan_refresh needs an expired or consumed plan');
        }
      }
      const sameImplementation = previous && draft.implementation.runId === previous.json.implementation.runId
        && draft.implementation.revision === previous.json.implementation.revision;
      if (draft.reason === 'delivery_fix' && !sameImplementation) invalidInput('delivery_fix must reuse the implementation PASS of the previous commit-ready');
      if (draft.reason === 'targeted_fix' && (sameImplementation || draft.implementation.revision <= previous.json.implementation.revision
        && draft.implementation.runId === previous.json.implementation.runId)) invalidInput('targeted_fix must bind a newer implementation revision');
      const implementationChangedCode = draft.reason === 'delivery_fix' ? 'IMPLEMENTATION_CHANGED' : 'POST_REVIEW_CHANGES';
      body = await computeCommitReady(root, stage, draft, { implementationChangedCode });
      let inheritedReview = null;
      if (draft.reason === 'plan_refresh') {
        // Q1: inherit only a direct Codex PASS on an earlier commit-ready with the same fingerprint.
        for (const [position, rec] of records.entries()) {
          const review = records[position + 1];
          if (rec.kind === 'commit-ready' && rec.json.inheritedReview === null && rec.json.reviewFingerprint === body.reviewFingerprint
            && review?.kind === 'codex-commit-review' && review.json.verdict === 'PASS') {
            inheritedReview = { record: recordRef(rec).path, responseSha256: sha256(review.bytes), fingerprint: body.reviewFingerprint };
            break;
          }
        }
      }
      body = { ...body, reason: draft.reason, inheritedReview, priorFindings: draft.priorFindings };
    } else if (kind === 'commit-result') body = await computeCommitResult(root, records);
    else if (kind === 'push-ready') body = { ...(await computePushReady(root, records)), reason: draft.reason, priorFindings: draft.priorFindings };
    else body = await computePushResult(root, records);
    const written = await appendRecord(root, state, kind, { ...body, nextAction: draft.nextAction });
    return {
      ok: true,
      command: 'publish',
      channel: 'delivery',
      status: 'published',
      stageId: stage,
      runId: state.runId,
      runDir: repoRelative(root, runDir),
      recordKind: kind,
      ...written,
    };
  });
}

async function deliveryRespond(root, options) {
  const { stage } = options;
  const ch = CHANNELS.delivery;
  await ensureIgnored(root, stage, ch);
  const draft = await readDraft(ch, options.input);
  validateResponseDraft(CHANNELS.implementation, draft);
  const runDir = await activeRunDir(root, stage, ch);
  return await withLock(runDir, async () => {
    const state = await loadDelivery(root, stage, { ownLock: true, runId: path.basename(runDir) });
    requireValid(state);
    const current = state.index.currentSequence;
    if (current === 0 || options.revision !== current) {
      fail('NOT_CURRENT_REVISION', `Record ${options.revision} is not the current record (current: ${current})`);
    }
    const reviewed = state.records.at(-1);
    const kind = REVIEW_KIND[reviewed.kind];
    if (!kind) fail('OUT_OF_ORDER', 'Only the current commit-ready or push-ready record can be reviewed');
    const stale = await deliveryFreshness(root, stage, reviewed);
    if (stale.length) {
      fail('REQUEST_STALE', 'The record no longer matches the repository; ask for a new record', { reasons: publicReasons(stale) });
    }
    const facts = await repoFacts(root);
    const source = {
      recordPath: recordRef(reviewed).path,
      recordSha256: recordRef(reviewed).sha256,
      recordKind: reviewed.kind,
      planId: reviewed.json.plan.planId,
      head: facts.head,
      worktreeDigest: (await collectChanges(root, [])).changedFilesDigest,
    };
    const written = await appendRecord(root, state, kind, { reviewer: 'codex', source, ...draft });
    return {
      ok: true,
      command: 'respond',
      channel: 'delivery',
      status: 'responded',
      stageId: stage,
      runId: state.runId,
      recordKind: kind,
      ...written,
    };
  });
}

// The next gate, from the last record and the plan's live state.
async function deliveryGate(root, stage, records, add, notices) {
  const last = records.at(-1);
  const reviewed = REVIEW_KIND[last.kind] ? last : records.at(-2);
  const passed = last.kind === 'codex-commit-review' || last.kind === 'codex-push-review' ? last.json.verdict === 'PASS' : null;
  if (passed === false) return 'stopped_on_codex_verdict';
  if (last.kind === 'commit-result') return 'awaiting_push_ready';
  if (last.kind === 'push-result') {
    notices.push({ code: 'DELIVERED', detail: 'The run is delivered; only its integrity is checked, not the repository that has moved on' });
    return 'delivered';
  }
  const plan = await inspectPlan(root, reviewed.json.plan.planId).catch((error) => {
    if (error instanceof HandoffError) return null;
    throw error;
  });
  if (reviewed.kind === 'commit-ready') {
    const approved = passed === true || (last.kind === 'commit-ready' && last.json.inheritedReview !== null);
    if (approved && plan?.state === 'committed') return 'awaiting_commit_result';
    const stale = await deliveryFreshness(root, stage, reviewed);
    stale.forEach(add);
    const remaining = plan ? Math.floor((Date.parse(plan.expiresAt) - Date.now()) / 1000) : null;
    if (remaining !== null && remaining < 180) notices.push({ code: 'PLAN_NEAR_EXPIRY', detail: `${Math.max(remaining, 0)} seconds remain; refresh the plan instead of asking for approval` });
    if (!approved) return 'awaiting_codex_commit_review';
    // A stale record has no usable PASS, so it gets no approval gate or notice.
    if (!stale.length) notices.push(PASS_NOTICE);
    return 'awaiting_user_commit_approval';
  }
  if (passed === true && plan && (plan.pushed || plan.binding.push)) {
    return plan.binding.push && plan.binding.push.state !== 'verified' ? 'awaiting_push_verification' : 'awaiting_push_result';
  }
  const stale = await deliveryFreshness(root, stage, reviewed);
  stale.forEach(add);
  if (passed !== true) return 'awaiting_codex_push_review';
  if (!stale.length) notices.push(PASS_NOTICE);
  return 'awaiting_user_push_approval';
}

async function deliveryVerify(root, options) {
  const { stage } = options;
  const ch = CHANNELS.delivery;
  const result = {
    ok: false,
    command: 'verify',
    channel: 'delivery',
    status: null,
    stageId: stage,
    runId: null,
    runDir: null,
    currentSequence: null,
    record: null,
    planSecondsRemaining: null,
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
  const state = await loadDelivery(root, stage);
  reasons.push(...state.reasons);
  result.runId = state.runId;
  result.runDir = state.runDir && repoRelative(root, state.runDir);
  const current = state.index?.currentSequence ?? null;
  result.currentSequence = current;
  const intact = !reasons.some((reason) => reason.severity !== 'stale');
  if (current === 0) reasons.push({ severity: 'unavailable', code: 'NO_RECORD', detail: 'No record has been published' });
  if (current > 0 && state.records.length === current) {
    const last = state.records.at(-1);
    result.record = { path: repoRelative(root, path.join(state.runDir, recordRef(last).path)), sha256: recordRef(last).sha256, recordKind: last.kind };
    if (options.revision !== undefined && options.revision !== current) {
      reasons.push({ severity: options.revision > current ? 'invalid' : 'stale', code: 'NOT_CURRENT_REVISION', detail: `Current record is ${current}` });
    }
    if (intact) {
      const live = [];
      result.nextGate = await deliveryGate(root, stage, state.records, (reason) => live.push(reason), result.notices);
      reasons.push(...live);
      const readyRec = state.records.findLast((rec) => rec.kind === 'commit-ready');
      if (['awaiting_codex_commit_review', 'awaiting_user_commit_approval'].includes(result.nextGate) && readyRec) {
        const plan = await inspectPlan(root, readyRec.json.plan.planId).catch(() => null);
        if (plan) result.planSecondsRemaining = Math.floor((Date.parse(plan.expiresAt) - Date.now()) / 1000);
      }
    }
  }
  const severities = new Set(reasons.map((reason) => reason.severity));
  result.status = ['unavailable', 'invalid', 'stale'].find((severity) => severities.has(severity)) ?? 'valid';
  result.ok = result.status === 'valid';
  result.reasons = publicReasons(reasons);
  if (!result.ok) {
    result.nextGate = null;
    result.message = UNAVAILABLE_MESSAGE;
  }
  return result;
}

async function main() {
  const command = process.argv[2] ?? null;
  let channel = null;
  try {
    const options = parseArgs(process.argv.slice(2));
    channel = options.channel;
    const root = await discoverRoot();
    const handlers = options.channel === 'delivery'
      ? { init: deliveryInit, publish: deliveryPublish, respond: deliveryRespond, verify: deliveryVerify }
      : { init, publish, respond, verify };
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
