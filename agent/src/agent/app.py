"""The full-stack service: /health, the retrieval door, and /chat over SSE.

Stage 0 was deliberately thin — a service that claims nothing. It now carries what stages 1-3
built: hybrid retrieval, the agent graph, and the tools. /chat streams the SAME events the
terminal door prints, one SSE frame each, because a page should render what a person sees and
not a second interpretation of it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .config import config_from_env

# Repo layout: agent/src/agent/app.py -> parents[3] is the repository root.
DEFAULT_DOMAINS_DIR = Path(__file__).resolve().parents[3] / "domains"


def domains_dir() -> Path:
    """Where the knowledge assets live — the one thing the two stacks share (ADR 0013).

    The environment override exists for the container, where the repository root is not on the
    path and the assets arrive as a mounted volume.
    """
    override = os.environ.get("ATP_DOMAINS_DIR", "").strip()
    return Path(override) if override != "" else DEFAULT_DOMAINS_DIR


def sessions_dir() -> Path | None:
    """Where the learner's own records live (written by the TypeScript platform).

    Same override pattern as the domains: the container gets a mounted path. A missing directory
    is not an error — it means this learner has no records yet, and the memory tool says so.
    """
    override = os.environ.get("ATP_SESSIONS_DIR", "").strip()
    if override != "":
        return Path(override)
    candidate = DEFAULT_DOMAINS_DIR.parent / "platform" / ".sessions"
    return candidate if candidate.is_dir() else None


def domain_count(directory: Path) -> int:
    if not directory.is_dir():
        return 0
    return sum(1 for entry in directory.iterdir() if (entry / "meta.md").is_file())


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _live_agent() -> tuple[Any, Any]:
    """The real graph, lazily built: importing this module must not need a provider."""
    from .bootstrap import checkpointer, live_stack
    from .graph.graph import build_graph

    _, ledger, model, toolbox = live_stack()
    return build_graph(model, toolbox, checkpointer=checkpointer("http.sqlite")), ledger


def create_app(domains: Path | None = None, *, agent_factory: Callable[[], tuple[Any, Any]] | None = None) -> FastAPI:
    app = FastAPI(title="ATP agent service", version="0.0.0")

    @app.get("/health")
    def health() -> dict:
        config = config_from_env()
        directory = domains if domains is not None else domains_dir()
        return {
            "status": "ok",
            "stage": "3",
            "provider": config.describe() if config is not None else None,
            "domainsDir": str(directory),
            "domains": domain_count(directory),
        }

    @app.get("/search")
    def search(q: str, k: int = 6) -> dict:
        """Retrieval alone, for a client that wants hits rather than a lesson."""
        from .bootstrap import cached_toolbox

        if q.strip() == "":
            raise HTTPException(status_code=400, detail="q is required")
        return json.loads(cached_toolbox().search_corpus(q))  # same provenance, one shape

    @app.get("/chat")
    def chat(message: str, mode: str = "grounded", thread: str = "http") -> StreamingResponse:
        """The graph, streamed: meta, tool, answer, verdicts, challenge, done."""
        if mode not in ("chat", "grounded"):
            raise HTTPException(status_code=400, detail='mode must be "chat" or "grounded"')
        if message.strip() == "":
            raise HTTPException(status_code=400, detail="message is required")

        from .graph.graph import fresh_turn  # lazy alongside _live_agent, for the same reason

        try:
            agent, ledger = (agent_factory or _live_agent)()
        except Exception as error:  # NoProvider included: 503 with the reason, not a traceback
            raise HTTPException(status_code=503, detail=str(error)) from error

        def events():
            yield _sse("meta", {"mode": mode, "thread": thread})
            state: dict[str, Any] = {}
            for update in agent.stream(
                fresh_turn(message, mode), {"configurable": {"thread_id": thread}}, stream_mode="updates"
            ):
                for node, output in update.items():
                    if not isinstance(output, dict):
                        continue
                    state.update(output)
                    if node == "lead":
                        if output.get("answer"):
                            yield _sse("answer", {"text": output["answer"]})
                        for call in (output.get("messages") or [{}])[-1].get("tool_calls", []) or []:
                            function = call.get("function", {})
                            yield _sse("tool", {"name": function.get("name"), "arguments": function.get("arguments")})
                    if node == "verify":
                        yield _sse(
                            "verdicts",
                            {
                                "items": output.get("verdicts", []),
                                "verified": output.get("verified"),
                                "note": output.get("verify_note", ""),
                            },
                        )
                    if node == "challenge" and output.get("challenge"):
                        yield _sse("challenge", {"text": output["challenge"]})
            total = ledger.total()
            yield _sse(
                "done",
                {
                    "answer": state.get("answer", ""),
                    "verified": state.get("verified"),
                    "calls": total.calls,
                    "inputTokens": total.input_tokens,
                    "outputTokens": total.output_tokens,
                    "costUsd": total.cost_usd,
                    "priced": total.priced,
                },
            )

        return StreamingResponse(events(), media_type="text/event-stream")

    return app


app = create_app()
