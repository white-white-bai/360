---
name: investigate
description: "Root-cause debugging loop for hard bugs. The Iron Law: no fix without a proven root cause. Use when the user says \"investigate this\", reports an error or stack trace, or asks why something stopped working."
---

# Investigate

**Iron Law: no fixes without root-cause investigation first.**

Fixing symptoms creates whack-a-mole debugging. Every fix that doesn't address the root cause makes the next bug harder to find. Find the cause, then fix it.

For the technique of building a tight, red-capable feedback loop, see the `diagnosing-bugs` skill. This skill is the loop's *discipline*, and the report it ends with.

## Phase 1: Root-cause investigation

Gather evidence before forming any hypothesis.

1. **Collect the symptoms.** Read the error message, the stack trace, the reproduction steps. If context is missing, ask one question at a time.
2. **Read the code.** Trace the path from the symptom back to the candidates: `grep` for every reference, read the logic end to end.
3. **Check what changed.** `git log --oneline -20 -- <affected files>`. If this worked before, the root cause is in the diff.
4. **Reproduce.** Can you trigger it deterministically? If not, gather more evidence before going further.
5. **Check the history.** Recurring bugs in the same area are an architectural smell, not a coincidence. Check `TODOS.md` and prior fixes in the same files.

## Scope lock

Once you have a root-cause hypothesis, narrow your edits to the affected module, and state the boundary you are holding to before you start editing.

If the bug spans the whole repo, or the scope is genuinely unclear, skip the lock and say why.

## Phase 2: Pattern analysis

Does the bug match a known shape?

| Pattern | Signature | Where to look |
|---|---|---|
| Race condition | intermittent, timing-dependent | concurrent access to shared state |
| Nil/null propagation | NoMethodError, TypeError | missing guards on optional values |
| State corruption | inconsistent data, partial updates | transactions, callbacks, hooks |
| Integration failure | timeout, unexpected response | external calls, service boundaries |
| Configuration drift | works locally, fails in staging/prod | env vars, flags, DB state |
| Stale cache | shows old data, clears on cache reset | Redis, CDN, HTTP cache |

If it matches none of these, search the web for the **error category**, not the raw message — sanitize first: strip hostnames, IPs, file paths, SQL, and customer data. Search `"{framework} {generic error type}"` and `"{library} {component} known issues"`. A documented cause becomes a candidate hypothesis in Phase 3.

## Phase 3: Hypothesis testing

Before writing any fix, test the hypothesis.

1. **Confirm it.** Add a temporary log, assertion, or debug statement at the suspected cause. Run the reproduction. Does the evidence match?
2. **If it's wrong.** Before forming the next hypothesis, return to Phase 1 and gather more evidence. Do not guess.
3. **Three-strike rule.** After three failed hypotheses, **stop** and ask the user:
   ```
   Three hypotheses tested, none match. This may be architectural
   rather than a simple bug.

   A) Continue — I have a new hypothesis: [describe]
   B) Escalate for human review
   C) Add logging and wait — instrument and catch it next time
   ```

**Red flags** — slow down if you see any:

- "Quick fix for now" — there is no "for now". Fix it right or escalate.
- A fix proposed before the data flow is traced — that's a guess.
- Each fix reveals a new problem elsewhere — wrong layer, not wrong code.

## Phase 4: Implementation

Once the root cause is confirmed:

1. **Fix the cause, not the symptom** — the smallest change that removes the actual problem.
2. **Minimal diff** — fewest files, fewest lines. Resist refactoring adjacent code.
3. **Write a regression test** that fails without the fix and passes with it.
4. **Run the full suite** and paste the output. No regressions.
5. **If the fix touches more than five files**, flag the blast radius and ask before proceeding.

## Phase 5: Verification and report

Reproduce the original scenario and confirm the fix. This is not optional.

Output a structured report:

```
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong]
Fix:             [what changed, with file:line]
Evidence:        [test output]
Regression test: [file:line of the new test]
Related:         [TODOS.md items, prior bugs in the area]
════════════════════════════════════════
```

## Important rules

- **Three or more failed fixes → stop and question the architecture.** It's the design, not the hypothesis.
- **Never apply a fix you cannot verify.** No reproduction, no fix.
- **Never say "this should fix it."** Prove it and run the tests.
- **A fix touching more than five files needs the user's sign-off** on the blast radius before you proceed.
