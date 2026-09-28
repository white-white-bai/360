# Specialist lenses

Deeper checks to run after the critical pass. Each has its own trigger. Fold any findings into the same list and the same fix-first flow — a lens that finds nothing simply doesn't appear.

## Security

**Run when the diff touches auth, or when it's a backend diff over ~100 lines.**

Goes deeper than the critical pass, which already covers SQL injection, races, LLM trust, and enum completeness. This lens is about authz patterns, crypto misuse, and attack surface.

**Input validation at trust boundaries** — user input accepted unvalidated at the handler; query params used directly in queries or file paths; request bodies without schema validation; uploads without type/size/content checks; webhooks without signature verification.

**Auth & authorization bypass** — endpoints missing auth middleware (check the route definitions); authorization that defaults to allow instead of deny; role-escalation paths (a user can edit their own role); direct object references (changing an ID reaches someone else's data); session fixation; tokens validated without an expiry check.

**Injection beyond SQL** — command injection via subprocess with user-controlled arguments; template injection (Jinja2, ERB, Handlebars); LDAP injection; SSRF via user-controlled URLs; path traversal; header injection.

**Cryptographic misuse** — MD5/SHA1 for security-sensitive work; `Math.random`/`rand()` for tokens; non-constant-time comparison of secrets or digests; hardcoded keys or IVs; unsalted password hashing.

**Secrets exposure** — keys/tokens/passwords in source (comments included); secrets in logs or error messages; credentials in URLs; sensitive data in error responses; PII stored in plaintext where encryption is expected.

**XSS via escape hatches** — `.html_safe`/`raw()`, `dangerouslySetInnerHTML`, `v-html`, `|safe`/`mark_safe`, raw `innerHTML` on user content.

**Deserialization** — unpickling or unmarshalling untrusted data (`pickle`, `Marshal`, `YAML.load`); accepting serialized objects from user input without schema validation.

## Performance

**Run when the diff touches backend or frontend code.**

**N+1 queries** — associations traversed in loops without eager loading; queries inside `each`/`map`/`forEach`; nested serializers triggering lazy loads; resolvers querying per field instead of batching.

**Missing indexes** — new `WHERE` on unindexed columns; new `ORDER BY` on unindexed columns; composite predicates without a composite index; foreign keys without indexes.

**Algorithmic complexity** — nested loops over collections; `find` inside `map`; repeated linear searches where a set or map fits; string concatenation in loops; sorting or filtering the same collection repeatedly.

**Bundle size** — new heavy dependencies (moment, full lodash, jQuery); barrel imports instead of deep imports; unoptimized committed assets; missing route-level code splitting.

**Rendering** — sequential fetches that could be `Promise.all`; unstable references forcing re-renders; expensive computations without memoization; layout thrashing from read-then-write in loops; below-fold images without `loading="lazy"`.

**Missing pagination** — list endpoints returning unbounded results; queries without `LIMIT` that grow with data; responses embedding full nested objects instead of IDs.

**Blocking in async contexts** — sync file/subprocess/HTTP work inside async handlers; `sleep` in an event loop; CPU-heavy work on the main thread without a worker.

## API contract

**Run when the diff changes an API surface.**

**Breaking changes** — removed response fields; changed field types; new required parameters on existing endpoints; changed methods or status codes; renamed endpoints without an alias; auth requirement changes.

**Versioning** — breaking changes without a version bump; mixed versioning strategies; deprecated endpoints without a sunset or migration guide; version logic scattered instead of centralized.

**Error consistency** — new endpoints with a different error shape; error responses missing standard fields; status codes that don't match the error type; messages leaking internals (stack traces, SQL).

**Rate limiting & pagination** — new endpoints without the rate limiting their siblings have; pagination changes without backward compatibility; changed page sizes undocumented; missing total/next-page indicators.

**Documentation drift** — OpenAPI spec not updated; README describing old behavior; example requests that no longer work; new endpoints undocumented.

**Backward compatibility** — will older clients break? Mobile apps that can't force-update? Webhook payloads changed without notice?

## Data migration

**Run when the diff includes a migration.**

**Reversibility** — can it roll back without data loss? Is there a real down migration, or a no-op? Would rolling back break the current code?

**Data loss** — dropping columns that still hold data; type changes that truncate; removing tables without checking references; renaming columns without updating every reference; `NOT NULL` on columns with existing nulls (backfill first).

**Lock duration** — `ALTER TABLE` on large tables without `CONCURRENTLY`; non-concurrent index creation on big tables; separate statements that could share one lock; schema changes during peak traffic.

**Backfill** — new `NOT NULL` without a default; computed defaults needing a batch population; no backfill script; a backfill that updates every row at once.

**Indexes** — `CREATE INDEX` without `CONCURRENTLY` in production; duplicate indexes; missing indexes on new foreign keys.

**Multi-phase safety** — migrations that need a specific deploy order with application code; schema changes that break the running code; migrations assuming a deploy boundary (old code plus new schema crashes); missing a flag for mixed old/new during a rolling deploy.

## Maintainability

**Always on.**

**Dead code & unused imports** — variables assigned but never read; functions defined but never called (grep the repo); imports left behind; commented-out blocks without a reason.

**Magic numbers & string coupling** — bare numeric literals in logic; error-message strings reused as filters; hardcoded URLs, ports, hostnames; the same literal duplicated across files.

**Stale comments** — comments describing behavior the diff just changed; TODO/FIXME for completed work; docstrings whose parameters no longer match; ASCII diagrams that no longer match the flow.

**Duplicated behavior with defects** — divergent copies that produce a wrong result, skip required error handling, or break the same contract. Report the concrete defect with evidence; matching syntax or equal line counts alone are not findings.

**Conditional side effects** — a branch that forgets a side effect the other branch performs; a log claiming an action that was conditionally skipped; state transitions updating related records on one branch only; events emitted only on the happy path.

**Module boundary violations** — reaching into another module's internals; direct DB queries from controllers/views that belong in a service; tight coupling where an interface belongs.

## Testing

**Always on.**

**Missing negative-path tests** — error/rejection/invalid-input paths with no test; untested guard clauses and early returns; unhandled failure branches; permission checks never tested for the denied case.

**Missing edge cases** — zero, negative, max-int, empty string, empty array, null; single-element collections; unicode and special characters in user-facing input; concurrent access with no race test.

**Isolation violations** — tests sharing mutable state; order-dependent tests; dependence on clock, timezone, or locale; tests making real network calls instead of stubbing.

**Flakiness** — timing-dependent assertions; assertions on the order of unordered results; dependence on external services without a fallback; unseeded random data.

**Security enforcement untested** — authz checks with no unauthorized-case test; rate limiting with no proof it blocks; sanitization with no malicious-input test.

**Coverage gaps** — new public functions with no tests; changed functions whose tests only cover the old behavior; utilities with many callers tested only indirectly.

## Simplification

**Run when the diff is over ~100 lines.** This lens hunts unrequested *structure* only: abstractions with one implementation, hand-rolled stdlib, dependencies duplicating the platform, dead flexibility. Coverage gaps belong to completeness.

Each finding uses exactly one tag:

- **delete** — dead code, unused flexibility, a speculative feature. Nothing replaces it.
- **stdlib** — something the standard library already ships. Name the function.
- **native** — code or a dependency doing what the platform already does. Name the feature.
- **speculative** — an abstraction with one implementation, config nobody sets, a layer with one caller.
- **shrink** — the same logic in fewer lines, only when the reduction is at least five lines.

Findings are **advisory**: never auto-applied, and reported separately from defects.

**Never flag a test, an error path, an edge-case branch, input validation, security measure, or accessibility affordance for deletion.** Coverage is completeness's job.

## Red team

**Run when the diff is over ~200 lines, or the security lens found something critical. Runs last.**

Not a checklist — adversarial analysis. Find what the other lenses missed. Think like an attacker, a chaos engineer, and a hostile QA tester at once.

- **Attack the happy path.** Ten times normal load. Two requests hitting the same resource at once. A database query taking over five seconds. An external service returning garbage.
- **Find the silent failures.** Error handling that swallows exceptions; operations that partially complete then crash; state left inconsistent on failure; background jobs failing with no alert.
- **Exploit trust assumptions.** Data validated on the frontend but not the backend. Internal APIs assumed private. Config assumed present. Paths and URLs built from user input without sanitizing.
- **Break the edge cases.** Maximum input size. Zero items, empty strings, nulls. The very first run, with no data. The user double-clicking.
- **Find the gaps between lenses.** What falls between two categories? Issues at integration boundaries, or that only appear in particular deployments.
