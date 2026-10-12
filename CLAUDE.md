# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two stacks in one repository, sharing one asset layer (ADR 0013):

1. **`platform/`** — the TypeScript teaching platform: a kernel, a blackboard event protocol, and the single-page board that consumes it. Node ≥22.6, run directly by type-stripping — no bundler, no framework, and **no runtime dependencies** (dev deps are only `typescript` and `@types/node`).
2. **`agent/`** — the Python service (ADR 0013): the same knowledge read through LangGraph, FastAPI, FAISS/BM25 retrieval, fastmcp and Gradio. Python ≥3.11, landed one stage of the knowledge system at a time.

**The boundary between the stacks is the assets, not an API.** Both read the same `domains/`, `library/`, `professions/` and `platform/.sessions/` files from disk; nothing is copied. The agent's memory module reads the platform's session records strictly read-only ("a conversation is not a measurement"). When an asset's shape changes, both stacks' parsers must still agree — there is a test for exactly that.

There is no build or lint tooling at the repo root; everything runs from `platform/` or `agent/`.

## Invariants

These are not preferences — the code enforces them, and a change that violates one is a bug.

- **No actor verifies its own output** (ADR 0004). Every teaching claim is either a **Grounded Assertion** (traces to a passage in the Domain corpus; the *kernel* checks the trace, not the model) or a **Scaffold** (analogy/framing/example — may be ungrounded, but must be labelled and never presented as a claim about the world). "I do not know" is a first-class, *tested* output: an out-of-corpus question must refuse, not answer confidently. A prompt cannot enforce a boundary; only the kernel can.
- **The blackboard is event-sourced.** Its authoritative state is a sequence of typed blackboard events; the visible surface is a pure function of that sequence. The UI is a consumer of the rendered `Surface`, never a second renderer of events — the closed vocabulary, the ordering and the "no coordinates in events" rule stay decided in one place and one language.
- **Nothing enters the catalogue without a person's signature** (ADR 0006/0010). A built Domain is a draft under `domains-draft/`; `review-domain` is the only thing that moves it into `domains/`. **Signing is a human act and is never exposed as a tool** — the MCP server deliberately has no signing door, because a protocol that could call it would be a protocol that signs.
- **Neither classroom may impersonate the other** (ADR 0011). `grounded` retrieves before asserting and carries citations, checked by a *separate* verifier actor; `chat` has no tools and no verdict and says so on the page. This is the repository's single most important rule.
- **Write-shaped capability is OFF by default** behind a named opt-in flag (`ATP_MCP_ALLOW_BUILD=1`), and permission checks are enforced twice: the model is not even *offered* a disallowed tool, and `run()` *refuses* the call that arrives anyway. "Never told about it" and "cannot touch it" are different claims.
- **A session record is sensitive** (ADR 0002) — it holds the learner's misconceptions and their own words. `platform/.sessions/` is gitignored, never committed, and a deletion is provable rather than merely attempted.

## Commands

Two package roots; run each from its own directory. (Windows PowerShell 5.1 rejects `&&`, so keep the lines separate.)

**Platform** (`cd platform`):

```bash
npm run board                    # the board → http://localhost:18087/  (?live=1 for the real provider)
npm test                         # node --test over test/
npm run typecheck                # tsc --noEmit
npm run validate                 # check every knowledge asset; exits non-zero on ERRORS, zero on warnings
npm run coverage                 # the coverage ledger: per Profession, covered / planned / beyond (ADR 0015)
npm run enter                    # terminal teaching session (-- --followup <sessionId> to resume one)
npm run classroom -- "topic"     # the direct classroom (ADR 0011)
npm run build-domain -- "<topic>"   # build a signable draft on demand from fetched sources (ADR 0010)
npm run review-domain -- <id>       # review and sign a draft into the catalogue
npm run probe                    # provider self-check: endpoint/model/key length, one minimal call each
```

- One test file: `node --test test/retry.test.ts`. One test by name: `node --test --test-name-pattern="<regex>"`.
- Sibling scripts that exist but aren't daily drivers: `estimate`, `baseline`, `apparatus`, `experiment`, `validate-draft`.

**Agent** (`cd agent`; the one-time `.venv` setup is in `agent/README.md`):

```bash
.venv\Scripts\python -m pytest                                   # the agent test suite
.venv\Scripts\python -m pytest tests/test_rag_store.py::test_name   # one test
.venv\Scripts\python -m agent.probe                              # provider self-check (chat + embeddings)
.venv\Scripts\python -m agent.search "…"                         # hybrid retrieval + LLM rerank, provenance on every hit
.venv\Scripts\python -m agent.chat "…"                           # grounded (default); --mode chat = the direct classroom
.venv\Scripts\uvicorn agent.app:app --port 18088                 # FastAPI; GET /health
.venv\Scripts\python evals\retrieval.py                          # golden queries → hits@K
.venv\Scripts\python evals\grounding.py                          # whole-graph eval: first-pass approval, honesty, cost (spends real money)
```

- `probe.cmd` wraps the venv path, because this machine's bare `python` is the *system* interpreter, not the venv.
- Whole stack in one command (`cd agent`): `docker compose up --build` → agent on :18088, board on :18087, the same assets mounted into both.

## Architecture

**The platform kernel** (`platform/src/`) is organized around the event protocol, not the UI: `events/` (the typed vocabulary and the log), `session/` (the turn loop, prompts, retries, the store), `render/` (events → `Surface` → text/HTML), `grounding/` + `assertions/` (traceability), `experts/` (the Persona × Domain × Style axes), `build/` + `validate/` (the draft→sign pipeline), `providers/` (one adapter per wire protocol, plus `fake`/`scripted` for tests), and `ui/` (the board — a *consumer* of the kernel, not part of it). Knowledge paths resolve via `src/catalog.ts`, relative to the module, never the process CWD. The validation rules live in `src/validate/rules.ts`.

**The agent graph** (`agent/src/agent/graph/`): a bounded ReAct loop. `chat` is `lead → end`. `grounded` is `lead ─(tool calls)▶ tools ─▶ lead … ─▶ verify ─(one revision)▶ … ─▶ end`. `max_steps` (default 4) bounds the model calls and `verify` bounds the arguing — the loop cannot run forever, which matters most because it spends money. State persists in LangGraph's SQLite checkpointer (`agent/.state/`, gitignored), so `--thread <id>` resumes across processes.

**Retrieval** (`agent/src/agent/rag/`): passage-level, each hit carrying its citation (id, source, URL, and sha256 + fetch date for built Domains) — a hit without provenance is a sentence, not evidence. Local multilingual embedder (fastembed, no API key, because the provider has no `/embeddings` route) + FAISS + BM25 + RRF fusion + LLM rerank. Two rules encoded here: a retrieval half with no signal gets no vote, and a lever that does not move its own number stays off (the query rewriter was built, measured, and left off by default).

## Provider

Both stacks read the same `ATP_*` variables from the **repository root `.env`** (gitignored; the process environment wins — this is the key's only home on a machine, never a tracked source file). Current target: Command Code's Provider API.

```bash
ATP_API_KEY=...      # Command Code key
ATP_MODEL=...        # a model id from GET /provider/v1/models
ATP_BASE_URL=https://api.commandcode.ai/provider/v1
ATP_ZDR=1            # optional zero-retention: routes only to ZDR upstreams, else fails 422 — never a silent fallback
```

Gotchas recorded in the READMEs, worth not rediscovering: **Claude models answer on `/messages` only** (`/chat/completions` returns 400) — hence the platform's Anthropic adapter and its `ATP_ANTHROPIC_MODEL`/`ATP_ANTHROPIC_API_KEY`/`ATP_ANTHROPIC_BASE_URL`; **the provider has no embeddings endpoint** (hence the local embedder, which needs no network); **Go plan tiers have no API access** (403 `upgrade_required`; 401 is the wrong key). `probe` reports the key by length only — never echo it. With no provider configured, the board plays a recorded replay and the direct classroom is locked.

## Layout

- `platform/` — TypeScript kernel, sessions, builder, validator, providers, board
- `agent/` — Python service: RAG, LangGraph, tools, MCP server, Gradio page, evals, deploy
- `domains/<id>/` — `meta.md`, `corpus.md`, `misconceptions.md`, `glossary.md`, `checks.md` (plus `sources.json` and a gitignored `sources/` for built Domains)
- `domains-draft/` — unsigned drafts (gitignored)
- `library/personas/`, `library/styles/` — the product-wide axes, owned separately from any Domain
- `professions/professions.md` — the industry catalogue (ADR 0012); a Profession's status is computed from signatures, never stored
- `professions/competencies.md` — the Competency layer (ADR 0015): the Capability Map's units, their prerequisites, and what each does *not* teach; status is computed the same way a Profession's is
- `platform/.sessions/` — learner records (gitignored, SENSITIVE); the agent reads them read-only
- `docs/adr/` — decisions 0001–0015; `CONTEXT.md` — the glossary the code's and docs' vocabulary must follow
- `.commandcode/skills/` — this repo's engineering skills. ADR 0001 settled that this is an **asset library for expert roles, not part of the delivery vehicle**; the platform never imports from it. `.commandcode/taste/` — local working preferences (gitignored) — read before doing work, don't duplicate them into docs.

## House rules

- **ADR first, then code.** Every design decision lands as its own commit (`docs/adr/NNNN-slug.md`) before the implementation commit. Vocabulary follows `CONTEXT.md`; flag any contradiction with an existing ADR. When a later ADR overrides an earlier one, annotate the earlier one (`Superseded by ADR NNNN`) rather than leaving a contradiction in history.
- **Prove it green before committing.** Type check, the full test suite, and the project's own validator — then state the actual numbers in the commit body as a `Verified:` line (e.g. `tsc --noEmit clean; N/N tests; npm run validate: 0 errors, 0 warnings`). Never a bare claim that it works. Fixtures that only pretend to be evidence must say so in their own output.
- **`npm run validate` treats errors and warnings differently** — non-zero exit only on errors. Assets must use the `CONTEXT.md` vocabulary.
- **Ports are part of the environment's contract.** Installing Docker Desktop reserved 8240–8940 for Hyper-V/WSL2 on this host, where Windows refuses to bind (EACCES) — hence the board on 18087, the service on 18088, Gradio on 18089. Don't move one back into the reserved range.

## The skill catalog

`.commandcode/skills/` holds Matt Pocock–style engineering skills. Each is one directory: `SKILL.md` (YAML frontmatter + process) plus supporting reference docs linked by relative path. Frontmatter keys: `name` (kebab-case, matches the directory), `description` (when the model may invoke it), optional `disable-model-invocation: true` (user-invoked slash command only) and `argument-hint`. Each also carries `agents/openai.yaml` (a `display_name`/`short_description` block for agent tooling, not referenced from SKILL.md prose).

| Skill | Model-invoked | What it does |
|---|---|---|
| `setup-matt-pocock-skills` | no | One-time repo configuration: issue tracker, triage labels, domain doc layout. Run before first use of the other engineering skills. |
| `code-review` | yes | Two-axis review of a diff (Standards + Spec) via parallel sub-agents; reports them side by side. |
| `codebase-design` | yes | Shared vocabulary for designing deep modules; also used by other skills. |
| `domain-modeling` | yes | Build/sharpen the domain model: `CONTEXT.md` glossary + ADRs, created lazily. |
| `diagnosing-bugs` | yes | Diagnosis loop for hard bugs and performance regressions. |
| `grilling` | yes | Relentless interview that stress-tests a plan/decision/idea. |
| `tdd` | yes | Red-green-refactor workflow and integration-test guidance. |
| `grill-me` | no | User-invoked wrapper over `grilling` for a plan or design. |
| `grill-with-docs` | no | `grilling` that also writes ADRs/glossary along the way (pulls in `domain-modeling`). |
| `handoff` | no | Compacts the conversation into a handoff doc for another agent. |
| `improve-codebase-architecture` | no | Scans for deepening opportunities, presents an HTML report, then grills through the chosen one. |
| `teach` | no | Teaches the user a skill/concept within the workspace. |
| `triage` | no | Moves issues/PRs through a state machine of triage roles; writes agent-ready briefs. |
| `office-hours` | yes | Interrogates a product idea with forcing questions, then writes a design doc. `modes.md` holds the startup/builder question sets. |
| `plan-ceo-review` | yes | Founder-mode review of a plan: premise challenge, scope posture, eleven review sections. `review-sections.md` holds the sections. |
| `plan-eng-review` | yes | Engineering review of a plan or diff: architecture, code quality, tests, performance, then task synthesis. |
| `review` | yes | Pre-landing structural review of a diff, then fix-first. `checklist.md` and `specialists.md` hold the categories and lenses. |
| `investigate` | yes | Root-cause debugging loop with the Iron Law; delegates feedback-loop technique to `diagnosing-bugs`. |
| `document-generate` | yes | Writes Diataxis docs from scratch. `doc-templates.md` holds the four quadrant templates. |

The six skills from `office-hours` down were ported from [garrytan/gstack](https://github.com/garrytan/gstack) (MIT) and rewritten to this repo's conventions: gstack's runtime scaffolding (prelude scripts, telemetry, hooks, browser and gbrain integrations) was dropped, the underlying methodology kept.

## Cross-skill dependencies

- **Setup first**: `/setup-matt-pocock-skills` must run once before the other skills are usable. It writes `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, and adds an `## Agent skills` section to CLAUDE.md or AGENTS.md.
- **Issue tracker**: skills like `code-review` and `triage` read where issues live from `docs/agents/issue-tracker.md` (GitHub via `gh`, GitLab via `glab`, local markdown under `.scratch/`, or freeform). If the file is missing, tell the user to run the setup skill — don't improvise.
- **Triage roles**: the five canonical roles are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, mapped to per-repo label strings in `docs/agents/triage-labels.md`. Skills reference roles; apply the mapped labels.
- **Domain docs**: skills read `CONTEXT.md` (single-context) or `CONTEXT-MAP.md` (multi-context, pointing to per-context `CONTEXT.md`) plus `docs/adr/`. Absence is expected — proceed silently; `domain-modeling` creates them lazily when terms/decisions resolve. Outputs must use the glossary's vocabulary and flag any contradiction with an existing ADR.

## Working on skills

- Follow the frontmatter conventions above; keep `name` matching the directory name.
- A new skill gets the same shape: `SKILL.md` (frontmatter + process), `agents/openai.yaml` interface, and reference docs under the skill directory.
- `disable-model-invocation: true` marks skills intentionally driven only via explicit slash command.
