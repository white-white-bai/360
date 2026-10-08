# agent/ — the full-stack service

The second stack (ADR 0013): a Python service that follows《AI 大模型应用全栈开发知识体系》,
built one stage at a time. It shares the knowledge assets with the TypeScript platform —
`domains/`, `library/`, `professions/`, `.sessions/` are read, never copied.

## Stage map (a section either runs or is named as not landed)

| 体系段 | 状态 |
| --- | --- |
| Prompt 与 Context | Stage 2 |
| Vibe Coding | 保持（仓库自身的开发方式） |
| RAG | Stage 1 |
| Agent 智能体 | Stage 2–3 |
| 开发框架与工具栈 | Stage 0 起陆续落地（FastAPI ✓ 现在；LangGraph Stage 2；fastmcp Stage 3；Gradio/OTel Stage 4） |
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

Two things this provider does not give the later stages: **no embeddings endpoint** (stage 1's
RAG needs another source or the local fallback), and **Claude models answer on `/messages`
only** — that is the platform's Anthropic adapter's job, not this service's.
