---
name: "OPSX: Refine"
description: "Refine change artifacts for consistency, reuse, and quality before implementation (Experimental)"
allowed-tools: Bash(openspec:*)
category: "Workflow"
tags: ["workflow", "refine", "quality", "experimental"]
---

<!--
  Thin entry point. Full workflow lives in the `openspec-refine-change` skill
  (.claude/skills/openspec-refine-change/SKILL.md).
  Ported from Fission-AI/OpenSpec PR #893 (src/core/templates/workflows/refine-change.ts
  @ e5cb29c9e727483cb8122dfa7defb47b51a17611) with local openspec CLI 1.10.0
  compatibility fixes. Do not duplicate the workflow prompt here — keep this thin.
-->

Invoke the **`openspec-refine-change`** skill and follow it in full.

**Change name:** `$ARGUMENTS`

- If `$ARGUMENTS` is non-empty, pass it to the skill as the selected change and skip the skill's change-selection prompt.
- If `$ARGUMENTS` is empty, run the skill's Step 1 (select the change): infer from context only if unambiguous, auto-select only if exactly one active change exists, otherwise prompt.

The skill covers: resolving change context from `openspec status --change "<name>" --json`, reading artifacts from `existingOutputPaths`, cross-artifact semantic consistency checks, the tasks→upstream authorization check, the change→existing-system reuse check, artifact document-quality checks, the per-change `scratchpad.md`, the one-issue-at-a-time fix loop with user approval, and strict validation via `openspec validate "<name>" --strict`.

Safety: first run writes only the scratchpad; never edit implementation code; get user approval before every artifact edit; do not auto-commit.
