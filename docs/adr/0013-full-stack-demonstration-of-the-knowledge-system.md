# The project becomes a full-stack demonstration of the knowledge system

## What the owner decided

The owner handed over《AI 大模型应用全栈开发知识体系》and chose the reading named in the plan:
**全栈照搬体系** — rebuild this project itself along that stack, so the repository becomes a
runnable demonstration of the knowledge system rather than the zero-dependency TypeScript
platform it has been. The map lives in `~/.commandcode/plans/full-stack-agent-pivot.md`
(nine sections, staged); this record is the decision, not the schedule.

## What is explicitly reversed

- **"No runtime dependencies."** The board's "no framework, no bundler, no dependency" stance and
  the platform's two-dev-dependency shape are reversed *for the new service only*. The old
  platform keeps its shape, its tests and its users until each capability it holds has a
  successor that answers the same acceptance question — nothing is deleted first.
- **The single-language stack.** The new service is Python because the named tools are
  (LangGraph, FastAPI, fastmcp, FAISS, Gradio, vLLM). The repository is bilingual during the
  migration, and the boundary between the stacks is the assets, not an API: both read the same
  `domains/`, `library/`, `professions/` and `.sessions/` files.

## What stays binding, whatever the stack

- **ADR 0004** — no actor verifies its own output. In the new graph the verifier is a separate
  node and a separate actor, and retrieval results carry provenance (domain, passage id, source
  URL, sha256) so "supported" stays a fact about a passage rather than a mood.
- **ADR 0006 / 0010** — nothing enters the catalogue without a person's signature. The MCP
  server will expose building and validating; it will not expose signing.
- **ADR 0002** — the learner's record is sensitive. The same lifecycle, the same provable
  deletion, apply to any memory the new stack keeps.
- **ADR 0008 / 0011** — the two classroom modes keep their promises and their names. The agent
  version of the direct classroom gets tools, and the moment it uses them its claims must carry
  citations; a run that retrieves nothing says so instead of answering from memory.

## The staging commitment

Each section of the knowledge system either lands as a runnable, tested stage or is named as not
landed, with its reason, in the README. Two sections are named out of this cut: **FineTuning**
(no GPU — this machine's GT 710 is not an inference GPU — no dataset, no need) and
**多模态与视觉** (a later optional tool, PDF/OCR parsing first). A demonstration that claimed
sections it does not run would be the same failure as a lesson that claimed grounding it never
verified.

## Consequences

- Two stacks to keep green during the migration: `pytest` for the new service, `npm test` for
  the platform — plus one cross-check that both parse the assets identically.
- Cost arrives earlier and higher than in a workflow (embeddings plus bounded agent loops), so
  the per-actor ledger exists from stage 0 — with unknown models priced as unknown, never as
  free.
- Docker was not installed when this was written; it was installed during stage 0, and the
  acceptance ran for real: the image built through a registry mirror (Docker Hub is unreachable
  from this network), the container came up, and `/health` answered from inside it — provider
  null, seven Domains visible through the mounted volume. The install itself reserved the dynamic
  range 8240–8940 for Hyper-V/WSL2 on this Windows host, where binding is refused outright
  (EACCES): the board's 8787, which had worked until that day, stopped being bindable. The board
  now defaults to 18087 and the service publishes 18088, both outside every reserved range —
  ports are part of the environment's contract, not a detail.
