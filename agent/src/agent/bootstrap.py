"""One place that assembles the live stack.

The terminal door and the eval harness must not drift in how they build the agent: a diff
between them would show up as "the eval passes but the CLI fails", which reads as a mystery and
is not one.
"""

from __future__ import annotations

import sqlite3
from functools import lru_cache
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

from .app import domains_dir, sessions_dir
from .config import Config, config_from_env
from .ledger import Ledger
from .model import ProviderModel
from .rag.assets import load_passages
from .rag.embed import embedder_from_env
from .rag.store import Retriever
from .tools import Toolbox

STATE_DIR = Path(__file__).resolve().parents[2] / ".state"


class NoProvider(RuntimeError):
    """Nothing is configured to think with — the honest state, not a crash to debug."""


@lru_cache(maxsize=1)
def cached_toolbox() -> Toolbox:
    """The tools, built once per process.

    The retriever is the expensive part of the stack — a model and an index over every passage —
    and a server that rebuilt it per request would spend seconds before answering anything. The
    toolbox needs no provider, so it can be built even when nothing is configured to think with.
    """
    config = config_from_env()
    retriever = Retriever(load_passages(domains_dir()), embedder_from_env())
    return Toolbox(
        retriever=retriever,
        domains_dir=domains_dir(),
        rerank_config=config,
        sessions_dir=sessions_dir(),
    )


def live_stack(
    *, rerank: bool = True, tools: frozenset[str] | None = None
) -> tuple[Config, Ledger, ProviderModel, Toolbox]:
    """Provider, ledger, model and tools, built the one way.

    `tools` is a session policy: None means every tool (`schemas()` shows them all), a set means
    only those — filtered where the model is OFFERED tools, not merely where they are refused.
    """
    from .telemetry import configured  # lazy: nothing here needs a tracer until the stack runs

    configured()
    config = config_from_env()
    if config is None:
        raise NoProvider("没有配置 provider（ATP_API_KEY / ATP_MODEL；也可写进仓库根目录的 .env）")
    ledger = Ledger()
    model = ProviderModel(config, ledger)
    base = cached_toolbox()
    toolbox = Toolbox(
        retriever=base.retriever,
        domains_dir=base.domains_dir,
        rerank_config=base.rerank_config if rerank else None,
        sessions_dir=base.sessions_dir,
        allowed=tools,
    )
    return config, ledger, model, toolbox


def checkpointer(filename: str = "checkpoints.sqlite") -> SqliteSaver:
    """The SQLite checkpointer both doors share; agent/.state is gitignored."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: LangGraph may step the graph from a worker thread, and a session
    # that dies of a sqlite threading assertion is a session that dies of nothing the learner did.
    return SqliteSaver(sqlite3.connect(STATE_DIR / filename, check_same_thread=False))
