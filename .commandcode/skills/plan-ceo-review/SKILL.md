---
name: plan-ceo-review
description: "Founder-mode review of a plan: rethink the problem, challenge the premises, and choose a scope posture (expand, hold, or cut) before deciding how to build it. Use when asked for a strategy review, to \"think bigger\", to test whether a plan is ambitious enough, or to sanity-check scope."
---

# Plan CEO Review

Review a plan the way a founder would: question whether it solves the real problem, whether the scope is right, and what it costs to leave something out. **Review only — do not write code.**

Pick one posture before reviewing, and hold it:

- **SCOPE EXPANSION** — build the platonic ideal: 10x better for 2x effort.
- **SELECTIVE EXPANSION** — harden the current scope, then offer expansions one at a time to cherry-pick.
- **HOLD SCOPE** — keep the scope and make it rigorous: trace failures, edge cases, error paths, tests, observability.
- **SCOPE REDUCTION** — propose the minimum viable core; cut only with approval.

Completeness is cheap: prefer a complete ~150-line change over a 90% ~80-line one.

## Prime directives

1. **Zero silent failures** — every failure surfaces to the system, the team, and the user.
2. **Name each error's class, trigger, handler, user-visible result, and test.** Flag catch-alls.
3. **Trace four paths** for every flow: happy, nil/missing, empty/zero, upstream-error.
4. **Map interactions:** double-clicks, navigating away, slow links, stale state, the back button.
5. **Dashboards, alerts and runbooks are launch scope**, not follow-up.
6. **Require ASCII diagrams** for new flows, state, pipelines, dependencies and decisions.
7. **Record every deferral** in `TODOS.md`.
8. **Optimize for the six-month future**; flag future harm now.
9. **Propose better approaches**, including "scrap it and do this instead".

## Step 0: Scope challenge and mode selection

### 0A. Challenge the premise

Name the real problem, the target outcome, and the cost of doing nothing. Does the plan solve the actual pain, or a proxy for it?

### 0B. Existing code leverage

Map each sub-problem to code that already exists. For anything being rebuilt, say why refactoring the existing path is worse.

### 0C. Dream-state mapping

Describe the 12-month ideal and whether this plan moves toward it:

```
CURRENT STATE      --->   THIS PLAN            --->   12-MONTH IDEAL
[describe]                [describe delta]             [describe target]
```

### 0D. Alternatives

For each unresolved approach decision, offer 2-3 options with effort (S/M/L/XL), risk (low/med/high), maintenance burden, and at least two pros and one con. Include "do nothing" where that is reasonable. State the changed-file cost now and the maintenance cost later.

**Wait for the answer.** A recommendation is not approval.

### 0E. Mode selection

Recommend a mode; do not select it. Count the planned file additions, edits and deletions, labelling estimates.

- More than 15 planned changed files → recommend **SCOPE REDUCTION**.
- Otherwise: a new product or system → **SCOPE EXPANSION**; an added capability → **SELECTIVE EXPANSION**; a fix or refactor → **HOLD SCOPE**.
- If the categories overlap or are unclear, say why and recommend **HOLD SCOPE**.

An explicit request wins: "go big"/"ambitious" means expansion; "hold scope but tempt me"/"show me options" means selective expansion. State the selected mode, its rationale, and which scope decisions are already approved before starting the sections.

### 0F. Mode-specific analysis

**SCOPE EXPANSION** — the 10x check (10x value for 2x effort); the platonic ideal (what would the best engineer with unlimited time and perfect taste build? start from the user's experience); a delight scan of at least five adjacent 30-minute improvements.

**SELECTIVE EXPANSION** — run the HOLD SCOPE checks below first, then the 10x ambition, delight scan, and platform potential. Present the top five or six candidates.

**HOLD SCOPE** — complexity check: over 8 files, or more than 2 new classes or services, challenge whether fewer moving parts reach the same goal. Find the minimum change set, keeping stated invariants and acceptance criteria in scope.

**SCOPE REDUCTION** — propose the minimum scope, and resolve each proposed cut individually.

For each addition ask separately: **A)** add to scope **B)** defer to `TODOS.md` **C)** skip. For each cut: **A)** defer **B)** keep. Accepted items govern the remaining sections; deferred and rejected work is listed as excluded.

### 0G. Temporal interrogation

For expansion and hold modes, resolve feasibility blockers now and walk the implementer's timeline:

```
HOUR 1 (foundations):    What does the implementer need to know?
HOUR 2-3 (core logic):   What ambiguities will they hit?
HOUR 4-5 (integration):  What will surprise them?
HOUR 6+ (polish/tests):  What will they wish they had planned for?
```

## The review sections

Run the eleven sections in [review-sections.md](review-sections.md) — but only once scope and mode are settled. Sections 1-10 always; Section 11 only when the plan has UI scope.

Each section ends at a **decision gate**: analyze against the current plan, resolve any new or reopened decision with the user, then apply only what was approved. Review only — never change code.

Under context pressure this order holds: scope challenge, then system audit, then error/rescue map, then test diagram, then failure modes, then opinionated recommendations, then everything else. Never skip the first four.

## Closing

1. **Outside voice** — if another model or reviewer is available, have it challenge the finished plan, and resolve its findings the same way. If not, say plainly that the plan was not independently reviewed.
2. **Draft implementation tasks** from the approved plan, listing the files each touches.
3. **List unresolved decisions**, each with its owner.

## Important rules

- **Review only.** Do not change code or implement.
- **Approval is required for every scope change.** Raise concerns during Step 0, then commit: no arguing for less in expansion mode, no silent additions in selective mode, no restoring scope in reduction mode.
- **One decision per question.** Describe the problem with file and line references, give 2-3 options with effort, risk and maintenance burden, and connect the recommendation to a specific engineering preference.
- **An "obvious fix" still needs approval** when no accepted decision covers it.
- **Record every deferral** in `TODOS.md`.
