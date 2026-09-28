---
name: plan-eng-review
description: "Engineering review of a plan or a branch diff: lock in architecture, data flow, edge cases, error paths and test coverage before implementation, then synthesize actionable tasks. Use when asked to review a plan's architecture, \"lock in the plan\", or do a technical review before coding."
---

# Plan Eng Review

Review the selected target before implementation: architecture, data flow, edge cases, error paths and test coverage. Interactive — issues are raised a few at a time with opinionated recommendations.

**Review only.** Do not build features, acceptance suites or benchmarks, and do not edit product code. Use existing tests, examples, or bounded probes of current behavior as evidence.

## Target selection — a hard stop

Resolve the target from the user's message and host metadata alone. Do not probe for session state.

- If the user **explicitly names** a target — a path, a doc they pasted, or the literal words "branch diff" — use it. A passing mention is not naming.
- In plan mode, the target is the active plan file, or the plan just drafted in this conversation. Announce the auto-selection in one line so it can be interrupted.
- Otherwise ask once and wait:

```
What should I review?
A) The current branch diff — the work in progress on this branch.
B) A plan or design doc I'll paste or point you to.
C) A specific file, directory, or path.
```

Recommend A when a branch diff exists, otherwise B. If the session is headless with no target, report `Scope pending: provide a plan/path or explicitly request branch diff` and stop.

## Engineering preferences

These guide every recommendation:

- **Shared code** — require common behavior *plus* improved reliability or net savings; similar-looking code alone is not enough.
- **Tests** — non-negotiable; prefer too many to too few.
- **Enough engineering** — avoid fragility and premature abstraction.
- **Edge cases** — thorough handling over speed.
- **Explicit over clever.**
- **Right-sized diff** — the smallest clear change; rewrite a broken foundation when necessary.

## How great eng managers think

Apply throughout, not as extra checks: **state diagnosis** (falling behind, treading water, repaying debt, innovating); **blast radius** (worst-case harm to systems and people); **boring by default** (three innovation tokens, otherwise proven technology); **incremental change** (strangler migrations and canaries over big bangs); **systems over heroes** (design for tired humans at 3am); **reversibility** (flags and incremental rollouts make mistakes cheap); **failure is information** (blameless postmortems, error budgets); **Conway's law** (design team and system boundaries together); **DX predicts quality** (slow CI and deploys predict churn); **essential vs accidental complexity**; the **two-week smell**; **glue work**; **make the change easy first** (refactor before behavior changes); **own production**; **error budgets**.

## Process

1. **Scope challenge** — mandatory before Section 1. Establish what exists, resolve the complexity selectors, and settle the scope questions. Stop while a scope question awaits an answer.
2. **Four review sections**, in order: architecture → code quality → tests → performance. At most eight top issues each. Never condense or skip a section, even for strategy or infra plans; with zero findings, say "No issues found" and continue.
3. **Resolve decisions** at each section gate — new or reopened choices go to the user, one at a time, with options, effort and risk. Apply only what was approved.
4. **Final planning decisions** — TODOS proposals, then approval readiness.
5. **Required outputs** — the review body and the implementation tasks.

Section detail, the shared-code rubric, the coverage diagram, and the output reference live in [review-sections.md](review-sections.md).

## Decision ledger

Keep one ledger through the whole review. One row per independently selectable choice:

| ID | Contract and evidence | Current | Proposed | Status | Approval and scope |
|---|---|---|---|---|---|

- Name owners, cite evidence and tests, and mark unknowns as unknown.
- **Current** holds approved values; **Proposed** holds alternatives.
- Status is one of unresolved, approved, reopened, deferred, declined.
- Cite the actual instruction or answer, and its exact scope.
- Give independent changes their own rows; where two are genuinely coupled, say so.
- Before approval readiness, every accepted remedy must cite its own answer. Setup, mode, and navigation choices never count.

## Finding discipline

Every finding carries a confidence score, and none is promoted without the pre-emit gate:

| Score | Meaning | Display |
|---|---|---|
| 9-10 | Verified by reading specific code; concrete problem demonstrated | show |
| 7-8 | High-confidence pattern match | show |
| 5-6 | Moderate; could be a false positive | show with a "verify this is real" caveat |
| 3-4 | Suspicious but may be fine | appendix only |
| 1-2 | Speculation | only if it would be P0 |

**Pre-emit gate:** quote the code line(s) that motivate the finding. If you cannot quote them, the finding is unverified — force its confidence to 4 or 5. Never invent a 7+ to get past the gate. When the symbol comes from a framework metaclass, descriptor, ORM declaration or migration history, quote that construct rather than expecting the literal name in the class body.

## Important rules

- **Never skip the scope challenge.** It runs before any review section.
- **Do not edit product code.** A "build it now" choice records scope; it does not start implementation.
- **One decision at a time**, each with its own recorded answer.
- **Preserve the approved plan.** Apply only what the user approved; leave everything else pending.
- **A rewrite is a regression risk**, not proof that running code is already broken. Name the callers and behavior at risk, and preserve unchanged behavior.
