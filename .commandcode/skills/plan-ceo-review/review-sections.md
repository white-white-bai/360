# Plan CEO review — the eleven sections

Run Sections 1-10 in every review; run Section 11 only when the plan has UI scope.

Each section ends at a **decision gate**: analyze the plan against that section, resolve new or reopened decisions with the user, then apply only what was approved. Review only — do not change code. Record findings and dispositions, then move to the next section. Do not write a section's conclusions or tasks before reviewing it.

Use **CRITICAL GAP** / **WARNING** / **OK** to keep findings scannable.

---

## Section 1: Architecture review

Publish the current accepted scope and mode first, then evaluate and diagram:

- System design and component boundaries — draw the dependency graph.
- **Data flow, all four paths.** For every new flow, an ASCII diagram of the happy path, the nil path (input missing), the empty path (present but zero-length), and the error path (upstream call fails).
- **State machines.** One ASCII diagram per new stateful object, including impossible transitions and what prevents them.
- **Coupling.** What new coupling appears, and is it justified? Draw the before/after dependencies.
- **Scaling.** What breaks first at 10x and at 100x load?
- **Single points of failure** — map them.
- **Security architecture.** Auth boundaries, data access, API surfaces. For each new endpoint or mutation: who can call it, what do they get, what can they change?
- **Production failure scenarios.** For each integration point, one realistic failure, and whether the plan handles it.
- **Rollback posture.** If this ships broken, name the rollback path and the time it takes.

*Expansion modes:* what would make this architecture elegant and obvious to a new engineer? What infrastructure turns it into a platform for later features?

**Required diagram:** full system architecture with new components and their relationship to existing ones.

## Section 2: Error & rescue map

The section that catches silent failures. Not optional.

Map every new method, service or codepath that can fail:

```
METHOD/CODEPATH        | WHAT CAN GO WRONG     | EXCEPTION CLASS
-----------------------|-----------------------|-----------------
ExampleService#call    | API timeout           | TimeoutError
                       | API returns 429       | RateLimitError
                       | malformed JSON        | JSONParseError
```

```
EXCEPTION CLASS        | RESCUED? | RESCUE ACTION        | USER SEES
-----------------------|----------|----------------------|------------------
TimeoutError           | Y        | Retry 2x, then raise | Temporary outage
RateLimitError         | Y        | Backoff and retry    | Transparent
JSONParseError         | N ← GAP  | —                    | 500 ← BAD
```

Rules:

- **Catch-all handling** (`rescue StandardError`, `catch (Exception e)`, `except Exception`) is always a smell. Name the specific exceptions.
- Generic-only logging is insufficient. Log what was attempted, with what arguments, for which user or request.
- Every rescued error must retry with backoff, degrade gracefully with a user-visible message, or re-raise with added context. "Swallow and continue" is almost never acceptable.
- For each GAP, specify the rescue action and what the user should see.
- For LLM calls, treat malformed, empty, hallucinated-invalid JSON and refusals as distinct failure modes.

## Section 3: Security & threat model

Security gets its own section, not a sub-bullet of architecture.

- **Attack surface expansion** — new endpoints, parameters, file paths, background jobs.
- **Input validation.** For every new input: validated, sanitized, and rejected loudly? What about nil, empty string, a string where an integer is expected, over-length strings, unicode edge cases, injection attempts?
- **Authorization.** For every new data access: scoped to the right user or role? Any direct object reference? Can user A reach user B's data by changing an ID?
- **Secrets.** New ones in env vars, not hardcoded, and rotatable?
- **Dependency risk.** New packages — what's their security track record?
- **Data classification.** PII, payment data, credentials — handled consistently with existing patterns?
- **Injection vectors.** SQL, command, template, and LLM prompt injection.
- **Audit logging** for sensitive operations.

For each finding: threat, likelihood (H/M/L), impact (H/M/L), and whether the plan mitigates it.

## Section 4: Data flow & interaction edge cases

Trace data and interactions adversarially.

**Data flow tracing.** For every new flow, diagram `INPUT -> VALIDATION -> TRANSFORM -> PERSIST -> OUTPUT` with shadow paths for nil/empty/wrong type, invalid/too long, exception/timeout/OOM, conflict/duplicate/lock, and stale/partial/bad encoding. For each node: what happens on each shadow path, and is it tested?

**Async ordering.** For flows sharing mutable state:

1. **Define the boundary** — the invariant and its exact caller and time boundary. Draw a combined schedule with one column per operation plus one for shared state.
2. **Exercise both orders** — for each pair of overlapping awaits that can affect the invariant, show both completion orders. At each relevant await or job handoff, pause, let a competing operation complete, resume, then start a fresh consumer. Exclude an order only by naming the mechanism that prevents it.
3. **Compare the result** against the invariant. The invariant is a requirement, not proof the implementation meets it. A safe case needs a named mechanism. One favorable schedule, or single-threaded execution, does not prove ordering across awaits.
4. **Specify regression proof** — test the relevant completion orders with controlled pause/release points. Exhaustive permutations are unnecessary.

**Interaction edge cases.** For every new user-visible interaction, table `INTERACTION | EDGE CASE | HANDLED? | HOW?`, covering double-click and stale submit, navigating away and timeout and retry, zero/large/changing lists, and failed/duplicate/backlogged jobs. Flag every unhandled case as a gap, and specify the fix.

## Section 5: Code quality review

- Code organization and module structure — does new code fit existing patterns?
- **DRY violations** — be aggressive; reference the file and line of the duplicate.
- Naming — are new classes, methods and variables named for what they do, not how?
- Error-handling patterns (specifics live in Section 2).
- Missing edge cases: nil, empty, 429s, timeouts, boundary values.
- **Over-engineering** — abstractions for problems that don't exist yet.
- **Under-engineering** — happy-path fragility, missing defensive checks.
- Cyclomatic complexity — flag any new method that branches more than five times, and propose the refactor.

## Section 6: Test review

Diagram everything the plan introduces: new UX flows, data flows, codepaths, background jobs, integrations, and error/rescue paths (cross-reference Section 2).

For each item: which test type covers it (unit / integration / system / e2e)? Does a test exist in the plan — and if not, what is its happy path, its specific failure path, and its edge cases (nil, empty, boundary, concurrent access)?

Then the test-ambition check, for each new feature:

- What test would make you confident shipping at 2am on a Friday?
- What test would a hostile QA engineer write to break it?
- What is the chaos test?

Also: pyramid shape (many unit, fewer integration, few e2e — or inverted?), flakiness risk (time, randomness, external services, ordering), and load/stress requirements for any frequently-hit or data-heavy path.

## Section 7: Performance review

- **N+1 queries** — does ORM association traversal preload or batch?
- **Memory** — the maximum size of every new data structure in production.
- **Indexes** — does every new query have one?
- **Caching** — every expensive computation or external call: should it be cached?
- **Background jobs** — worst-case payload, runtime, retry behavior.
- **Slow paths** — the three slowest new codepaths and their estimated p99.
- **Connection pool pressure** — new DB, Redis, or HTTP connections.

## Section 8: Observability & debuggability review

New systems break; this section makes sure you can see why.

- **Logging** — structured lines at entry, exit, and each significant branch.
- **Metrics** — what tells you the feature is working, and what tells you it's broken?
- **Tracing** — trace IDs propagated across services and jobs.
- **Alerting** — what new alerts should exist?
- **Dashboards** — which panels do you want on day one?
- **Debuggability** — if a bug is reported three weeks post-ship, can you reconstruct it from logs alone?
- **Admin tooling** — new operational tasks that need a UI or a task runner.
- **Runbooks** — the operational response for each new failure mode.

## Section 9: Deployment & rollout review

- **Migration safety** — every new migration backward-compatible, zero-downtime, no table locks?
- **Feature flags** — should any part sit behind one?
- **Rollout order** — migrate first, deploy second?
- **Rollback plan** — explicit, step by step.
- **Deploy-time risk window** — old and new code running together: what breaks?
- **Environment parity** — was it tested in staging?
- **Post-deploy checklist** — first five minutes, first hour.
- **Smoke tests** — what runs immediately after deploy?

## Section 10: Long-term trajectory review

- **Technical debt introduced** — code, operational, testing, documentation.
- **Path dependency** — does this make future changes harder?
- **Knowledge concentration** — is the documentation enough for a new engineer?
- **Reversibility** — rate 1-5, where 1 is a one-way door and 5 is easily reversible.
- **Ecosystem fit** — does it align with the repo's framework conventions?
- **The one-year question** — is this obvious to a new engineer in twelve months?

*Expansion modes:* what comes after this ships (phase 2, phase 3), and does the architecture support it? Does it create capabilities other features can leverage?

## Section 11: Design & UX review

Skip unless the plan has UI scope. This is the CEO calling in the designer: not a pixel audit, but ensuring the plan has design intentionality.

- **Information architecture** — what does the user see first, second, third?
- **Interaction state coverage**, as a table: `FEATURE | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL`.
- **User journey coherence** — storyboard the emotional arc.
- **AI slop risk** — does the plan describe generic UI patterns?
- **DESIGN.md alignment** — does it match the stated design system?
- **Responsive intention** — is mobile planned, or an afterthought?
- **Accessibility basics** — keyboard navigation, screen readers, contrast, touch targets.

*Expansion modes:* what would make this UI feel inevitable? Which 30-minute touches would make users think "oh nice, they thought of that"?

**Required diagram:** user flow showing screens, states and transitions.

If the plan has significant UI scope, recommend a dedicated design review of the plan before implementation.
