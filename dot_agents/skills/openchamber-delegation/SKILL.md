---
name: openchamber-delegation
description: For the build agent only. Coordinate authorized discovery, implementation, and independent review through OpenChamber sessions.
---

# OpenChamber Delegation

If you are not `build`, stop reading here. Ignore the rest of this skill and continue your assignment under `coding-workflow`.

Use this skill when coordinating delegated work through OpenChamber. Follow the user's instructions and higher-priority tool and delegation rules; this skill does not grant permission to delegate or change tool parameters. Handle small, self-contained tasks directly.

## Routing

`build` is the main orchestrator, never a delegated worker. Every worker `session.create` must specify the authorized `agent`. If the tool requires the user's choice and it is missing, ask before dispatch. If the required profile is unavailable, report the blocker; never omit `agent` or substitute another profile.

- `explore`: read-only discovery for substantial cross-area traces or behavior still unclear after an initial search. Return file/line evidence and unknowns; do simple lookups directly.
- `general`: implement a bounded assignment and run its checks. Supply discovery findings first if needed. Return completed changes and verification without waiting for independent review.
- `reviewer`: independently assess a plan or diff against its criteria, investigating related code as needed. Return a verdict, evidence, required verification gaps, and optional advice separately.

These are alternatives, not mandatory stages. Leave `model` and `variant` unset unless the user requests a supported override. Workers must not delegate through tools, CLI, SDK, or API.

## Planning and tracking

For cross-subsystem changes, migrations, or rewrites with authorized independent review, obtain a reviewer-informed plan before implementation. Prefer the simplest sufficient approach. Define ordered slices, interfaces, dependencies, acceptance criteria, and final integration checks. Delegate one bounded implementation slice at a time. Track scope, status, worker session IDs, and verification evidence per slice; pass accepted interfaces and unresolved findings into dependent work.

For complex research, design decisions, or multiple dependent handoffs, maintain a parent-owned task-specific Markdown handoff with the plan, dependencies, decisions, progress, and next action. Choose a non-conflicting path, omit secrets, and do not commit it unless authorized. Give workers its absolute path and a self-contained assignment. Before resuming, reconcile recorded HEAD, worktree, and dirty state with reality. Small tasks need no handoff file.

## Handoff

Treat each new session as having no parent conversation. Give it the goal, relevant facts and paths, repository/worktree and relevant dirty state, bounded scope, whether changes are allowed, acceptance criteria, checks, and expected return. Specify unknowns and tell it not to delegate further. For review, provide the diff or base and request concrete findings with evidence. A read-only prompt is behavioral guidance, not a permission sandbox.

For independent discovery or review, request read-only work. For implementation, name the allowed scope and ask for changes, check results, and unresolved issues. Parallelize independent work when useful, but avoid concurrent writes to the same files; serialize dependent work.

## Session lifecycle

Use OpenChamber session actions, not a subagent tool. For work owned by the parent whose answer is needed, use `session.create` with `ownWork: true`, a prompt, and `returnResult: true`. Creation returns immediately; continue independent work or end the turn and resume on the delivered result. Do not poll, sleep, or call `session.messages` to wait for a callback. Use `session.send` for an appropriate continuation and include changed state and unresolved findings.

When the user wants a session to follow and talk to, create it without `ownWork`. Worktrees, branches, and other optional settings require their applicable authorization.

## Review loop and completion

When independent review is warranted and authorized, use a separate `reviewer` session, not the implementer. Provide the diff or base and prior findings. Send confirmed in-scope fixes back to the same `general` session, then re-review in the same `reviewer` session against the original criteria and direct regressions. Reuse `explore` for same-scope follow-up; use fresh workers for a new slice. If a session cannot continue, hand off to the same profile with the prior assignment, verdict, changes, current state, and remaining checks. Do not retry unchanged requests without new evidence.

The parent checks evidence and scope. Optional hardening, unrelated issues, and unexecuted checks are not confirmed defects. Obtain evidence for required verification gaps; report unresolved decisions or missing evidence as blockers. Discovery or review ends with a supported answer or precise blocker. Implementation is complete only when acceptance criteria, required checks, required independent review, and final integration checks pass. Slice approvals do not replace final verification.
