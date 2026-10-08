"""The graph's state — plain JSON-shaped values only.

The SQLite checkpointer serializes this between steps, so nothing here may be a dataclass, a
`Hit`, or an httpx response. A state that only survives in memory turns "resumable session"
into a word.
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    question: str
    messages: list[dict[str, Any]]  # OpenAI wire shape, tool calls included
    mode: str  # "chat" (no tools — ADR 0011's semantics) | "grounded" (tools, citations, verifier)
    steps: int  # model calls made; the loop's own bound
    answer: str
    revised: bool  # the one revision pass has happened
    revision_requested: bool  # set by the verifier when it just asked for that pass
    verdicts: list[dict[str, Any]]  # the verifier's per-claim findings
    verified: bool | None  # None = nobody judged (chat mode, or nothing to judge)
    verify_note: str  # why no verdict exists, when that is the honest state
    hits: list[dict[str, Any]]  # retrieved passages with provenance, for the verifier
