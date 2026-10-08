"""`python -m agent.ui` — a Gradio page over the agent, for eyes that do not live in a terminal.

The knowledge system's 产品 section names Gradio for exactly this: a prototype surface, cheap
enough that it never becomes the product. It reuses the same graph as every other door — one
agent, several interfaces — and the turn handler is a plain function, so the tests exercise it
with a scripted model without a browser and without gradio installed (`gradio` is imported only
when the page is actually built).

Install with the extra: `pip install -e ".[ui]"`; run: `python -m agent.ui` (port 18089 by
default, ATP_UI_PORT to change).
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable

from .console import utf8_console
from .graph.graph import build_graph, fresh_turn
from .model import ProviderError


def build_agent() -> tuple[Any, Any]:
    """The live graph, built lazily so importing this module needs neither gradio nor a key."""
    from .bootstrap import checkpointer, live_stack

    _, ledger, model, toolbox = live_stack()
    return build_graph(model, toolbox, checkpointer=checkpointer("ui.sqlite")), ledger


def render_details(final: dict, ledger: Any) -> str:
    """The pane under the chat: verdicts, the challenger, the corpus, the ledger — in that order."""
    lines: list[str] = []

    state = "通过" if final.get("verified") else ("未通过" if final.get("verified") is False else "未判定")
    verdicts = final.get("verdicts", [])
    lines.append(f"**【校验】** {state}（{len(verdicts)} 条断言）")
    for item in verdicts:
        mark = "✓" if item.get("supported") else "✗"
        passage = item.get("passage") or "—"
        lines.append(f"- {mark} {item.get('claim', '')}  [{passage}]")
        if not item.get("supported") and item.get("reason"):
            lines.append(f"  - 理由：{item['reason']}")
    if final.get("verify_note"):
        lines.append(f"- （{final['verify_note']}）")

    if final.get("challenge"):
        lines.append("\n**【质疑者】** " + str(final["challenge"]))

    ids = sorted({str(hit.get("id", "")) for hit in final.get("hits", [])})
    lines.append(f"\n**【语料】** {len(final.get('hits', []))} 段：{', '.join(ids) or '（没有检索到）'}")

    if ledger is not None and ledger.rows():
        lines.append("\n**【账本】**")
        for row in ledger.rows():
            marker = "" if row.priced else "（价表未知）"
            lines.append(
                f"- {row.actor}：{row.calls} 次，{row.input_tokens}+{row.output_tokens} tok，"
                f"${row.cost_usd:.4f}{marker}"
            )
    return "\n".join(lines)


def make_handler(agent_factory: Callable[[], tuple[Any, Any]]):
    """The turn handler as a closure over the factory — the whole Gradio integration surface.

    History is the messages format (a list of `{"role", "content"}` dicts): tuples were removed
    from Gradio's Chatbot, and the messages shape is the one the component is going to keep.
    """

    def handle(message: str, mode: str, thread: str, history: list | None):
        turns = list(history or [])
        if message.strip() == "":
            return turns, "", ""
        try:
            agent, ledger = agent_factory()
            final = agent.invoke(
                fresh_turn(message, mode), {"configurable": {"thread_id": thread.strip() or "ui"}}
            )
        except ProviderError as error:
            turns.append({"role": "user", "content": message})
            turns.append({"role": "assistant", "content": f"（provider 出错：{error}）"})
            return turns, "", ""
        except Exception as error:  # NoProvider, a bad mode — said, not crashed
            turns.append({"role": "user", "content": message})
            turns.append({"role": "assistant", "content": f"（没做成：{error}）"})
            return turns, "", ""
        turns.append({"role": "user", "content": message})
        turns.append({"role": "assistant", "content": final.get("answer") or "（没有回答）"})
        return turns, "", render_details(final, ledger)

    return handle


def build_ui(agent_factory: Callable[[], tuple[Any, Any]] | None = None):
    import gradio as gr  # imported here: the tests never need it, and neither does the CLI

    handle = make_handler(agent_factory or build_agent)
    with gr.Blocks(title="教学平台 · agent") as demo:
        gr.Markdown(
            "## 教学平台 · agent\n"
            "同一个图，换一双眼睛。**grounded** 先检索再回答，并让另一个 actor 核对每条断言；"
            "**chat** 是直接课堂（ADR 0011），没有校验、不做判定。"
        )
        history = gr.Chatbot(label="课堂", height=420)
        with gr.Row():
            message = gr.Textbox(label="你的话", scale=4, lines=2, placeholder="用你自己的话说说，或直接问…")
            mode = gr.Radio(["grounded", "chat"], value="grounded", label="模式")
            thread = gr.Textbox(label="会话 id", value="ui", scale=1)
        send = gr.Button("发送", variant="primary")
        details = gr.Markdown(label="校验与账本")
        send.click(handle, [message, mode, thread, history], [history, message, details])
        message.submit(handle, [message, mode, thread, history], [history, message, details])
    return demo


def main() -> int:
    utf8_console()
    port = int(os.environ.get("ATP_UI_PORT", "18089"))
    build_ui().launch(server_name="127.0.0.1", server_port=port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
