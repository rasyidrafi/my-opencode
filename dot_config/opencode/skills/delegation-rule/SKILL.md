---
name: delegation-rule
description: Main-agent-only workflow for delegating repository discovery,
  implementation, and review. Not applicable to subagents; subagents execute
  their assigned scope and report to the parent.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# Delegation Rule

Main-agent-only workflow: the main agent coordinates the user's task. A subagent executes its assigned scope, follows applicable task-specific skills, and reports results and verification to its parent; it must not delegate.

## Routing

Choose direct discovery or delegation by outcome and complexity:

| Desired outcome | Route |
| --- | --- |
| Locate code, explain behavior, trace a flow, gather repository facts | Direct discovery by default; `explore` when justified below |
| Review code or plans, assess risks, compare approaches, recommend a design | `reviewer` |
| Implement, fix, refactor, or change files | `general → reviewer` |
| Implement with missing repository context | `targeted discovery → general → reviewer` |

If `reviewer` is unavailable, use a separate, read-only `general` session. Reviewer means either review session, always separate from implementation. Pending review is a handoff, not a reason for a subagent to withhold completed work.

Default to targeted searches and reads. Use Explore only for substantial cross-area investigation, code still unclear after an initial search, or material reduction of the parent's context—not simple lookups, a known symbol, a few files, a short obvious trace, or lack of context alone. “Targeted discovery” means direct discovery or Explore chosen by these criteria. Explore is for repository facts, not general knowledge or design advice; Reviewer does its own needed discovery, with no separate Explore pass or fixes implied.

Keep discovery proportional: skip it when context suffices and proceed once evidence enables the next action. Finding code or hypotheses does not complete a trace while useful authorized in-scope checks remain. Split implementation into coherent slices, use only needed agents, and run subagents in the foreground, waiting for each to finish.

## Handoffs

Subagents must not launch agents through tools, CLI, SDK, or API. Tell every delegate it is a subagent and must not delegate further. For implementation, state: “Return implementation and verification results to me; I will arrange the independent review.”

Sessions inherit no context: prompt each with objective/slice, repository and relevant files/symbols, known facts and current/required behavior, decisions/constraints/allowed changes, acceptance criteria, verification, and expected output. Preserve user scope and authorization; state non-goals where needed. Splitting work authorizes neither extra features nor broad refactors. Distinguish investigation from changes.

Pass relevant findings explicitly to the next session, with role-appropriate evidence:

- **Explore:** file/line references, symbols/flow, verified facts, unknowns; read-only discovery, including shell commands.
- **General:** changes, verification commands/results, limitations.
- **Reviewer:** scope and diff/base, confirmed issues with file/line evidence, concrete failures tied to criteria, required verification gaps, and verdict. Separate optional advice from blockers. Review read-only; authorized state-changing verification goes to General.

Separate observed results, inference, and unexecuted checks. Shell access does not authorize Explore or Reviewer to mutate files or state.

## Review loop

Per implementation slice, use one General and one Reviewer, reusing session IDs for fixes/re-review; a new slice gets new sessions. Reuse Explore for same-scope follow-up and forward findings invalidated by changes. Continuation handoffs state intent, current changes, and unresolved findings. Replace only an unavailable session, with a self-contained handoff of decisions, state, verification, and unresolved findings.

After implementation or fixes, Reviewer checks current changes, prior findings, and direct regressions against the same criteria, using repository evidence. The parent verifies a finding's evidence and scope before requiring it; recommendations are not requirements. Establish why a claimed prerequisite is needed and make the smallest sufficient fix. A touched subsystem does not justify broad cleanup.

Act on review results as follows:

- **Confirmed in-scope issue:** send actionable evidence to the same General; re-review with the same Reviewer.
- **Verification gap:** obtain evidence for agreed criteria; optional checks remain nonblocking, and unexecuted checks are not failed checks.
- **Pre-existing/unrelated issue:** report separately; fix only if in scope.
- **Hypothetical concern/design preference:** require evidence of an in-scope failure before blocking; keep optional improvements separate.
- **Missing prerequisite or finding without progress:** identify and resolve the blocker if possible; otherwise report blocked, naming the needed input or evidence.

Do not repeat a fix/review request without new evidence or an approach change. Keep rounds in scope; a new blocker needs concrete evidence of an in-scope failure. Resolve conflicts with evidence and ask the user only about an unresolvable decision or dependency. A failed delegate is not automatically a blocker: resume, replace, or continue directly when authorized.

## Completion

Discovery ends with a supported answer or a precise blocker after available, authorized in-scope checks; unexplored hypotheses are not a finished trace. Standalone review ends with an evidence-based assessment. Implementation is complete only when acceptance criteria and required verification are met, Reviewer passes, and no confirmed in-scope findings remain. Then close the loop; optional improvements do not prevent completion. Report unresolved blockers or required verification gaps as incomplete, not success, and give the result in the user's terms rather than forwarding raw agent reports.
