# Review checklist

Review the diff for the issues below. Cite `file:line` and suggest the fix. Skip anything that's fine. Only flag real problems.

**Two passes:** CRITICAL first (highest severity), then INFORMATIONAL. Both get actioned via fix-first.

**Completeness and simplification are orthogonal, not contradictory.** Completeness pushes coverage up (tests, edge cases, error paths); simplification pushes unrequested structure down. The same diff can legitimately receive both.

## Pass 1 — CRITICAL

### SQL & data safety
- String interpolation in SQL — parameterized queries only (Rails: `sanitize_sql_array`/Arel; Node: prepared statements; Python: driver parameters)
- TOCTOU: check-then-set that should be one atomic `WHERE` + update
- Bypassing model validation for direct writes (Rails `update_column`; Django `QuerySet.update()`; Prisma raw queries)
- N+1 queries: associations traversed in loops without eager loading (`.includes()`, `joinedload()`, `include`)

### Race conditions & concurrency
- Read-check-write without a uniqueness constraint (or a caught duplicate-key retry)
- find-or-create with no unique index — concurrent callers create duplicates
- Status transitions that aren't atomic (`UPDATE ... WHERE old_status = ?`) — concurrent updates skip or double-apply
- Unsafe HTML rendering on user-controlled data: Rails `.html_safe`/`raw()`, React `dangerouslySetInnerHTML`, Vue `v-html`, Django `|safe`/`mark_safe` (XSS)

### LLM output trust boundary
- LLM-generated values (emails, URLs, names) persisted or mailed without format validation
- Structured tool output accepted without shape/type checks before a DB write
- LLM-generated URLs fetched without an allowlist (SSRF to internal networks)
- LLM output stored in a knowledge base or vector store unsanitized (stored prompt injection)

### Shell injection
- `subprocess.*` with `shell=True` and interpolated command strings — use argument arrays
- `os.system()` with interpolated variables — replace with `subprocess.run()` and an argument list
- `eval()` / `exec()` on LLM-generated code without sandboxing

### Enum & value completeness
When the diff adds an enum value, status string, tier, or type constant:
- **Trace it through every consumer.** Grep the sibling values, then *read* each file that switches on, filters by, or displays them. Common miss: the value is added to a UI list but the model or compute path never persists or handles it.
- **Check allowlists and filter arrays.** Every list containing the siblings — is the new value included where it needs to be?
- **Check `case`/`if-elsif` chains.** Does the new value fall through to a wrong default?

This step requires reading code outside the diff.

## Pass 2 — INFORMATIONAL

### Async/sync mixing
- Synchronous I/O (`open()`, `requests.get()`, blocking subprocess) inside `async def` — use `asyncio.to_thread()`, `aiofiles`, `httpx.AsyncClient`
- `time.sleep()` in async code — use `asyncio.sleep()`
- Sync DB calls in an async context without executor wrapping

### Column / field name safety
- ORM column names in `.select()`/`.eq()`/`.gte()`/`.order()` checked against the real schema — wrong names silently return empty results
- `.get()` on query results using the column actually selected

### Dead code & version consistency
- Version mismatch between the change and `VERSION`/`CHANGELOG`
- CHANGELOG entries that describe the change inaccurately

### LLM prompt issues
- 0-indexed lists in prompts (models reliably return 1-indexed)
- Prompt text listing tools/capabilities that don't match what's wired up
- Word/token limits stated in more than one place, free to drift

### Completeness gaps
- Shortcut implementations where the complete version is a small addition (partial enum handling, missing error paths, straightforward edge cases)
- Test gaps that mirror existing happy-path structure — a lake, not an ocean
- Features left at 80-90% when 100% is a modest amount of additional code

### Time window safety
- Date-keyed lookups that assume "today" means 24 hours
- Mismatched windows between related features (hourly buckets vs daily keys) over the same data

### Type coercion at boundaries
- Values crossing language/JSON boundaries where the type can shift (number vs string)
- Hash or digest inputs that don't normalize types first — `{ cores: 8 }` and `{ cores: "8" }` hash differently

### View / frontend
- Inline `<style>` in partials, re-parsed every render
- O(n*m) lookups in views (`Array#find` in a loop instead of a keyed hash)
- Client-side filtering of DB results that could be a `WHERE` clause

### Distribution & CI/CD
- Workflow changes: build tool versions match the project, artifact names/paths correct, secrets referenced not hardcoded
- New artifact types have a publish/release workflow targeting the right platforms
- Cross-platform builds: the matrix covers every target OS/arch, or documents what's untested
- Version tag format consistent across `VERSION`, git tags, and publish scripts
- Publish steps are idempotent (a re-run doesn't fail)

**Do not flag:** services with an existing auto-deploy pipeline; internal tools not distributed externally; test-only CI changes (adding test steps, not publish steps).

## Fix-first heuristic

```
AUTO-FIX (apply without asking):        ASK (needs human judgment):
├─ Dead code / unused variables         ├─ Security (auth, XSS, injection)
├─ N+1 queries (missing eager loading)  ├─ Race conditions
├─ Stale comments contradicting code    ├─ Design decisions
├─ Magic numbers → named constants      ├─ Large fixes (>20 lines)
├─ Missing LLM output validation        ├─ Enum completeness
├─ Version / path mismatches            ├─ Removing functionality
├─ Variables assigned but never read    └─ Anything changing user-visible
└─ Inline styles, O(n*m) view lookups      behavior
```

**Rule of thumb:** if the fix is mechanical and a senior engineer would apply it without discussion, AUTO-FIX. If reasonable engineers could disagree, ASK.

Critical findings default toward ASK. Informational findings default toward AUTO-FIX.

## Suppressions — do not flag

- "X is redundant with Y" when the redundancy is harmless and helps readability
- "Add a comment explaining this threshold" — thresholds move during tuning, comments rot
- "This assertion could be tighter" when it already covers the behavior
- Consistency-only changes (guarding one value to match how another is guarded)
- "This regex doesn't handle edge case X" when the input is constrained so X can't occur
- A test that exercises several guards at once — tests need not isolate every guard
- Harmless no-ops (`.reject` on an array that never contains the element)
- **Anything already addressed in the diff** — read the whole diff first
