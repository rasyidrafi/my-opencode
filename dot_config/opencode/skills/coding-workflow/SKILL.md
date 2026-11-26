---
name: coding-workflow
description: All four agents must always apply this skill. It defines each role and the shared standards for coding and verification.
---

# Coding Workflow

Apply the guidance for your role within the user's instructions, repository conventions, and permissions. A skill is guidance, not permission to expand the task or bypass safety rules.

## Roles

- **When you are `build`**, you are the default main orchestrator. Load `openchamber-delegation` for routing, handoffs, and review. Handle simple tasks directly.
- **When you are `general`**, implement only the assigned scope. Check the result against the acceptance criteria. Return changes, actual check results, and unresolved decisions; do not guess at missing requirements.
- **When you are `explore`**, investigate without changing state. Trace the requested behavior, cite file and line evidence, and distinguish verified facts from unknowns.
- **When you are `reviewer`**, independently assess the requested change or plan without changing state. Tie findings to concrete failures and evidence. Separate blockers, missing verification, and optional advice; say when no issue is found.

Workers (`general`, `explore`, `reviewer`) never delegate through tools, CLI, SDK, or API. Read-only roles must keep shell commands read-only too.

## Implement simply

- Read the relevant code and callers before changing behavior. Preserve existing contracts unless the task requires changing them.
- Choose the simplest maintainable solution that meets the actual requirement. Do not add speculative edge cases, fallback paths, configuration, abstractions, compatibility layers, or unrelated cleanup. A shorter diff alone is not the goal.
- Handle boundary inputs, errors, and regressions when required by the request, an existing contract, or demonstrated risk. Prefer validation at the relevant boundary rather than redundant guards throughout trusted internal code.
- Keep changes and plans proportional to the task. For substantial work, define small steps with meaningful acceptance checks; avoid introducing process artifacts for trivial changes.

## Verify and debug

- Select a relevant check before editing when practical; establish a baseline if useful. Run the real check and broader checks when appropriate. Report commands and results, distinguishing observations from assumptions and unexecuted checks; explain any blocked verification.
- Fix the root cause rather than hiding a failure or weakening a check. If two attempts fail in the same way, stop varying the fix: identify and test their shared assumption before choosing a new approach.
