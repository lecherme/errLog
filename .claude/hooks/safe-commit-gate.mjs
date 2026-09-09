#!/usr/bin/env node

import { readFileSync } from 'node:fs';

function respond(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  }));
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  respond('deny', 'safe-commit gate could not parse the PreToolUse request');
  process.exit(0);
}

if (input?.tool_name !== 'Bash') process.exit(0);
const command = input?.tool_input?.command;
if (typeof command !== 'string') {
  respond('deny', 'safe-commit gate received a Bash request without a command');
  process.exit(0);
}

const requestPath = String.raw`\.git/safe-commit/requests/[A-Za-z0-9._-]+\.json`;
const planId = String.raw`[0-9a-f]{64}`;
const canonical = new RegExp(
  String.raw`^\s*node tools/safe-commit\.mjs (?:(check) --request (${requestPath})|(inspect|commit|push) --plan (${planId})) --json\s*$`,
  'u',
).exec(command);

if (canonical) {
  const action = canonical[1] ?? canonical[3];
  if (action === 'commit' || action === 'push') {
    respond('ask', `Explicit user approval is required before safe-commit ${action}`);
  }
  process.exit(0);
}

function approximateShellJoining(value) {
  return value
    .replace(/\\([^\n\r])/gu, '$1')
    .replace(/\$\{[^}\n\r]*\}/gu, '')
    .replace(/\$(?:[A-Za-z_][A-Za-z0-9_]*|[@*#?$!-])/gu, '')
    .replace(/\$(?=['"])/gu, '')
    .replace(/['"]/gu, '');
}

const joinedCommand = approximateShellJoining(command);

if (joinedCommand.includes('safe-commit.mjs')) {
  respond(
    'deny',
    'Use the exact canonical safe-commit command and arguments documented in CLAUDE.md',
  );
  process.exit(0);
}

const unsafeShellSyntax = /[;&|`$()<>\\'"\n\r]/u;
const readOnlyGit = /^\s*(?:command\s+)?(?:\/usr\/bin\/)?git\s+(?:status|diff|log|show|rev-parse|ls-files|ls-tree|cat-file|check-ignore|grep|describe|name-rev|merge-base|for-each-ref|count-objects|shortlog|whatchanged)(?:\s+[^;&|`$()<>\\'"\n\r]+)?\s*$/u;
const readOnlySpecial = /^\s*(?:command\s+)?(?:\/usr\/bin\/)?git\s+(?:--version|branch\s+--show-current|remote\s+(?:-v|get-url\s+[A-Za-z0-9._/-]+)|config\s+--(?:get|get-all|get-regexp)\s+[^;&|`$()<>\\'"\n\r]+|hook\s+-h)\s*$/u;
const sideEffectingReadOption = /(?:^|\s)(?:--output(?:=|\s|$)|--ext-diff(?:\s|$)|--textconv(?:\s|$)|--filters(?:\s|$)|--open-files-in-pager(?:=|\s|$)|-O\S*)/u;

if (
  !unsafeShellSyntax.test(command)
  && !sideEffectingReadOption.test(command)
  && (readOnlyGit.test(command) || readOnlySpecial.test(command))
) {
  process.exit(0);
}

// Permit plain documentation searches that mention Git. Shell composition or
// expansion is intentionally excluded so the text cannot become a later command.
const sideEffectingSearchOption = /^\s*rg\b[^\n\r]*?(?:^|\s)--(?:pre|hostname-bin)(?:=|\s|$)/u.test(command);
if (sideEffectingSearchOption) {
  respond('deny', 'rg options that execute external commands are blocked by the safe-commit gate');
  process.exit(0);
}
const simpleGitTextSearch = /^\s*(?:echo\s+git|rg\s+.+)\s*$/u.test(command)
  && !/[;&|`$()<>\\\n\r]/u.test(command);
if (simpleGitTextSearch) process.exit(0);

// Outside the complete read-only forms above, reject Git anywhere in the reconstructed
// shell text. This covers wrappers, pipelines, variables containing a Git path, and
// command substitutions without maintaining an incomplete list of command prefixes.
const mentionsGit = /(?:^|[^A-Za-z0-9_.-])git(?:$|[^A-Za-z0-9_.-])/u.test(joinedCommand);
const dynamicCommandWord = /(?:^|[;&|()\n\r]\s*)(?:!\s*)?[^\s;&|()]*[\$`][^\s;&|()]*(?:\s|$)/u.test(command);
const mutationWord = /(?:^|[^A-Za-z0-9_-])(?:add|commit|push|merge|cherry-pick|revert|reset|restore|stash|update-ref|update-index|commit-tree)(?:$|[^A-Za-z0-9_-])/u.test(joinedCommand);
if (!mentionsGit && !(dynamicCommandWord && mutationWord)) process.exit(0);

respond(
  'deny',
  'Direct or non-whitelisted Git execution is blocked; use the reviewed safe-commit workflow',
);
