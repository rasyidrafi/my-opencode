---
name: openchamber-delegation
description: Coordinate authorized delegated work through OpenChamber sessions, including bounded handoffs, model selection, callbacks, and independent review.
---

# OpenChamber Delegation

Use this skill when coordinating delegated work through OpenChamber. Follow the user's instructions and higher-priority tool and delegation rules; this skill does not grant permission to delegate or change tool parameters. Handle small, self-contained tasks directly.

Use the available build agent and define the role in the prompt, rather than assuming separate explorer or reviewer agents exist. Consult [model-routing.md](model-routing.md) for provisional model choices; explicit user choices and tool restrictions take precedence.

## Handoff

Treat each new session as having no parent conversation. Give it the goal, relevant facts and paths, repository/worktree and relevant dirty state, bounded scope, whether changes are allowed, acceptance criteria, checks, and expected return. Specify unknowns and tell it not to delegate further. For review, provide the diff or base and request concrete findings with evidence. A read-only prompt is behavioral guidance, not a permission sandbox.

For independent discovery or review, request read-only work. For implementation, name the allowed scope and ask for changes, check results, and unresolved issues. Parallelize independent work when useful, but avoid concurrent writes to the same files; serialize dependent work.

## Session lifecycle

Use OpenChamber session actions, not a subagent tool. For work owned by the parent whose answer is needed, use `session.create` with `ownWork: true`, a prompt, and `returnResult: true`. Creation returns immediately; continue independent work or end the turn and resume on the delivered result. Do not poll, sleep, or call `session.messages` to wait for a callback. Use `session.send` for an appropriate continuation and include changed state and unresolved findings.

When the user wants a session to follow and talk to, create it without `ownWork`. Set agent or variant only when the user asks, as required by the tool. Do not specify a variant unless it is available and requested. Worktrees, branches, and other optional session settings require their applicable authorization.

## Integrate and verify

The parent owns the final outcome. Check delegated findings against evidence, integrate changes without overwriting unrelated work, and run relevant checks. When an independent review is warranted and authorized, use a separate session with a read-only review prompt. Fix confirmed in-scope issues and recheck; distinguish optional suggestions, unexecuted checks, and blockers from failures. Report the outcome and verification honestly.
