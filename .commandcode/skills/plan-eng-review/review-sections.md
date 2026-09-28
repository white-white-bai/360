# Plan eng review — sections and outputs

## Decision procedure

At each section's gate: **analyze**, **resolve**, **apply**.

- **Analyze.** Check the input, the sources, and the actual approvals. Correct false claims without changing approved behavior. Flag approval conflicts. Unavailable code proves neither failure nor safety — record unknown risks with an owner and the verification they need.
- **Resolve.** If the section needs a new decision, put it to the user (one row per call) and wait for the answer. If every choice is settled, cite the answers and go straight to Apply. Resolve critical risks now; leave rows owned by other sections alone. Keep independent fixes in separate rows.
- **Apply.** Check the plan against each answer's exact scope. Preserve existing content, approved behavior and required tests. Leave unapproved remedies pending — do not put them into tasks or diagrams. If the plan already matches, do not re-save it.

Record findings and dispositions, then move to the next section. Do not write a section's conclusions or tasks before reviewing it. An approval is not proof of implementation.

## Scope challenge

Runs before Section 1 and is mandatory. Stop while a question awaits an answer.

**A. Assess the target.** What is being built, what already exists, and what is the smallest change that reaches the goal? Name anything in the target that is speculative.

**B. Resolve the complexity selectors.** Count the new classes, services, files and moving parts. Where the count is high, challenge whether fewer parts reach the same goal, and identify work that can be deferred without blocking the goal.

**C. Resolve the findings.** Anything that changes scope goes to the user before Section 1. Keep stated invariants and acceptance criteria in scope; repairs needed to meet them are in scope.

---

## Section 1: Architecture review

- System and component boundaries, dependencies, coupling.
- Data flow, bottlenecks, scaling, single points of failure.
- Security: auth, data access, API boundaries.
- Key flows that need ASCII diagrams in the plan or the code.
- One realistic production failure per new path or integration — and whether the plan handles it.
- **Distribution architecture** for new artifacts: build, publish and update paths; is CI/CD in scope or deferred?

## Section 2: Code quality review

- Organization and module structure.
- **Shared-code opportunities** in the target and its related callers, using the rubric below. No standalone history sweep and no quotas. Check proposed caller assumptions against existing interfaces.
- Error-handling gaps and missing edge cases, flagged explicitly.
- Technical debt, fragility and needless complexity, against the engineering preferences.
- Accuracy of the ASCII diagrams in the touched files.

### Shared-code rubric

- **Prove the callers.** Require at least two verified, first-party authored source locations, with functions and lines. Added or uncommitted source qualifies. Only a plan review may use proposed callers — label those assumptions and distinguish them from existing source. Similar names or formatting alone prove nothing. Generated and third-party copies never qualify as callers; follow generated copies back to their authored templates.
- **Reuse before extracting.** Inspect existing libraries and helpers first, comparing behavior, inputs, outputs, error handling, side effects, security requirements, dependencies and deployment boundaries. Preserve the differences callers need. Do not bridge languages or isolated deployments without a practical shared contract.
- **Keep the helper small.** Name its destination and contract, the callers to migrate, and the smallest adoption sequence. Avoid option-heavy helpers and coupling unrelated components. Point to existing tests, specify shared-contract and caller-integration coverage, and describe the blast radius of a shared failure.
- **Account for the whole change.** Name the removed blocks and their replacements. Report implementation lines removed, added and saved separately from the total including tests and integration. Savings = removed − added. Count moved code on both sides, exclude generated and vendor lines, use ranges when uncertain, and never count overlapping removals twice. Say when tests or integration may make the change grow.
- **Rank useful changes.** Favour reliability gains and total net savings, then low adoption and testing risk. Prefer proven code with several callers. Recent activity breaks ties; it is not evidence on its own. Reject similarities with incompatible contracts.

Scope approval does not approve an extraction — take it through the decision gate.

## Section 3: Test review

100% coverage is the goal. Identify the tests each planned codepath needs. **Review the requirements here; do not build the tests.**

First, detect the test framework: read `CLAUDE.md` for a testing section, and if there is none, infer from the manifest and config (`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `Cargo.toml`) and the test-file naming already in the repo. If no framework is detected, say so and continue — do not install one during review.

**Step 1 — trace every codepath.** Read the plan (and, where the target is concrete, the actual source and tests). Starting from each entry point, follow the data: where the input comes from, what transforms it, where it goes, and what can go wrong at each step. Diagram the execution in ASCII — every function in scope, every conditional branch, every error path, every call into another function, and every edge (null input, empty array, invalid type). **Every branch in this diagram needs a test.**

**Step 2 — map user flows and interactions.** Coverage is not enough; cover how real users touch the target. Full journeys (each step needs a test), interaction edge cases (double-click, navigate away mid-operation, stale data, slow connection, two tabs), user-visible error states (clear message or silent failure? recoverable?), and empty/zero/boundary states (zero results, ten thousand results, one character, maximum length). A flow with no test is a gap, exactly like an untested `if`.

**Step 3 — check each branch against existing tests.** Branch by branch, code paths and user flows both, find the test that exercises it. Score what you find:

- ★★★ tests behavior with edge cases **and** error paths
- ★★ tests correct behavior, happy path only
- ★ smoke test or trivial assertion

**E2E decision matrix** — mark the diagram accordingly:

- **→E2E**: a common flow spanning three or more components; an integration point where mocking hides real failures; auth, payment or data-destruction flows.
- **→EVAL**: a critical LLM call; changes to prompt templates, system instructions or tool definitions.
- **Unit**: a pure function; an internal helper with no side effects; a single-function edge case; an obscure non-customer-facing flow.

**Regression rule (mandatory).** When a planned change puts existing behavior at risk without regression coverage, that coverage is a critical requirement. Ask how to cover it, never whether to skip it. Name the existing callers and behavior at risk, preserve unchanged behavior, and identify intended differences explicitly.

**Step 4 — output the coverage diagram.** Both code paths and user flows, in one diagram:

```
CODE PATHS                                  USER FLOWS
[+] src/services/billing.ts                 [+] Payment checkout
  ├── processPayment()                        ├── [★★★ TESTED] Complete purchase — checkout.e2e.ts:15
  │   ├── [★★★ TESTED] happy + declined       ├── [GAP] [→E2E] Double-click submit
  │   ├── [GAP]         network timeout       └── [GAP]        Navigate away mid-payment
  │   └── [GAP]         invalid currency
  └── refundPayment()                       [+] Error states
      ├── [★★  TESTED] full refund — :89       ├── [★★  TESTED] Card declined message
      └── [★   TESTED] partial — :101          └── [GAP]        Network timeout UX

COVERAGE: 5/13 paths (38%)  |  Code paths 3/5 (60%)  |  User flows 2/8 (25%)
QUALITY: ★★★:2 ★★:2 ★:1  |  GAPS: 8 (2 E2E, 1 eval)
```

Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke check | →E2E needs an integration test | →EVAL needs an LLM eval.

Prefer `[GAP]`, `[★★ TESTED]`, `[→E2E]`, `[→EVAL]` over bare checkboxes. If every path is covered, say so and still check LLM/eval scope.

**Step 5 — specify the missing tests.** For each gap, name the test file (matching existing naming conventions), the assertion (specific inputs to expected behavior), and the type (unit / E2E / eval). Flag regression risks as **CRITICAL** and name the behavior they protect.

Collect the approved requirements into a test plan:

```markdown
# Test Plan
Generated by /plan-eng-review on {date}
Branch: {branch}

## Affected pages / routes
## Key interactions to verify
## Edge cases
## Critical paths
## Pending decisions
```

Include only what a tester needs to know — what to test and where, not implementation detail.

## Section 4: Performance review

N+1 and database access, memory, caching, and slow or complex paths.

---

## Final planning decisions

### TODOS.md updates

Review every potential TODO and ask about each unanswered proposal in its own question — never batch them. For each, record **What**, **Why**, **Pros**, **Cons** (cost, complexity, risk), **Context** (motivation, current state, where to start in three months), and **Depends on / blocked by**.

Then offer: **A)** add to `TODOS.md` **B)** skip, not valuable enough **C)** build it now. Option C records accepted scope; it still does not start implementation.

### Approval readiness

Check the ledger against every accepted remedy: each must cite its own answer or exact prior approval. Setup, mode, approach and navigation choices do not count. Carry forward an approved regression contract; otherwise its behavior and assertions need a decision. If approval is missing, mark that draft pending and resolve it before continuing.

Record `Approval readiness: PASS` with the checked IDs. A substantive change invalidates it.

## Required outputs

1. **The review body** — the plan under review, the sections below, and the implementation tasks.
2. **Present the completion summary** to the user.
3. **List unresolved decisions**, each with its owner.

### "NOT in scope"

Work that was explicitly deferred, one sentence of explanation each.

### "What already exists"

Link the existing solutions, and distinguish reuse from rebuilding. For accepted shared-code choices, reference their code-quality and test decisions with the rubric evidence. Never re-ask a settled remedy.

### Diagrams

ASCII for non-trivial flows, states and pipelines. Name the files that need inline diagrams for complex model, service or mixin behavior.

### Failure modes

For each diagrammed path: a realistic production failure, its test and error-handling coverage, and whether the user sees a clear error or a silent failure.

**If a failure mode has no test, no error handling, and would be silent, flag it as a critical gap.**

### Worktree parallelization

Group the implementation into parallel workstreams. With one primary module, or fewer than two independent streams, write "Sequential implementation, no parallelization opportunity."

Otherwise give a dependency table, using modules rather than guessed files:

| Step | Modules touched | Depends on |
|---|---|---|
| (step name) | (directories/modules) | (other steps, or —) |

Disjoint modules run together; shared modules run sequentially, dependencies later. Name the launch and wait points, and flag cross-lane shared modules.

### Implementation tasks

Synthesize a flat list of build-actionable tasks. Each derives from a specific finding — no padding.

```markdown
## Implementation Tasks

- [ ] **T1 (P1)** — <component> — <imperative title>
  - Surfaced by: <section> — <finding text or line reference>
  - Files: <paths to touch>
  - Verify: <test command or manual check>
```

- **P1** blocks shipping; **P2** should land on the same branch; **P3** is a follow-up TODO.
- If a finding produced no actionable task, do not invent one.
- If a section had zero findings, write `_No new tasks from <section>._`
- Note an effort estimate per task and state the assumption behind it.
