"""`python -m agent.ui` — a Gradio page over the agent, for eyes that do not live in a terminal.

The knowledge system's 产品 section names Gradio for exactly this: a prototype surface, cheap
enough that it never becomes the product. It reuses the same graph as every other door — one
agent, several interfaces — and the turn handler is a generator, so the tests exercise a whole
turn with a scripted model and no browser (gradio is imported only when the page is built).

The page's real job, beyond looking like the product it belongs to, is to NOT look frozen: a
grounded turn takes tens of seconds (search, answer, verify, challenge), so the handler streams
the graph's own steps — the answer appears as soon as it is written, and the verification that
follows is visible while it happens. A page that shows progress is a page that can be trusted to
still be working.

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

# The board's palette, so the two doors read as one product (platform/src/ui/index.html).
CSS = """
.gradio-container { font-family: "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", serif; }
#details-pane { font-size: 13px; line-height: 1.75; }
#details-pane code { color: #f2d06b; }
"""


def build_agent() -> tuple[Any, Any]:
    """The live graph, built lazily so importing this module needs neither gradio nor a key."""
    from .bootstrap import checkpointer, live_stack

    _, ledger, model, toolbox = live_stack()
    return build_graph(model, toolbox, checkpointer=checkpointer("ui.sqlite")), ledger


def node_status(node: str, output: dict) -> str:
    """What the graph is doing, in the learner's terms — one line per step."""
    if node == "lead":
        if output.get("answer"):
            return "回答写好了；接下来由另一位 actor 独立核对每条断言。"
        return "老师正在读题、决定去语料里找什么…"
    if node == "tools":
        return "检索完成，老师正在读到的段落上作答…"
    if node == "verify":
        return "正在独立核对：每条断言有没有语料支持…"
    if node == "challenge":
        return "质疑者正在对照这门课的「误解目录」…"
    return ""


def render_trail(trail: list[str], state: dict) -> str:
    """While a turn runs: the steps so far, and nothing dressed up as a verdict."""
    lines = ["**进度**"]
    lines.extend(f"- {item}" for item in trail[-4:])
    if state.get("verified") is True:
        lines.append("")
        lines.append("核对通过——正在收尾。")
    elif state.get("verified") is False:
        unsupported = len([item for item in state.get("verdicts", []) if not item.get("supported")])
        lines.append("")
        lines.append(f"有 {unsupported} 条没有出处，老师正在按意见重写…")
    return "\n".join(lines)


def render_details(final: dict, ledger: Any) -> str:
    """The pane beside the chat: verdicts, the challenger, the corpus, the ledger — in that order."""
    lines: list[str] = []

    state = "通过" if final.get("verified") else ("未通过" if final.get("verified") is False else "未判定")
    verdicts = final.get("verdicts", [])
    lines.append(f"**校验** · {state}（{len(verdicts)} 条断言）")
    for item in verdicts:
        mark = "✓" if item.get("supported") else "✗"
        passage = item.get("passage") or "—"
        lines.append(f"- {mark} {item.get('claim', '')}  `[{passage}]`")
        if not item.get("supported") and item.get("reason"):
            lines.append(f"  - 理由：{item['reason']}")
    if final.get("verify_note"):
        lines.append(f"- （{final['verify_note']}）")

    if final.get("challenge"):
        lines.append("\n**质疑者**")
        lines.append(str(final["challenge"]))

    ids = sorted({str(hit.get("id", "")) for hit in final.get("hits", [])})
    lines.append(f"\n**语料** · {len(final.get('hits', []))} 段")
    lines.append("`" + ("`, `".join(ids) if ids else "没有检索到") + "`")

    if ledger is not None and ledger.rows():
        lines.append("\n**账本**")
        for row in ledger.rows():
            marker = "" if row.priced else "（价表未知）"
            lines.append(
                f"- {row.actor} · {row.calls} 次 · {row.input_tokens}+{row.output_tokens} tok · "
                f"${row.cost_usd:.4f}{marker}"
            )
    return "\n".join(lines)


def make_handler(agent_factory: Callable[[], tuple[Any, Any]]):
    """The turn handler as a generator over the graph's steps — the whole Gradio integration surface.

    History is the messages format (a list of `{"role", "content"}` dicts): tuples were removed
    from Gradio's Chatbot, and the messages shape is the one the component is going to keep.
    """

    def handle(message: str, mode: str, thread: str, history: list | None):
        turns = list(history or [])
        if message.strip() == "":
            yield turns, "", ""
            return
        turns.append({"role": "user", "content": message})

        try:
            agent, ledger = agent_factory()
        except Exception as error:  # NoProvider included — said, not crashed
            turns.append({"role": "assistant", "content": f"（没做成：{error}）"})
            yield turns, "", ""
            return

        trail: list[str] = []
        state: dict = {}
        answered = False
        try:
            for update in agent.stream(
                fresh_turn(message, mode),
                {"configurable": {"thread_id": thread.strip() or "ui"}},
                stream_mode="updates",
            ):
                for node, output in update.items():
                    if not isinstance(output, dict):
                        continue
                    state.update(output)
                    note = node_status(node, output)
                    if note != "":
                        trail.append(note)
                    if node == "lead" and output.get("answer") and not answered:
                        # The answer lands in the chat as soon as it is written; the verification
                        # below it is then watched, not waited for.
                        turns.append({"role": "assistant", "content": output["answer"]})
                        answered = True
                    yield turns, "", render_trail(trail, state)
        except ProviderError as error:
            turns.append({"role": "assistant", "content": f"（provider 出错：{error}）"})
            yield turns, "", render_trail(trail, state)
            return
        except Exception as error:
            turns.append({"role": "assistant", "content": f"（没做成：{error}）"})
            yield turns, "", render_trail(trail, state)
            return

        if not answered:
            turns.append({"role": "assistant", "content": state.get("answer") or "（没有回答）"})
        yield turns, "", render_details(state, ledger)

    return handle


def build_ui(agent_factory: Callable[[], tuple[Any, Any]] | None = None):
    import gradio as gr  # imported here: the tests never need it, and neither does the CLI

    handle = make_handler(agent_factory or build_agent)
    theme = gr.themes.Base(
        primary_hue=gr.themes.colors.yellow,
        neutral_hue=gr.themes.colors.green,
    ).set(
        body_background_fill="#101a17",
        body_text_color="#eef3ee",
        block_background_fill="#12241e",
        block_border_color="#23372f",
        block_label_text_color="#9fb3aa",
        input_background_fill="#0e1a17",
        button_primary_background_fill="#f2d06b",
        button_primary_text_color="#1b2f28",
    )

    with gr.Blocks(title="教学平台 · agent", theme=theme, css=CSS) as demo:
        gr.Markdown(
            "### agent 课堂\n"
            "**grounded** 先从语料里检索，再回答，然后由另一位 actor 逐条核对有没有出处；"
            "**chat** 是直接课堂（ADR 0011），不检索、不判定。"
        )
        with gr.Row():
            with gr.Column(scale=3):
                history = gr.Chatbot(
                    label="课堂",
                    height=460,
                    placeholder="说点什么开始——比如「时区为什么会出现缺口」",
                )
                message = gr.Textbox(
                    label="你的话",
                    lines=2,
                    show_label=False,
                    placeholder="用你自己的话说说，或直接问…（Enter 发送）",
                )
                with gr.Row():
                    mode = gr.Radio(["grounded", "chat"], value="grounded", label="模式", scale=3)
                    thread = gr.Textbox(label="会话 id", value="ui", scale=2)
                    send = gr.Button("发送", variant="primary", scale=1)
                gr.Examples(
                    ["时区为什么会出现缺口", "MCP 的工具描述可以直接信任吗", "夏令时最早是哪个国家发明的"],
                    inputs=message,
                    label="试试",
                )
            with gr.Column(scale=2):
                details = gr.Markdown(
                    "**校验 · 质疑者 · 账本**\n\n还没有开始。grounded 模式下，回答写完后由另一位 actor 逐条核对。",
                    elem_id="details-pane",
                )
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
