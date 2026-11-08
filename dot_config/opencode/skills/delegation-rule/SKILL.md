---
name: delegation-rule
description: Decide when delegation helps and how the main agent prepares bounded,
  context-rich handoffs and independent review. Simple tasks can be handled
  directly. Subagents execute their assignment and must not delegate further.
---

# Delegation Rule

Apply this skill according to your role and the user's instructions and permissions. The routing, planning, handoff and review-loop sections below are for the main agent. If you are a subagent, do not apply those sections as instructions to spawn or coordinate agents: execute your assigned scope, read relevant handoff context and source, follow applicable task-specific skills, and report results and verification to your parent. Do not delegate through tools, CLI, SDK, or API.

## Routing

Handle simple, self-contained work directly when context is sufficient. A subagent or independent reviewer is not mandatory for a small task. Use delegation or review when complexity, risk, a need for independent assessment, or the user's request justifies it, within the user's instructions and permissions. When delegation is appropriate, route by outcome:

| Desired outcome | Route |
| --- | --- |
| Locate code, explain behavior, trace a flow, gather repository facts | Direct discovery by default; `explore` when justified below |
| Independent review of code or plans, risks, or design | `reviewer` |
| Delegated implementation | `general`, followed by `reviewer` when independent review is warranted |
| Delegated implementation with missing repository context | `targeted discovery → general`, then review when warranted |

If `reviewer` is unavailable, use a separate, read-only `general` session. Reviewer means either review session, always separate from implementation. Pending review is a handoff, not a reason for a subagent to withhold completed work.

Default to targeted searches and reads. Use Explore only for substantial cross-area investigation, code still unclear after an initial search, or material reduction of the parent's context—not simple lookups, a known symbol, a few files, a short obvious trace, or lack of context alone. “Targeted discovery” means direct discovery or Explore chosen by these criteria. Explore is for repository facts, not general knowledge or design advice; Reviewer does its own needed discovery, with no separate Explore pass or fixes implied.

Keep discovery proportional: skip it when context suffices and proceed once evidence enables the next action. Finding code or hypotheses does not complete a trace while useful authorized in-scope checks remain. Use only needed agents and run subagents in the foreground, waiting for each to finish.

## Planning and tracking

For cross-subsystem changes, migrations, or rewrites, when independent review is authorized, obtain a reviewer-informed plan before implementation: ordered slices, dependencies, interfaces, acceptance criteria, and final integration checks. Delegate one bounded slice at a time, not the entire program. Slices are implementation/review boundaries; they do not authorize transition releases or runtime fallbacks.

For multi-slice work, maintain a compact slice ledger: scope, dependencies, status, implementation/reviewer session IDs, and verification evidence. Update it after each handoff and review; carry accepted interfaces and unresolved findings into dependent handoffs. The parent owns completion of the whole plan.

For complex work needing research, design decisions, or multiple dependent handoffs, write a task-specific Markdown handoff before delegating implementation. Include the goal and acceptance checks, out-of-scope items, repo and worktree paths, base/HEAD and relevant dirty state, verified facts with source paths, decisions and assumptions, open questions, plan/dependencies, current progress, next action, and verification results. Distinguish facts from assumptions and unexecuted checks. For planning, ask whether a simpler approach meets the same goal; give each step a meaningful acceptance check. Keep the file concise and update it as decisions or verified state change.

The parent owns this file; delegates read it but do not write it unless explicitly assigned. Choose a task-specific location that does not overwrite user files, respect repository instructions and authorization, omit secrets, and do not commit it unless authorized. Before resuming, compare the recorded worktree, HEAD and relevant dirty state to the current state and resolve discrepancies. For a small self-contained task, a file is unnecessary.

## Handoffs

Subagents must not launch agents through tools, CLI, SDK, or API. Tell every delegate it is a subagent and must not delegate further. For implementation, ask it to return implementation and verification results to the parent; if independent review is planned, say that the parent will arrange it.

Treat every new session as a newly hired engineer with no parent-chat history. Structure its first handoff around:

- **Outcome:** user goal, current/required behavior, and this delegate's bounded assignment; distinguish investigation from changes.
- **Context:** repository, relevant architecture/files/symbols, approved decisions, prior findings and their limitations.
- **State:** existing changes, completed dependencies, and interfaces to reuse; include diff/base for review.
- **Contract:** scope, constraints, allowed changes, acceptance criteria, and required verification.
- **Return:** expected changes or assessment, supporting evidence, exact check results, and unresolved issues.

Before sending, check whether the delegate can understand its assignment without asking what was previously decided. Include relevant facts themselves: “see prior research,” “follow the plan,” or “read AGENTS.md” does not replace context transfer. References supplement the handoff. Keep detail relevant rather than imposing a word count. Preserve user scope and authorization; splitting work authorizes neither extra features nor broad refactors.

When a task handoff file exists, give its absolute path and instruct the delegate to read it and the relevant source before acting. Still include the goal, bounded assignment, key constraints, acceptance criteria and verification in the message; the file supplements rather than replaces the contract or grants additional authorization. Report stale or conflicting context instead of guessing.

Pass relevant findings explicitly to the next session, with role-appropriate evidence:

- **Explore:** file/line references, symbols/flow, verified facts, unknowns; read-only discovery, including shell commands.
- **General:** changes, verification commands/results, limitations.
- **Reviewer:** scope and diff/base, confirmed issues with file/line evidence, concrete failures tied to criteria, required verification gaps, and verdict. Separate optional advice from blockers. Review read-only; authorized state-changing verification goes to General.

Separate observed results, inference, and unexecuted checks. Shell access does not authorize Explore or Reviewer to mutate files or state.

## Review loop

When independent review is warranted, use a separate Reviewer from the implementer, reusing session IDs for fixes/re-review; a new slice gets new sessions. Reuse Explore for same-scope follow-up and forward findings invalidated by changes. Continuation handoffs state intent, changed state, and unresolved findings without repeating unchanged onboarding. Replace only an unavailable session, with a self-contained handoff of decisions, state, verification, and unresolved findings.

When reviewing implementation or fixes, Reviewer checks current changes, prior findings, and direct regressions against the same criteria, using repository evidence. The parent verifies a finding's evidence and scope before requiring it; recommendations are not requirements. Establish why a claimed prerequisite is needed and make the smallest sufficient fix. A touched subsystem does not justify broad cleanup.

Ask the Reviewer to flag code unnecessary for the requested outcome, including speculative edge cases, abstractions and fallbacks. Keep legitimate boundary handling and regressions covered; do not treat a shorter diff as the goal by itself.

Act on review results as follows:

- **Confirmed in-scope issue:** send actionable evidence to the same General; re-review with the same Reviewer.
- **Verification gap:** obtain evidence for agreed criteria; optional checks remain nonblocking, and unexecuted checks are not failed checks.
- **Pre-existing/unrelated issue:** report separately; fix only if in scope.
- **Hypothetical concern/design preference:** require evidence of an in-scope failure before blocking; keep optional improvements separate.
- **Missing prerequisite or finding without progress:** identify and resolve the blocker if possible; otherwise report blocked, naming the needed input or evidence.

Do not repeat a fix/review request without new evidence or an approach change. Keep rounds in scope; a new blocker needs concrete evidence of an in-scope failure. Resolve conflicts with evidence and ask the user only about an unresolvable decision or dependency. A failed delegate is not automatically a blocker: resume, replace, or continue directly when authorized.

## Completion

Discovery ends with a supported answer or a precise blocker after available, authorized in-scope checks; unexplored hypotheses are not a finished trace. Standalone review ends with an evidence-based assessment. Implementation is complete only when acceptance criteria and required verification are met and no confirmed in-scope findings remain. When independent review is required, it must pass; individual slice approvals do not replace final cross-slice integration checks. Optional improvements do not prevent completion. Report unresolved blockers or required verification gaps as incomplete, not success, and give the result in the user's terms rather than forwarding raw agent reports.
