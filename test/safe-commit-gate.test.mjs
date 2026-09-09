import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const gate = path.resolve(import.meta.dirname, '..', '.claude', 'hooks', 'safe-commit-gate.mjs');
const plan = 'a'.repeat(64);

function decision(command) {
  const result = spawnSync(process.execPath, [gate], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout === '') return 'defer';
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
}

test('allows only canonical read-only safe-commit commands without prompting', async () => {
  assert.equal(
    await decision('node tools/safe-commit.mjs check --request .git/safe-commit/requests/stage-1.json --json'),
    'defer',
  );
  assert.equal(
    await decision(`node tools/safe-commit.mjs inspect --plan ${plan} --json`),
    'defer',
  );
});

test('asks separately for canonical commit and push commands', async () => {
  assert.equal(
    await decision(`node tools/safe-commit.mjs commit --plan ${plan} --json`),
    'ask',
  );
  assert.equal(
    await decision(`node tools/safe-commit.mjs push --plan ${plan} --json`),
    'ask',
  );
});

test('denies noncanonical safe-commit commands and shell expansions', async () => {
  const commands = [
    `node tools/safe-commit.mjs commit --plan ${plan} --push --json`,
    `node tools/safe-commit.mjs commit --plan ${plan} "--push" --json`,
    `node tools/safe-commit.mjs commit --plan ${plan} --pu\\sh --json`,
    `node tools/safe-commit.mjs commit --plan ${plan} $'--push' --json`,
    `node tools/safe-commit.mjs commit --plan ${plan} "$(printf %s --push)" --json`,
    'node tools/safe-commit.mjs check --request "$(git add file)" --json',
    'node tools/safe-commit.mjs check --request <(git commit -m test) --json',
    `node tools/safe-commit.mjs commit --plan ${plan} --json && git push`,
  ];
  for (const command of commands) assert.equal(await decision(command), 'deny', command);
});

test('allows simple whitelisted read-only Git inspection', async () => {
  const commands = [
    'git status --short --branch',
    'git diff --cached --name-only',
    'git log -1 --oneline',
    'git rev-parse HEAD',
    'git branch --show-current',
    'git remote -v',
    'git config --get core.fileMode',
    'git hook -h',
    '/usr/bin/git show HEAD',
    'command git status --short',
  ];
  for (const command of commands) assert.equal(await decision(command), 'defer', command);
});

test('denies direct writes, aliases, wrappers, and unknown Git commands', async () => {
  const commands = [
    'git add file',
    'git commit -m test',
    'git push origin main',
    'git merge --no-ff topic',
    'git cherry-pick abc123',
    'git revert abc123',
    'git am patch.mbox',
    'git apply --index patch.diff',
    'git reset HEAD -- file',
    'git restore --staged file',
    'git stash',
    'git update-ref refs/heads/main abc123',
    'git checkout topic',
    'git switch topic',
    'git hook run pre-commit',
    'git ci -m test',
    'git -C /tmp/repo commit -m test',
    '/usr/bin/git commit -m test',
    'env git push',
    'sh -c "git commit -m test"',
    'g=git; $g commit -m test',
    'cd /tmp && git status',
    "g''it commit -m test",
    'g""it push origin main',
    'g\\it add file',
    '"g"it commit -m test',
    'g$' + '{EMPTY}it commit -m test',
    '/usr/bin/g\\it commit -m test',
    "g$''it commit -m test",
    "\u0024'git' commit -m test",
    'exec git commit -m test',
    '! git commit -m test',
    'time git push origin main',
    '/usr/bin/time git add file',
    'nice git commit -m test',
    'nohup git push origin main',
    'timeout 10 git commit -m test',
    'G=/usr/bin/git; "$G" commit -m test',
    '$(command -v git) commit -m test',
    '$(which git) push origin main',
    "printf 'git commit -m test\\n' | sh",
    "printf 'commit -m test\\n' | xargs git",
    "cd /tmp && sh -c 'git commit -m test'",
  ];
  for (const command of commands) assert.equal(await decision(command), 'deny', command);
});

test('denies side-effecting options on otherwise read-only Git commands', async () => {
  const commands = [
    'git diff --output=.claude/hooks/safe-commit-gate.mjs',
    'git log -1 --output=.claude/settings.json',
    'git diff --ext-diff',
    'git show --textconv HEAD',
    'git cat-file --filters HEAD:file',
    'git cat-file --textconv HEAD:file',
    'git grep --open-files-in-pager=/tmp/tool pattern',
    'git grep -Ovim pattern',
  ];
  for (const command of commands) assert.equal(await decision(command), 'deny', command);
});

test('denies ripgrep options that execute external commands', async () => {
  const commands = [
    'rg --pre=git pattern commit',
    'rg --pre=/tmp/git-helper pattern file',
    'rg --pre /tmp/helper git file',
    'rg --hostname-bin=git pattern file',
  ];
  for (const command of commands) assert.equal(await decision(command), 'deny', command);
});

test('does not interfere with unrelated Bash commands', async () => {
  assert.equal(await decision('node --version'), 'defer');
  assert.equal(await decision('npm test'), 'defer');
  assert.equal(await decision('echo git'), 'defer');
  assert.equal(await decision('rg git CLAUDE.md'), 'defer');
  assert.equal(await decision("rg 'git commit' ."), 'defer');
  assert.equal(await decision('echo "commit"'), 'defer');
  assert.equal(await decision('node -e "console.log(\\"commit complete\\")"'), 'defer');
});
