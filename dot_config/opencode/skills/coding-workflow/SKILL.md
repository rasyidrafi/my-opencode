---
name: coding-workflow
description: Practical coding standards for implementation, debugging, verification,
  and review. Use for code changes; apply guidance appropriate to your role and
  assigned scope.
---

# Coding Workflow

Apply the guidance for your role within the user's instructions, repository conventions, and permissions. A skill is guidance, not permission to expand the task or bypass safety rules.

## NON-NEGOTIABLE — scope and proportionality (every role, no exceptions)

These rules override any instinct to "be thorough". Violating them wastes the user's time and is a failure, not diligence.

1. **DO ONLY WHAT WAS ASKED. NO OVERSCOPING.** The user's request defines the scope. Anything beyond it — extra features, extra hardening, extra refactors, "while we're here" improvements — is out of scope. Out-of-scope observations may be reported in one line as optional; they must NEVER become work, requirements, or blocking findings.
2. **NO OVERENGINEERING.** No speculative abstractions, configuration knobs, fallback paths, compatibility layers, defensive machinery, or generalization "for the future". The simplest solution that meets the actual requirement is the correct solution. If a simpler design meets the request, the more complex one is wrong.
3. **NO UNNECESSARY EDGE CASES.** Handle boundaries required by the request, an existing contract, or a demonstrated real risk — nothing else. A scenario is NOT a requirement when it is hypothetical, when it requires deliberately corrupting a trusted artifact the system itself produces, or when existing system constraints (schema, permissions, trust boundaries) already prevent it. Such scenarios are optional notes at most. They must never block completion.
4. **RESPECT THE TRUST MODEL.** Data produced by the system itself under its own enforced constraints (e.g., an export from a database that enforces uniqueness, a file written 0600 by the app) is trusted input. Demanding validation against hand-crafted corruption of trusted internal artifacts is overengineering unless the user explicitly asked for adversarial robustness.
5. **REVIEWER — these rules bind you hardest.** Review ONLY the assigned scope against the requested behavior and direct regressions. A finding is REQUIRED only if it breaks the requested behavior, violates an existing contract, or is a demonstrated real risk within scope. Everything else — hypothetical edge cases, extra hardening, cleaner designs, additional validation of trusted inputs — is OPTIONAL and must be labeled optional, never required. Do NOT issue PASS-WITH-REQUIRED-FIXES for optional items. Do NOT keep discovering new hypothetical variants of an already-addressed class round after round; that is loop abuse, not review. When the requested behavior is correct and in-scope risks are handled, the verdict is PASS.
6. **MAIN AGENT — you own the stop decision.** Evaluate every reviewer finding against rules 1–4 BEFORE acting: confirm it is in scope and real, or reject it with evidence. You are not a courier for reviewer demands. Batch fixes; do not run a full verification cycle per micro-fix. When acceptance criteria are met and remaining findings are optional/hypothetical, STOP and report completion. Endless review loops are a failure of judgment, not rigor. The user's time is a hard constraint.

## Roles

- **Main agent:** understand the goal and existing behavior, keep work proportional, and decide whether delegation or independent review is useful. Simple, self-contained tasks can be done directly. When delegating, use `delegation-rule` for routing and handoffs if applicable.
- **Implementation subagent:** work within the parent's assignment and acceptance criteria. Read relevant context and source, report missing decisions rather than inventing them, and return changes, check results, and open issues. Do not delegate through tools, CLI, SDK, or API.
- **Reviewer:** stay read-only and assess the requested outcome and regressions ONLY within the assigned scope. The NON-NEGOTIABLE section binds you: hypothetical edge cases, extra hardening, and validation of trusted inputs are OPTIONAL notes, never required fixes. Flag unnecessary complexity with evidence. `multi_reviewer` (raw multi-model panel, caller synthesizes) only on explicit user request; default review stays `reviewer`.
- **Explore:** stay read-only, gather requested facts and report evidence; implementation and review instructions do not authorize changes or delegation.

## Implement simply

The NON-NEGOTIABLE section above governs everything below.

- Read the relevant code and callers before changing behavior. Preserve existing contracts unless the task requires changing them.
- Choose the simplest maintainable solution that meets the actual requirement. Do not add speculative edge cases, fallback paths, configuration, abstractions, compatibility layers, or unrelated cleanup. A shorter diff alone is not the goal.
- Handle boundary inputs, errors, and regressions when required by the request, an existing contract, or demonstrated risk. Prefer validation at the relevant boundary rather than redundant guards throughout trusted internal code.
- Keep changes and plans proportional to the task. For substantial work, define small steps with meaningful acceptance checks; avoid introducing process artifacts for trivial changes.

## Verify and debug

- Select a relevant check before editing when practical; establish a baseline if useful. Run the real check and broader checks when appropriate. Report commands and results, distinguishing observations from assumptions and unexecuted checks; explain any blocked verification.
- Fix the root cause rather than hiding a failure or weakening a check. If two attempts fail in the same way, stop varying the fix: identify and test their shared assumption before choosing a new approach.
