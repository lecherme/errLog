---
name: openspec-refine-change
description: Refine change artifacts for cross-artifact consistency, best-practice alignment, reuse, and implementation readiness. Use when the user wants to review artifact quality before implementation. Never edits code.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.10.0"
---

<!--
  PORTED WORKFLOW — provenance and local modifications
  Source PR:      Fission-AI/OpenSpec #893  (https://github.com/Fission-AI/OpenSpec/pull/893)
  Source file:    src/core/templates/workflows/refine-change.ts
  Source commit:  e5cb29c9e727483cb8122dfa7defb47b51a17611
  Ported version: 1.0 (buildInstructions workflow only; not a cherry-pick of the PR)

  Local compatibility fixes applied on top of the PR (openspec CLI 1.10.0):
  - strict validation is `openspec validate "<name>" --strict`
    (the PR's `openspec validate --change "<name>" --strict` is wrong for this CLI).
  - Always resolve paths from `openspec status --change "<name>" --json`
    (planningHome / changeRoot / artifactPaths / existingOutputPaths / actionContext).
    Never hardcode `openspec/changes/<name>`.
  - scratchpad.md is written to the `changeRoot` reported by status.
  - Artifacts are whatever the active schema defines; do not assume
    proposal/specs/design/tasks always exist.
  - Glob artifacts: only read/edit `existingOutputPaths`; never treat a glob
    `resolvedOutputPath` as a real file.

  Local additions beyond PR #893:
  - Tasks -> upstream artifact check (unauthorized new behavior).
  - Current change -> existing system check (duplication / reuse advice).
  - Structured issue record fields and P0/P1/P2 definitions.
  - First-run safety: scratchpad only, no artifact edits without approval.

  `openspec update` may regenerate OpenSpec-managed files. This skill lives under
  .claude/skills/openspec-refine-change/ and is NOT emitted by `openspec update`;
  re-apply these notes if you regenerate it from upstream.
-->

Review and refine a change's planning artifacts for cross-artifact consistency, best-practice alignment, reuse against the existing system, and implementation readiness. Track every issue in a per-change scratchpad. **Never edit implementation code.**

**Store selection:** If the user names a store (a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`status`, `instructions`, `list`, `show`, `validate`, `doctor`, `context`, `schemas`, `view`). Once selected, treat `--store <id>` as sticky for the rest of the workflow: every unscoped example below is shorthand — append the flag before running it. Without a store, commands act on the nearest local `openspec/` root.

**Input**: Optionally specify a change name (e.g., `/opsx:refine add-auth`). If omitted, infer from conversation context only if unambiguous; otherwise prompt for selection.

---

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:

- Infer from conversation context only if the user clearly named one.
- If exactly one active change exists, you may auto-select it and announce the choice.
- If ambiguous, run `openspec list --json` to get active changes (not archived) sorted by most recently modified, and ask the user to choose. Present the top 3–4, showing: change name, schema (`schema` field, else "spec-driven"), status (e.g. "0/5 tasks", "complete"), and how recently modified.

**Do NOT guess when it is ambiguous.** Always announce: `Using change: <name>` and how to override (`/opsx:refine <other>`).

### 2. Resolve change context (do this before touching any file)

```bash
openspec status --change "<name>" --json
```

Parse the JSON and use it as the single source of truth for scope and paths:

- `schemaName` — the active workflow schema.
- `planningHome` (`.root`, `.changesDir`) — store-aware roots. Main specs live under `<planningHome.root>/openspec/specs/`.
- `changeRoot` — the change's directory. **The scratchpad goes here.**
- `artifactPaths.<id>` — for each artifact the schema defines:
  - `existingOutputPaths` — the concrete files that exist on disk (already glob-expanded for glob artifacts such as `specs/**/*.md`). **These are the only files you may read or edit.**
  - `resolvedOutputPath` — for a glob artifact this is still the glob pattern, not a real file. **Never read or write it.**
- `actionContext` (`allowedEditRoots`, `constraints`, `planningArtifacts`) — respect these edit boundaries.
- `isPlanningComplete` / `isComplete` — whether all planning artifacts are done.

The artifact ids come from the active schema. **Do NOT assume the schema contains `proposal`/`specs`/`design`/`tasks`.** Drive every check off the artifact list `status` actually returns, and off `existingOutputPaths`. A custom schema must work unchanged.

### 3. Read the artifacts

Read every file in each artifact's `existingOutputPaths`. Note which schema-defined artifacts have **no** existing files yet — those gate which checks can run (see Graceful Degradation).

### 4. Create / update the scratchpad

Write `<changeRoot>/scratchpad.md` using the [Scratchpad Format](#scratchpad-format). If it already exists from a previous session, load it, keep resolved issues, refresh "Last updated", and append newly found issues.

**The scratchpad MUST be the running record of every issue and working decision for the rest of this workflow.**

On the **first run for a change, the only file this workflow writes is the scratchpad.** Do not modify any real artifact until the user has seen the issue list and approved a specific fix (Step 8).

### 5. Cross-artifact semantic consistency checks

Only run the pairs whose **both** sides have existing files. Adapt names to the active schema; the pairing below assumes the default spec-driven schema.

- **Proposal → Specs**: Does every goal / capability / non-goal in the proposal have corresponding requirements in the specs? Anything promised but unspecified?
- **Specs → Design**: Does the design address every requirement and scenario? Any requirement with no design coverage? Any design that contradicts a spec?
- **Design → Tasks**: Does the task list implement every design decision? Any decision with no task? Any task that contradicts the design?
- **Specs → Tasks**: Is every requirement traceable to at least one task?

Record each finding in the scratchpad with a priority (see [Issue Priorities & Record Format](#issue-priorities--record-format)).

### 6. Additional consistency checks (local additions beyond PR #893)

- **Tasks → upstream artifacts (authorization check)**: Does any task introduce behavior, scope, data, interface, or dependency that the proposal, specs, or design do **not** authorize? A task that invents new behavior is either an undocumented scope creep (fix upstream first) or should be dropped. Record which upstream artifact must be updated to authorize it, or recommend removing the task.
- **Current change → existing system (reuse check)**: Compare the change against the existing main specs and shared/common capabilities. Use `openspec list --specs --json` (and `openspec show <spec> --json` as needed) to enumerate current capabilities. For each new capability, requirement cluster, or component the change introduces, decide whether it **duplicates** an existing main spec, a shared component, or a common capability, and give a recommendation:
  - **reuse** — an existing capability already covers this; point tasks/design at it.
  - **extend** — an existing capability should gain a requirement/scenario rather than a new spec being created.
  - **new-shared** — genuinely new but cross-cutting; belongs in a shared/common spec others can consume.
  - **new-dedicated** — genuinely new and specific to this change; a dedicated spec is correct.

Record findings in the scratchpad.

### 7. Artifact document-quality checks

Check each existing artifact against quality standards:

- Tasks have explicit **acceptance criteria** (a reviewer can tell when the task is done).
- Scenarios are **concrete and verifiable** (Given/When/Then or equivalent, with real values — not "handles errors gracefully").
- Every **design decision has a rationale** (why this option, what was rejected).
- **Task dependencies are complete and acyclic** — no missing prerequisite, no circular ordering.
- **Error states and edge cases are covered** — empty/oversized input, auth failure, concurrency, partial failure, rollback.

Add findings to the scratchpad.

### 8. Address issues one at a time (fix & convergence loop)

Work issues in priority order, **P0 first**, then P1, then P2. For **each** issue:

1. **Present it to the user** with full context from its scratchpad record (files, evidence, expected state, impact, recommended artifact, proposed fix, whether a decision is needed).
2. If the record says a user decision is required, get that decision first.
3. **Propose the concrete edit** (which file in `existingOutputPaths`, what text changes).
4. **Apply the edit only after explicit user approval.** If the user rejects it, leave the artifact unchanged and mark the issue accordingly.
   - Edit only files listed in `existingOutputPaths`. Never create an artifact that does not exist yet, and never write a file under a glob artifact's pattern — note it as deferred and point the user to the appropriate create workflow (e.g. `/opsx:continue` or `/opsx:update`).
   - When a substantial rewrite is needed, first fetch the artifact's rules and template:
     ```bash
     openspec instructions "<artifact-id>" --change "<name>" --json
     ```
5. **Run strict validation** after the edit:
   ```bash
   openspec validate "<name>" --strict
   ```
   - If it **fails**: mark the issue `Needs refinement` in the scratchpad, keep the change uncommitted, show the validation output, and ask the user for direction. Do not move to the next issue.
   - If it **passes**: update the issue's status in the scratchpad.
6. **Update the scratchpad** (status, notes, "Last updated") to reflect the new artifact state.
7. **Confirm the next step with the user** before starting the next issue.

**Address exactly one issue per iteration so the user can review each change.**

Do **not** auto-commit. When the user wants to stop (or all issues are resolved), show `git diff` of the scratchpad + touched artifacts and **ask whether to commit**. Only if the user says yes: stage exactly those files by path (never `git add .`), commit the scratchpad and artifact edits together with a message describing the convergence, and never force-push or merge `main`.

### 9. Final status

When all issues are resolved or the user decides to stop:

```bash
openspec status --change "<name>"
```

Show a summary: issues found, resolved, deferred, and remaining. Leave every unresolved issue recorded as `Open` / `Needs refinement` in the scratchpad for a future session.

---

## Issue Priorities & Record Format

**Priority levels**

- **P0** — a direct contradiction between artifacts (e.g. spec says X, design says not-X).
- **P1** — a coverage, traceability, reuse, or implementation-readiness gap (e.g. a requirement with no task; a capability that duplicates an existing spec; a task with no acceptance criteria that blocks implementation).
- **P2** — an ambiguity, an untestable statement, or a document-quality problem (e.g. vague scenario, missing rationale, unclear wording).

**Every issue records all of the following:**

| Field | Meaning |
| --- | --- |
| **Number** | `P<L>(i)` — level and index, e.g. `P0(1)`, `P1(2)` |
| **Status** | `Open` / `Needs refinement` / `Consistent` (see Status Legend) |
| **Files & locations** | Every artifact file and section/line involved |
| **Evidence** | The exact conflicting or missing text, quoted |
| **Expected state** | What the artifacts should say once consistent |
| **Impact** | What breaks or is at risk if left unresolved |
| **Recommended artifact** | Which artifact should change to fix it |
| **Suggested fix** | The concrete edit to make |
| **User decision needed?** | Yes/No — and if yes, the question to ask |

---

## Scratchpad Rules

- Issue status MUST reflect the state of the OpenSpec artifacts, **not** implementation status.
- Keep "Last updated" current.
- List issues in priority order: P0, then P1, then P2.
- Use the `P<L>(i)` id format.
- The scratchpad is scoped per-change (lives in `changeRoot`) and persists across refine sessions.
- When the user approves a commit, commit the scratchpad together with the artifact edits to preserve convergence history.

## Scratchpad Format

```markdown
## <change-name> Refinement Scratchpad

Tracks openspec-refine issues and working decisions for the `<change-name>` change.
This is a working document, not a spec artifact.

Last updated: YYYY-MM-DD

### Status Legend
- **Open**: Not yet captured consistently in OpenSpec artifacts
- **Needs refinement**: Partially captured; artifacts still need work
- **Consistent**: Artifacts are aligned with current intended behavior

### Checks Run
- (List which checks ran and which were skipped, with the reason)

### Key References
- (External references used to resolve issues)

### Current Working Constraints / Decisions
- (Constraints or decisions affecting the current issue)

### Issue List

#### P0(1): <title>
- **Status**: <status>
- **Files & locations**:
  - `<path from existingOutputPaths>` — <section/line>
- **Evidence**: <quoted conflicting/missing text>
- **Expected state**: <what the artifacts should say>
- **Impact**: <what breaks if unresolved>
- **Recommended artifact**: `<artifact id / path>`
- **Suggested fix**: <concrete edit>
- **User decision needed?**: <Yes/No — question if yes>
- **Notes**: <clarify the status>

#### P1(1): <title>
...

#### P2(1): <title>
...

### Open Questions
- (Questions needing user clarification)
```

---

## Graceful Degradation

Run only the checks whose inputs exist. Derive this from `status` + `existingOutputPaths`, not from assumptions about the schema.

- Only `proposal` exists → check it for completeness and clarity; skip cross-artifact checks.
- `proposal` + `specs` exist → check Proposal→Specs consistency and the reuse check; skip design/task checks.
- All planning artifacts exist → run every check.
- The reuse check (Step 6, existing-system) can run whenever main specs exist, regardless of which change artifacts are present.
- Always record in the scratchpad which checks were skipped and why.

---

## Guardrails

- **Planning artifacts only — never edit implementation code.** If a fix implies a code change, stop and point the user to `/opsx:apply`.
- **First run writes only the scratchpad.** No real artifact is modified before the user approves a specific fix.
- Use the artifact ids and paths from `openspec status --json`; never branch on hardcoded artifact names and never hardcode `openspec/changes/<name>`.
- Edit only the concrete files in `existingOutputPaths`; never write a glob `resolvedOutputPath`, never create a not-yet-existing artifact.
- Strict validation is `openspec validate "<name>" --strict` (positional name, no `--change`).
- Confirm every artifact edit with the user before writing; address one issue per iteration.
- Do not auto-commit. Show the diff and ask first. When approved: stage files by explicit path, never `git add .`, never commit unrelated files, never force-push, never merge `main`.
