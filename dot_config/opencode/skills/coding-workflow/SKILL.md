---
name: coding-workflow
description: Practical coding standards for implementation, debugging, verification,
  and review. Use for code changes; apply guidance appropriate to your role and
  assigned scope.
---

# Coding Workflow

Apply the guidance for your role within the user's instructions, repository conventions, and permissions. A skill is guidance, not permission to expand the task or bypass safety rules.

## Roles

- **Main agent:** understand the goal and existing behavior, keep work proportional, and decide whether delegation or independent review is useful. Simple, self-contained tasks can be done directly. When delegating, use `delegation-rule` for routing and handoffs if applicable.
- **Implementation subagent:** work within the parent's assignment and acceptance criteria. Read relevant context and source, report missing decisions rather than inventing them, and return changes, check results, and open issues. Do not delegate through tools, CLI, SDK, or API.
- **Reviewer:** stay read-only and assess the requested outcome and regressions. Flag unnecessary complexity with evidence, without turning optional improvements or hypothetical issues into requirements.
- **Explore:** stay read-only, gather requested facts and report evidence; implementation and review instructions do not authorize changes or delegation.

## Implement simply

- Read the relevant code and callers before changing behavior. Preserve existing contracts unless the task requires changing them.
- Choose the simplest maintainable solution that meets the actual requirement. Do not add speculative edge cases, fallback paths, configuration, abstractions, compatibility layers, or unrelated cleanup. A shorter diff alone is not the goal.
- Handle boundary inputs, errors, and regressions when required by the request, an existing contract, or demonstrated risk. Prefer validation at the relevant boundary rather than redundant guards throughout trusted internal code.
- Keep changes and plans proportional to the task. For substantial work, define small steps with meaningful acceptance checks; avoid introducing process artifacts for trivial changes.

## Verify and debug

- Select a relevant check before editing when practical; establish a baseline if useful. Run the real check, inspect its output, and report the command, result, and any unverified behavior. Run broader checks when appropriate for the change.
- Fix the root cause rather than hiding a failure or weakening a check. If two attempts fail in the same way, stop varying the fix: identify and test their shared assumption before choosing a new approach.
- Report observed results separately from assumptions and unexecuted checks. If verification is blocked, state why rather than claiming success.
