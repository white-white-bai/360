---
name: review
description: "Pre-landing review of the current diff for the structural bugs tests don't catch — SQL and data safety, race conditions, LLM trust boundaries, shell injection, enum completeness — then fixes what it finds. Use when the user asks to review a PR, check a diff, or review code about to be merged."
---

# Review

Hunt the bugs that pass CI and blow up in production: unsafe data access, races, trust-boundary violations, and values that don't survive their consumers. Every finding gets an action — obvious mechanical fixes are applied, genuinely ambiguous ones are batched into one question.

This is a structural review, not a style review. For the two-axis standards/spec review of a diff, use the `code-review` skill instead.

Categories, suppressions, and the fix-first heuristic live in [checklist.md](checklist.md). The deeper lenses live in [specialists.md](specialists.md).

## Process

### 1. Get the diff

1. `git branch --show-current`. If you're on the base branch, report **"Nothing to review — you're on the base branch or have no changes against it."** and stop.
2. Resolve the base branch: the PR/MR target if one exists, else the repo default (`git symbolic-ref refs/remotes/origin/HEAD`, then `origin/main`, then `origin/master`, then `main`).
3. `git fetch origin <base> --quiet`, then `DIFF_BASE=$(git merge-base origin/<base> HEAD)` and `git diff "$DIFF_BASE"`.

This includes committed and uncommitted work while excluding commits that landed on the base after the branch was cut. **Read the full diff before commenting** — most false positives are issues already handled elsewhere in the diff. Read non-ignored untracked source files too (`git ls-files --others --exclude-standard`).

### 2. Scope drift

Before quality, check whether the branch built **what was asked — nothing more, nothing less**.

1. Establish the stated intent from the PR body, the commit messages (`git log origin/<base>..HEAD --oneline`), and `TODOS.md`. If there is no PR, commit messages alone are the normal case.
2. Compare the changed files against that intent.

- **Scope creep**: files unrelated to the intent; features or refactors nobody asked for; "while I was in there" changes that widen the blast radius.
- **Missing requirements**: stated requirements not addressed; partial implementations; test gaps against the stated requirements.

Report it before the main pass:

```
Scope Check: [CLEAN / DRIFT DETECTED / REQUIREMENTS MISSING]
Intent:      <what was requested>
Delivered:   <what the diff actually does>
```

This is informational — it does not block the review.

### 3. Critical pass

Apply the CRITICAL categories from [checklist.md](checklist.md) to the diff: **SQL & Data Safety, Race Conditions & Concurrency, LLM Output Trust Boundary, Shell Injection, Enum & Value Completeness**. Then the INFORMATIONAL categories.

**Enum & Value Completeness requires reading code outside the diff.** When the diff adds an enum value, status, tier, or type constant, grep for the sibling values, then **read** every file that switches on, filters by, or displays that value. A consumer that doesn't handle the new value is the finding. Same for allowlists containing the siblings, and `case`/`if` chains where the new value falls through to a wrong default.

**Search before recommending.** Before proposing a fix pattern — especially for concurrency, caching, auth, or framework-specific behavior — check that the pattern is current best practice for the framework version in use, and whether a built-in replaces the workaround. Use `web_search`; if you can't reach it, say so and proceed on in-distribution knowledge.

### 4. Calibration and the pre-emit gate

Every finding carries a confidence score:

| Score | Meaning | Display |
|---|---|---|
| 9-10 | Verified by reading specific code. Concrete bug or exploit demonstrated. | show |
| 7-8 | High-confidence pattern match. | show |
| 5-6 | Moderate; could be a false positive. | show with a "verify this is real" caveat |
| 3-4 | Suspicious but may be fine. | appendix only |
| 1-2 | Speculation. | only if severity would be P0 |

Format: `[P1] (confidence: 9/10) path/file.rb:42 — SQL injection via string interpolation in the where clause`.

**Pre-emit gate — before any finding reaches the report:**

1. **Quote the code line(s) that motivate it** — file:line plus the verbatim text. "Field X doesn't exist on model Y" requires quoting the class body where the field would live. "Race between A and B" requires quoting both.
2. **If you cannot quote it, the finding is unverified** — force its confidence to 4 (appendix) or 5 (reported with the caveat). Never invent a 7+ to get past the gate.

When the symbol comes from a framework metaclass, descriptor, ORM declaration, or migration history, quote that construct instead of expecting the literal name in the class body. The verification is "I read the source that creates this symbol", not "I grepped for the name and didn't find it".

### 5. Specialist lenses

Run the applicable lenses from [specialists.md](specialists.md) after the critical pass — security, performance, API contract, data migration, maintainability, testing, simplification, red-team. Each names its own trigger conditions. Fold their findings into the same list; do not report a lens as run if it produced nothing.

### 6. Fix-first

**Every finding gets an action.**

1. **Classify** each as AUTO-FIX or ASK using the heuristic in [checklist.md](checklist.md). Critical findings lean ASK (riskier); informational lean AUTO-FIX (more mechanical). The rule of thumb: if a senior engineer would apply it without discussion, AUTO-FIX; if reasonable engineers could disagree, ASK.
2. **Apply every AUTO-FIX** directly. One line each: `[AUTO-FIXED] [file:line] Problem → what you did`.
3. **Batch the ASK items into one question** — numbered, with severity, the problem, the recommended fix, and an A) Fix / B) Skip choice per item, plus an overall recommendation. Fewer than three items may be asked individually.

Header: `Pre-Landing Review: N issues (X critical, Y informational)`. If nothing is found: `Pre-Landing Review: No issues found.`

**Verification of claims.** "This looks fine" is not a finding — cite the line that proves it, or mark it unverified. If you claim something is handled elsewhere, read and cite the handler. If you claim tests cover it, name the file and method. Never write "likely handled" or "probably tested".

### 7. Cross-reference

- **TODOS.md** (if present): note TODOs this work closes, work that should become a TODO, and related context. Skip silently if absent.
- **Documentation staleness**: for each root `.md` doc (README, ARCHITECTURE, CONTRIBUTING, CLAUDE.md), if the diff changed behavior it describes and the doc wasn't updated, raise an INFORMATIONAL finding suggesting a docs pass. Never critical.

## Important rules

- **Read the full diff before commenting.** Don't flag what the diff already fixes.
- **Fix-first, not read-only.** AUTO-FIX items are applied; ASK items only after approval. Never commit, push, or open a PR — that's shipping's job.
- **Be terse.** One line for the problem, one for the fix. No preamble, no "looks good overall".
- **Only flag real problems.** Respect the suppression list.
- **Simple, focused fixes.** The smallest change that removes the problem.
