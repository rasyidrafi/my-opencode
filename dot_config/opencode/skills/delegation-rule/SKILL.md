---
name: delegation-rule
description: Decide when delegation helps and how the main agent prepares bounded,
  context-rich handoffs and independent review. Simple tasks can be handled
  directly. Subagents execute their assignment and must not delegate further.
---

# Delegation Rule

Apply this skill within the user's instructions and permissions. The sections below are for the main agent. Subagents execute their assigned scope, read relevant context and source, follow applicable skills, and report results and verification to their parent; they must not delegate through tools, CLI, SDK, or API.

## Routing

Handle simple, self-contained work directly when context is sufficient; a subagent or reviewer is not mandatory. Delegate or review when complexity, risk, independent assessment, or the user's request justifies it:

| Desired outcome | Route |
| --- | --- |
| Repository facts, code locations, or flow traces | Direct discovery by default; `explore` when justified below |
| Independent review of code or plans, risks, or design | `reviewer` |
| Delegated implementation | `general`, followed by `reviewer` when independent review is warranted |
| Delegated implementation with missing context | Discovery → `general`, then review when warranted |

If `reviewer` is unavailable, use a separate read-only `general` session. Pending review is not a reason for an implementer to withhold completed work.

Use direct searches for straightforward discovery. Use Explore for substantial cross-area investigation, code unclear after an initial search, or material reduction of context load; not for simple lookups or lack of context alone. Explore gathers repository facts; Reviewer performs its own investigation. Proceed when evidence enables the next action, but do not call a trace complete while useful authorized in-scope checks remain.

Run independent read-only tasks in parallel when useful and authorized. Serialize dependent handoffs and avoid concurrent writes to the same files.

## Planning and tracking

For cross-subsystem changes, migrations, or rewrites, when independent review is authorized, obtain a reviewer-informed plan before implementation: ordered slices, dependencies, interfaces, acceptance criteria, and final integration checks. Delegate one bounded slice at a time; slices do not authorize transition releases or runtime fallbacks.

For multi-slice work, maintain a compact slice ledger: scope, dependencies, status, implementation/reviewer session IDs, and verification evidence. Update it after each handoff and review; carry accepted interfaces and unresolved findings into dependent handoffs. The parent owns completion of the whole plan.

For complex work needing research, design decisions, or multiple dependent handoffs, write a task-specific Markdown handoff before delegating implementation. Use the handoff structure below, adding the plan, dependencies, progress and next action. For planning, ask whether a simpler approach meets the goal and give each step a meaningful check. Update the file as decisions or verified state change.

The parent owns this file; delegates read it but do not write it unless explicitly assigned. Choose a task-specific location that does not overwrite user files, respect repository instructions and authorization, omit secrets, and do not commit it unless authorized. Before resuming, compare the recorded worktree, HEAD and relevant dirty state to the current state and resolve discrepancies. For a small self-contained task, a file is unnecessary.

## Handoffs

Treat every new session as having no parent-chat history. Tell each delegate its role and that it must not delegate further. Supply relevant facts, not just references to prior research or instructions. Structure the handoff around:

- **Goal:** requested behavior and out-of-scope work.
- **Context:** relevant architecture, source paths, verified facts, decisions, assumptions, open questions and their limitations.
- **State:** repo/worktree paths, base/HEAD, relevant dirty state, completed dependencies and interfaces; include diff/base for review.
- **Contract:** bounded assignment, constraints, allowed changes, acceptance criteria and checks. Distinguish investigation from changes; splitting work does not authorize extra features or refactors.
- **Return:** changes or assessment, evidence, check commands/results and unresolved issues. Separate observations, inferences and unexecuted checks.

When a handoff file exists, give its absolute path and instruct the delegate to read it and relevant source. Still include the goal, assignment, key constraints, acceptance criteria and checks in the message. A file is not additional authorization; report stale or conflicting context instead of guessing.

Pass relevant findings to the next session: Explore returns file/line evidence and unknowns; General returns changes and verification; Reviewer returns a verdict, concrete in-scope findings and required verification gaps, separating optional advice. Explore and Reviewer remain read-only, including shell commands; assign authorized state-changing checks to General. If review is planned, tell the implementer the parent will arrange it.

## Review loop

When review is warranted, use a Reviewer separate from the implementer. Reuse sessions for fixes and re-review; use new sessions for a new slice. Reuse Explore for same-scope follow-up and forward findings invalidated by changes. Continuations need changed state and unresolved findings, not repeated onboarding. If a session is unavailable, replace it with a self-contained handoff.

Reviewer checks the current diff, prior findings and direct regressions against the same criteria. Ask it to flag unnecessary complexity without rejecting required boundary handling or equating a shorter diff with correctness. The parent checks evidence and scope; recommendations alone do not require changes.

- Fix confirmed in-scope issues minimally, then re-review. Establish why a claimed prerequisite is needed; a touched subsystem alone does not justify cleanup.
- Obtain evidence for required verification gaps. Unexecuted checks are not failed checks; optional checks, hypothetical concerns and unrelated issues do not block. Report unrelated issues separately.
- Do not repeat a request without new evidence or an approach change. Resolve conflicts with evidence; if a decision or dependency cannot be resolved, report the blocker. A failed delegate can be resumed, replaced or bypassed when authorized.

## Completion

Finish discovery or standalone review with a supported answer or precise blocker. Implementation is complete when acceptance criteria and required checks pass, no confirmed in-scope findings remain, and required independent review passes. Slice approvals do not replace final integration checks. Report blockers and required verification gaps as incomplete, in the user's terms.
