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
| Agent 智能体 | Stage 2 ✓（LangGraph 有界 ReAct 循环，3 个只读工具，独立校验节点，SQLite 检查点，chat/grounded 两种模式） |
| 开发框架与工具栈 | Stage 0 起陆续落地（FastAPI ✓；LangGraph ✓ Stage 2；fastmcp Stage 3；Gradio/OTel Stage 4） |
| FineTuning | **未落地**：本机 GPU 是 GT 710，不是推理卡，且无数据无必要 |
| 多模态与视觉 | **未落地**：PDF/OCR 解析列为后续可选工具 |
| 产品 | Stage 3（Gradio 原型 + 两种模式的术语映射） |
| 交付 | Stage 0 起（Docker）；OpenTelemetry/K8s/vLLM 文档在 Stage 4 |

## Run

```bash
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"     # Windows;  POSIX: .venv/bin/pip
.venv\Scripts\python -m pytest
.venv\Scripts\python -m agent.probe        # chat + embeddings，各一次最小请求
probe.cmd                                  # 同上，但不用记 venv 路径（Windows）
.venv\Scripts\uvicorn agent.app:app --port 18088   # then GET /health
```

## Docker

The delivery path (stage 4). The Dockerfile and the compose file ship with stage 0, so the
service is containerized before it grows:

```bash
docker compose up --build        # http://localhost:18088/health
docker compose config            # validate the compose file alone, no daemon needed
```

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
- **Cost**: the per-actor ledger prints at the end. `ATP_PRICE_IN`/`ATP_PRICE_OUT` turn tokens
  into money; without them the row says the price is unknown rather than inventing one.
- Tools that WRITE are absent on purpose: building arrives gated in a later stage, and signing
  is a human act no tool here will ever expose.
