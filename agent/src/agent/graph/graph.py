"""The graph itself: a bounded ReAct loop, with a verifier on the grounded path.

    chat      lead ──────────────────────────────▶ end
    grounded  lead ──(tool calls)──▶ tools ──▶ lead … ──▶ verify ──(one revision)──▶ lead → verify → end

`max_steps` bounds the model calls; `verify` bounds the arguing. The loop cannot run forever,
which is the property that matters most about an agent that spends money.
"""

from __future__ import annotations

from langgraph.graph import END, StateGraph

from ..model import Model
from ..tools import Toolbox
from .nodes import (
    make_challenge_node,
    make_lead_node,
    make_tools_node,
    make_verify_node,
    route_after_lead,
    route_after_verify,
)
from .state import AgentState


def build_graph(model: Model, toolbox: Toolbox, *, max_steps: int = 4, checkpointer=None):
    """Compile the agent. A checkpointer makes sessions resumable; tests pass a memory one."""
    graph = StateGraph(AgentState)
    graph.add_node("lead", make_lead_node(model, toolbox, max_steps=max_steps))
    graph.add_node("tools", make_tools_node(toolbox))
    graph.add_node("verify", make_verify_node(model))
    graph.add_node("challenge", make_challenge_node(model, toolbox))

    graph.set_entry_point("lead")
    graph.add_conditional_edges(
        "lead",
        lambda state: route_after_lead(state, max_steps=max_steps),
        {"tools": "tools", "verify": "verify", "end": END},
    )
    graph.add_edge("tools", "lead")
    graph.add_conditional_edges(
        "verify", route_after_verify, {"lead": "lead", "challenge": "challenge", "end": END}
    )
    graph.add_edge("challenge", END)
    return graph.compile(checkpointer=checkpointer)


def fresh_turn(question: str, mode: str) -> dict:
    """The per-turn resets. With a checkpointer, the previous turn's state is still on the
    thread, and a stale `answer` or `verdicts` would be shown as this turn's."""
    return {
        "question": question,
        "mode": mode,
        "steps": 0,
        "answer": "",
        "revised": False,
        "revision_requested": False,
        "verdicts": [],
        "verified": None,
        "verify_note": "",
        "hits": [],
        "challenge": "",
    }
