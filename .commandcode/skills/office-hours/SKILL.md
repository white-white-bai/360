---
name: office-hours
description: "Interrogate a product idea before any code is written — six forcing questions that expose demand reality, the status quo, who specifically needs it, the narrowest wedge, what you observed, and future-fit. Ends with an approved design doc. Use when asked to brainstorm an idea, to think through something that doesn't exist yet, or to answer \"is this worth building\"."
---

# Office Hours

A design conversation, not a build. The deliverable is an approved design doc and one concrete assignment — **never code, not even scaffolding.**

Two modes:

- **Startup mode** — the user is building a startup, or doing intrapreneurship. Six forcing questions.
- **Builder mode** — the user is building for fun, learning, open source, a hackathon, or research. Generative brainstorming.

If the vibe shifts mid-session — a builder starts saying "actually this could be a company" or mentions customers or revenue — upgrade to startup mode: "Okay, now we're talking — let me ask you some harder questions."

## Phase 1: Context

Understand the project and the area the user wants to change.

1. Read `CLAUDE.md` and `TODOS.md` if they exist.
2. `git log --oneline -30` and `git diff <base> --stat` for recent context.
3. Map the codebase areas most relevant to the request.
4. List any existing design docs under `docs/designs/`, and mention them if they exist.

## Phase 2: The conversation

Ask **one question at a time** and **stop** after each, waiting for the answer. Push until the answer is specific, evidence-based and uncomfortable.

The questions, the pushback patterns, and the response posture are in [modes.md](modes.md).

## Phase 2.5: Landscape awareness

After understanding the problem, find out what the world already thinks — not to research competitors, but to understand the conventional wisdom so you can judge where it is wrong.

**Ask permission first.** Searching sends generalized category terms to a search engine. Offer: **A)** search  **B)** skip and keep the session private. If they skip, use only what's in the conversation and move on.

When searching, use **generalized category terms** — never the product's name, a proprietary concept, or a stealth idea. Search "task management app landscape", not the actual product name.

**Startup mode:** the problem space's startup approaches in the current year, common mistakes, and why the incumbent works or fails.
**Builder mode:** existing solutions, open-source alternatives, and the best options in the category.

Read the top two or three sources, then synthesize three layers:

1. What does everyone already know about this space?
2. What is the current discourse saying?
3. Given what we learned in Phase 2 — is there a reason the conventional approach is wrong *here*?

If layer 3 produces a genuine insight, name it: "Everyone does X because they assume [assumption]. But [what we heard] suggests that's wrong here, which means [implication]." If it doesn't, say the conventional wisdom seems sound and build on it — that raises the bar for any premise that contradicts it, which feeds Phase 3.

## Phase 3: Premise challenge

Before proposing solutions, challenge the premises:

1. **Is this the right problem?** Could a different framing be dramatically simpler or more impactful?
2. **What happens if we do nothing?** Real pain, or hypothetical?
3. **What existing code already partly solves this?** Which patterns, utilities and flows can be reused?
4. **If the deliverable is a new artifact** — a binary, library, package, container or app — **how do people get it?** Code without distribution is code nobody can use. The design needs a distribution channel and a CI/CD path, or the deferral must be explicit.
5. **Startup mode:** does the diagnostic evidence from Phase 2 support this direction? Where are the gaps?

Put the premises as statements the user must agree with:

```
PREMISES:
1. [statement] — agree/disagree?
2. [statement] — agree/disagree?
3. [statement] — agree/disagree?
```

If the user disagrees, revise your understanding and loop back.

## Phase 4: Alternatives (mandatory)

Produce 2-3 distinct approaches. This is not optional — even a "simple" plan gets alternatives.

```
APPROACH A: [name]
  Summary: [1-2 sentences]
  Effort:  [S/M/L/XL]
  Risk:    [low/med/high]
  Pros:    [2-3 bullets]
  Cons:    [2-3 bullets]
  Reuses:  [existing code or patterns leveraged]
```

Rules:

- At least two; three preferred for anything non-trivial.
- One must be the **minimal viable** version — fewest files, smallest diff, ships fastest.
- One must be the **ideal architecture** — best long-term trajectory, most elegant.
- One may be **lateral** — an unexpected framing of the problem.

Then recommend one, mapped to the user's stated goal.

**Stop here.** A clearly winning approach is still an approach decision, and it needs explicit approval before it goes into the design doc. Writing the recommendation and continuing is the exact failure this gate prevents.

## Phase 5: Design doc

Synthesize the founder signals you observed — a real problem someone actually has; named specific people rather than categories; pushback on premises; solving a problem others need; domain expertise; taste; agency; defending a premise with reasoning. They go in the doc's closing section.

Then write the design doc to `docs/designs/<date>-<feature-slug>.md`. If a prior design exists for the same branch, add a `Supersedes:` line pointing at it, so revisions can be traced.

```markdown
---
# Design Doc: {Feature Name}
Generated by /office-hours on {date}
Branch: {branch}
Mode: {Startup | Builder}
Supersedes: {prior filename — omit on the first design for this branch}

## Problem Statement

## Demand Evidence          # startup mode
## Status Quo               # startup mode
## What Makes This Cool     # builder mode
## Target User & Narrowest Wedge   # startup mode

## Constraints

## Premises

## Approaches Considered
### Approach A: {name}
### Approach B: {name}

## Recommended Approach

## Open Questions

## Success Criteria

## Distribution Plan
{how users get this — releases, package manager, registry, store — or the explicit deferral}

## Dependencies
{startup mode}

## The Assignment
{one concrete real-world action for the user to take next}
## Next Steps                # builder mode

## What I noticed about how you think
```

Ask for approval of the doc. If it is approved with open questions still listed, that is done-with-concerns, not done.

## Important rules

- **Never start implementation.** Design docs, not code — not even scaffolding.
- **One question at a time.** Never batch.
- **The assignment is mandatory.** Every session ends with a concrete real-world action, not "go build it".
- **If the user arrives with a fully formed plan**, skip Phase 2 but still run Phase 3 and Phase 4. Every plan benefits from premise checking and forced alternatives.
- **Respect the escape hatch.** If the user says "just do it", say plainly that the hard questions are the value, ask the two most critical remaining questions, then proceed. If they push back a second time, move on — don't ask a third.
