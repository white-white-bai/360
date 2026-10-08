# agent/ — the full-stack service

The second stack (ADR 0013): a Python service that follows《AI 大模型应用全栈开发知识体系》,
built one stage at a time. It shares the knowledge assets with the TypeScript platform —
`domains/`, `library/`, `professions/`, `.sessions/` are read, never copied.

## Stage map (a section either runs or is named as not landed)

| 体系段 | 状态 |
| --- | --- |
| Prompt 与 Context | Stage 2 |
| Vibe Coding | 保持（仓库自身的开发方式） |
| RAG | Stage 1 ✓（段落级检索：本地多语 embedder + FAISS + BM25 + RRF + LLM 重排；golden hits@K 5/5） |
| Agent 智能体 | Stage 2–3 ✓（LangGraph 有界 ReAct，3 个只读工具，独立校验节点，质疑者节点，SQLite 检查点，chat/grounded 两种模式，MCP server） |
| 开发框架与工具栈 | Stage 0 起陆续落地（FastAPI ✓；LangGraph ✓ Stage 2；fastmcp ✓ Stage 3；OTel ✓ Stage 4；Gradio 未落地） |
| FineTuning | **未落地**：本机 GPU 是 GT 710，不是推理卡，且无数据无必要 |
| 多模态与视觉 | **未落地**：PDF/OCR 解析列为后续可选工具 |
| 产品 | **未落地（这一刀）**：终端与 HTTP 门已够用；Gradio 原型列为可选 |
| 交付 | Stage 4 ✓（compose：agent + board 两服务，可选 OTel collector；K8s 清单与 vLLM 文档明确标记"未验证"） |

## Run

```bash
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"     # Windows;  POSIX: .venv/bin/pip
.venv\Scripts\python -m pytest
.venv\Scripts\python -m agent.probe        # chat + embeddings，各一次最小请求
probe.cmd                                  # 同上，但不用记 venv 路径（Windows）
.venv\Scripts\uvicorn agent.app:app --port 18088   # then GET /health
```

## Docker (stage 4)

The whole stack, one command — verified on this machine: both containers up, `/health` answered
from inside the agent, the board served its page, and one grounded `/chat` streamed
`meta → tool → answer → verdicts → challenge → done` with `verified: true`.

```bash
docker compose up --build        # agent → http://localhost:18088/health, board → :18087
docker compose --profile telemetry up   # + a local OTel collector that PRINTS spans (no vendor)
docker compose down
```

- The learner's key comes from the repository root's `.env` (gitignored) via `env_file`; it is
  deliberately not repeated under `environment:` — a `${VAR:-}` line would override the file
  with an empty string. On a network that cannot reach HuggingFace, build with
  `HF_ENDPOINT=https://hf-mirror.com` (the model is baked into the image at build time).
- `deploy/k8s.yaml` is the cluster shape, marked for what it is: **not applied anywhere**. The
  open question it cannot answer is where a writeable `domains/` lives on a cluster — signing
  moves a draft in, and a readOnly mount would fail at the last step.
- `docs/vllm.md` is the local-inference path, for a machine with a real GPU. This one has a
  GT 710, so it stays a document.
- **Content safety is a seam, not a feature** (the plan's wording): the place it would go is the
  model call boundary (`model.py`) and the MCP door (`mcp_server.py`); nothing is gated today,
  and the README saying so is the honest state.

## Why it looks like this

- **Stage 0 claims nothing.** `/health` reports only what it can see — the provider (described,
  never leaked) and how many Domains are on disk. `/chat` arrives with the agent graph.
- **The ledger exists before the first call.** Cost lands earlier and higher here than in the
  old workflow; unknown models are priced as unknown, never as free.
- **The verification boundary is not a Python feature.** ADR 0004's rule — no actor verifies its
  own output — is a rule of the graph (stage 2): the verifier is a separate node, retrieval
  results carry provenance, and signing stays a human act (no MCP tool for it).

## Provider

Same variables as the platform (`ATP_API_KEY` / `ATP_MODEL` / `ATP_BASE_URL` / `ATP_ZDR`), and
the same current target — Command Code's Provider API:

```bash
ATP_BASE_URL=https://api.commandcode.ai/provider/v1
ATP_MODEL=deepseek/deepseek-v4.1-flash
ATP_API_KEY=<the Command Code key>
ATP_ZDR=1                    # optional: zero retention, or fail (422) — never a silent fallback
```

Both stacks also read the repository root's `.env` (gitignored; the process environment wins).
That file is the key's home on a machine — never a tracked source file: `setx` only reaches
terminals opened afterwards, and a key written into code is a key in git history waiting to
happen.

Two things this provider does not give the later stages: **no embeddings endpoint** (stage 1 resolved this with the local embedder below), and **Claude models answer on `/messages` only** — that is the platform's Anthropic adapter's job, not this service's.

## Retrieval (stage 1)

```bash
.venv\Scripts\python -m agent.search "时区是怎么定义的" --k 3    # hybrid + LLM rerank
.venv\Scripts\python -m agent.search "…" --no-rerank            # fused order only
.venv\Scripts\python -m agent.search "…" --no-vector            # BM25 only — needs no model
.venv\Scripts\python evals\retrieval.py                         # golden queries, hits@K
```

- **The unit is the passage with its citation** — id, source, URL, and (for built Domains) the
  sha256 and fetch date. A hit without provenance is a sentence, not evidence.
- **Embedder backends** (`ATP_EMBED_BACKEND`): `local` (default; fastembed ONNX multilingual, no
  API key), `openai` (any OpenAI-compatible `/embeddings` via `ATP_EMBED_BASE_URL`), `fake`
  (tests). The model downloads once; on a network that cannot reach huggingface.co, set
  `HF_ENDPOINT=https://hf-mirror.com` first.
- **A half with no signal gets no vote.** BM25 over a Chinese query against English passages
  scores all zeros, and an arbitrary ranking of zeros used to outweigh the half that matched —
  pinned as a test, because it happened.
- **The rerank earns its place**: the hybrid alone put two golden targets at rank 9 and 15 —
  inside the pool, outside any k worth returning. If the rerank cannot happen, the fused order
  stands and the CLI says so.

## The agent (stage 2)

```bash
.venv\Scripts\python -m agent.chat "时区为什么会出现缺口"          # grounded (default)
.venv\Scripts\python -m agent.chat "时区是什么" --mode chat         # ADR 0011's classroom
.venv\Scripts\python -m agent.chat "那夏时制呢" --thread smoke      # continues a thread
```

- **grounded**: the teacher must `search_corpus` before asserting anything, cites passage ids,
  and a SEPARATE actor — the verifier — checks every claim against the retrieved passages. One
  revision is allowed before the verdict stands; refusing to invent support is a good answer,
  and no retrieval means "the corpus does not cover this" is the complete answer.
- **chat**: no tools, no verdict — ADR 0011's direct classroom, unchanged.
- **State**: LangGraph's SQLite checkpointer (`agent/.state/checkpoints.sqlite`, gitignored);
  `--thread <id>` resumes a conversation across processes.
- **Bounds**: `--max-steps` (default 4) caps model calls per turn. The loop cannot run forever.
- **Policy**: `--tools search_corpus,read_domain` narrows a session. The set filters what the
  model is OFFERED and refuses what arrives anyway; an unknown name is refused with the list of
  known ones. Default: every read-only tool, which is all of them here.
- **Cost**: the per-actor ledger prints at the end. `ATP_PRICE_IN`/`ATP_PRICE_OUT` turn tokens
  into money; without them the row says the price is unknown rather than inventing one.
- Tools that WRITE are absent on purpose: building arrives gated in a later stage, and signing
  is a human act no tool here will ever expose.

## MCP (stage 3)

```bash
python -m agent.mcp_server          # stdio transport; usually launched by a client, not by you
```

Mount it in Command Code (one command, from any terminal):

```powershell
cmd mcp add teaching -- "D:\all-walks-of-life\agent\.venv\Scripts\python.exe" -m agent.mcp_server
```

Exposed: `search_corpus`, `list_domains`, `read_domain`, `describe_draft`, `validate_draft`,
`build_domain`. **Not exposed, deliberately: anything that signs** — ADR 0006/0010 make the
signature a human act, and a protocol that could call it would be a protocol that signs. The
validator is the platform's own (`validate-draft`, a thin CLI over the same rule the gate uses);
a second implementation of one rule is how the two start disagreeing. `build_domain` is the one
write-shaped door and is OFF unless `ATP_MCP_ALLOW_BUILD=1` — everything else here reads.

## Evals (stage 3)

```bash
.venv\Scripts\python evals\retrieval.py     # golden queries → hits@K (retrieval alone)
.venv\Scripts\python evals\grounding.py     # full grounded runs → first-pass approval, honesty, cost
```

`grounding.py` is the seed of ADR 0001's acceptance measurement: how often the first answer
survives the verifier, what the revision did, whether a question the corpus cannot answer
produces honesty instead of a confident sentence, and what each answered question cost. It
spends real money; it is not a pytest. The first live run found a real failure — the teacher
cited a real passage that this run's search had not returned, the verifier refused it twice —
which is why the kernel now checks citations before the verifier is paid to think about them.
