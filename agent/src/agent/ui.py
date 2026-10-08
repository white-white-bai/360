"""`python -m agent.ui` — a Gradio page over the agent, for eyes that do not live in a terminal.

The knowledge system's 产品 section names Gradio for exactly this: a prototype surface, cheap
enough that it never becomes the product. It reuses the same graph as every other door — one
agent, several interfaces — and the turn handler is a generator, so the tests exercise a whole
turn with a scripted model and no browser (gradio is imported only when the page is built).

The transcript is OURS, not gradio's Chatbot. Two screenshots of the Chatbot's dark-mode
rendering disagreed with the served configuration in ways only a browser could settle — the
greeting rendered as a giant empty bubble (its light fill against chalk text), and the panel
layout did not remove it. Rather than iterate blind against a component whose art we do not
control, the transcript is a Markdown block we render ourselves, in the board's own narration
shape: a small actor label, prose on a ruled edge for the teacher, a tinted quoted block for the
learner. Every visible pixel is then a decision in this file.

The handler streams the graph's steps, because a grounded turn takes tens of seconds: the answer
appears as soon as it is written, the verification that follows is watched while it happens.

Install with the extra: `pip install -e ".[ui]"`; run: `python -m agent.ui` (port 18089 by
default, ATP_UI_PORT to change).
"""

from __future__ import annotations

import html
import os
import sys
from typing import Any, Callable

from .console import utf8_console
from .graph.graph import build_graph, fresh_turn
from .model import ProviderError

# The board's palette, as tokens — the two doors read as one product
# (platform/src/ui/index.html). The accent stays rare enough to mean something.
CSS = """
:root {
  --chalk: #e9efe9; --dim: #9fb3aa; --accent: #f2d06b; --attention: #ef8a63; --ok: #9ed3a8;
  --grid: #23372f; --panel: #12241e; --canvas: #0d1714;
}
.gradio-container { font-family: "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", serif; }

/* Deterministic layer: the theme tokens do the work, and these rules keep the page readable
   even where this gradio version ignores a token or the browser's colour mode disagrees. */
.gradio-container, .gradio-container .main { background: var(--canvas) !important; color: var(--chalk); }
.gradio-container .block { background: var(--panel) !important; border-color: var(--grid) !important; }
.gradio-container .prose, .gradio-container .prose * { color: var(--chalk); }
.gradio-container button.primary { background: var(--accent) !important; color: #1b2f28 !important; border: 0 !important; }
.gradio-container input, .gradio-container textarea {
  background: #0e1a17 !important; color: var(--chalk) !important; border-color: #2c4a42 !important;
}

/* The transcript, in the board's narration shape: an actor label, prose on a ruled edge for the
   teacher, a tinted block for the learner. Light-on-dark reads thinner, so more air and a trace
   of tracking; the measure stays inside a comfortable line length. */
#transcript { max-height: 58vh; overflow-y: auto; padding-right: 8px; font-size: 15px; }
#transcript .turn { margin: 0 0 20px; }
#transcript .turn .who { font-size: 11px; letter-spacing: .14em; color: var(--dim); margin-bottom: 4px; }
#transcript .turn.teacher { border-left: 2px solid var(--grid); padding-left: 14px; }
#transcript .turn.teacher .said { line-height: 1.85; letter-spacing: .01em; max-width: 70ch; }
#transcript .turn.teacher .said p { margin: .45em 0; }
#transcript .turn.learner { text-align: right; }
#transcript .turn.learner .said {
  display: inline-block; text-align: left; background: #1c332c; border: 1px solid var(--grid);
  border-radius: 6px; padding: 8px 12px; max-width: 80%; line-height: 1.7;
}

/* The right pane is a record, not prose: tight rhythm, tabular numbers, colour that carries
   meaning only next to a glyph. */
#details-pane { font-size: 13px; line-height: 1.7; }
#details-pane h3 { margin: 0 0 6px; font-size: 14.5px; letter-spacing: .02em; color: var(--chalk); }
#details-pane code { color: var(--accent); font-size: 12px; }
#details-pane table { font-variant-numeric: tabular-nums; font-size: 12.5px; }
#details-pane .ok { color: var(--ok); font-weight: 600; }
#details-pane .no { color: var(--attention); font-weight: 600; }
#details-pane .faint { color: var(--dim); }

/* Keyboard: a ring you can see on a dark surface. */
.gradio-container *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

/* Motion explains state or it does not happen. */
@media (prefers-reduced-motion: reduce) {
  .gradio-container * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
"""

# The same values for both colour modes: the browser's preference must not decide whether the
# board is readable. The first build set only the light-mode tokens, so a dark-mode browser got a
# dark canvas, light blocks and a header nobody could read.
_TOKENS = {
    "body_background_fill": "#0d1714",
    "body_text_color": "#e9efe9",
    "body_text_size": "15px",
    "background_fill_primary": "#12241e",
    "background_fill_secondary": "#0e1a17",
    "block_background_fill": "#12241e",
    "block_border_color": "#23372f",
    "block_label_background_fill": "#12241e",
    "block_label_text_color": "#9fb3aa",
    "block_title_text_color": "#9fb3aa",
    "border_color_primary": "#23372f",
    "input_background_fill": "#0e1a17",
    "input_border_color": "#2c4a42",
    "input_border_color_focus": "#f2d06b",
    "button_primary_background_fill": "#f2d06b",
    "button_primary_text_color": "#1b2f28",
    "button_primary_background_fill_hover": "#e7c356",
    "button_secondary_background_fill": "#1c332c",
    "button_secondary_text_color": "#e9efe9",
}

# `head` belongs to launch(), not Blocks: Blocks accepts the kwarg silently and serves nothing.
HEAD = "<script>document.documentElement.classList.add('dark')</script>"

GREETING = (
    "你好。这里是 **grounded** 模式：先在已签字的语料里检索，再回答；"
    "回答写完后由另一位 actor 逐条核对每条断言有没有出处，结果在右边。\n\n"
    "也可以切到 **chat**：直接课堂，不检索、不判定。开始吧，比如「时区为什么会出现缺口」。"
)

GREETING_TURNS = [{"role": "assistant", "content": GREETING}]


def render_transcript(turns: list[dict]) -> str:
    """The whole conversation, in the board's narration shape.

    The teacher's turns are model markdown and render as markdown; the learner's are their own
    words and must render as TEXT — a learner who types `<b>` gets to see `<b>`.
    """
    blocks: list[str] = []
    for turn in turns:
        content = str(turn.get("content", ""))
        if turn.get("role") == "user":
            safe = html.escape(content).replace("\n", "<br>")
            blocks.append(f'<div class="turn learner"><div class="who">你</div><div class="said">{safe}</div></div>')
        else:
            blocks.append(f'<div class="turn teacher"><div class="who">主讲</div><div class="said">{content}</div></div>')
    return "\n".join(blocks)


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
    """While a turn runs: the steps so far, the newest one carrying the weight."""
    steps = trail[-4:]
    lines = ["**进度**"]
    for index, item in enumerate(steps):
        lines.append(f"- **{item}**" if index == len(steps) - 1 else f"- {item}")
    if state.get("verified") is True:
        lines.append("")
        lines.append('<span class="ok">核对通过</span>，正在收尾。')
    elif state.get("verified") is False:
        unsupported = len([item for item in state.get("verdicts", []) if not item.get("supported")])
        lines.append("")
        lines.append(f'<span class="no">{unsupported} 条没有出处</span>，老师正在按意见重写…')
    return "\n".join(lines)


def render_details(final: dict, ledger: Any) -> str:
    """The pane beside the chat: the verdict leads, then the challenger, the corpus, the ledger."""
    lines: list[str] = []

    state = "通过" if final.get("verified") else ("未通过" if final.get("verified") is False else "未判定")
    verdicts = final.get("verdicts", [])
    lines.append(f"### 校验 · {state}")
    lines.append(f'<span class="faint">共核对 {len(verdicts)} 条断言。每条都必须有语料支持。</span>')
    for item in verdicts:
        mark = '<span class="ok">✓</span>' if item.get("supported") else '<span class="no">✗</span>'
        passage = item.get("passage") or "—"
        lines.append(f"- {mark} {item.get('claim', '')}  `[{passage}]`")
        if not item.get("supported") and item.get("reason"):
            lines.append(f'  - <span class="faint">理由：{item["reason"]}</span>')
    if final.get("verify_note"):
        lines.append(f'- <span class="faint">（{final["verify_note"]}）</span>')

    if final.get("challenge"):
        lines.append("\n### 质疑者")
        lines.append(str(final["challenge"]))

    ids = sorted({str(hit.get("id", "")) for hit in final.get("hits", [])})
    lines.append(f"\n### 语料 · {len(final.get('hits', []))} 段")
    lines.append("`" + ("`, `".join(ids) if ids else "没有检索到") + "`")

    if ledger is not None and ledger.rows():
        lines.append("\n### 账本")
        lines.append("| actor | 调用 | tokens | 花费 |")
        lines.append("| --- | --- | --- | --- |")
        for row in ledger.rows():
            cost = f"${row.cost_usd:.4f}" + ("" if row.priced else " （价表未知）")
            lines.append(f"| {row.actor} | {row.calls} | {row.input_tokens}+{row.output_tokens} | {cost} |")
    return "\n".join(lines)


EMPTY_PANE = (
    "### 还没有开始\n"
    "说一句，或者点下面任意一个问题试试。\n\n"
    '<span class="faint">grounded：先在语料里检索，回答写完后由另一位 actor 逐条核对'
    "每条断言有没有出处——结果与花费都会出现在这里。</span>"
)


def make_handler(agent_factory: Callable[[], tuple[Any, Any]]):
    """The turn handler as a generator over the graph's steps.

    Inputs: the message, the mode, the thread id, and the turn list (gradio State). Outputs: the
    rendered transcript, the cleared input, the details pane, and the updated turn list.
    """

    def handle(message: str, mode: str, thread: str, turns: list | None):
        turns = list(turns or [])
        if message.strip() == "":
            yield render_transcript(turns), "", "", turns
            return
        turns.append({"role": "user", "content": message})

        try:
            agent, ledger = agent_factory()
        except Exception as error:  # NoProvider included — said, not crashed
            turns.append({"role": "assistant", "content": f"（没做成：{error}）"})
            yield render_transcript(turns), "", "", turns
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
                        # The answer lands in the transcript as soon as it is written; the
                        # verification below it is then watched, not waited for.
                        turns.append({"role": "assistant", "content": output["answer"]})
                        answered = True
                    yield render_transcript(turns), "", render_trail(trail, state), turns
        except ProviderError as error:
            turns.append({"role": "assistant", "content": f"（provider 出错：{error}）"})
            yield render_transcript(turns), "", render_trail(trail, state), turns
            return
        except Exception as error:
            turns.append({"role": "assistant", "content": f"（没做成：{error}）"})
            yield render_transcript(turns), "", render_trail(trail, state), turns
            return

        if not answered:
            turns.append({"role": "assistant", "content": state.get("answer") or "（没有回答）"})
        yield render_transcript(turns), "", render_details(state, ledger), turns

    return handle


def build_ui(agent_factory: Callable[[], tuple[Any, Any]] | None = None):
    import inspect

    import gradio as gr  # imported here: the tests never need it, and neither does the CLI

    # Both colour modes get the same values, and only the variants this gradio version actually
    # accepts are passed — checked against the installed signature rather than assumed, which is
    # how the previous pass's one wrong token name (input_border_color_primary) got caught.
    accepted = set(inspect.signature(gr.themes.Base().set).parameters)
    tokens = {
        f"{name}{suffix}": value
        for name, value in _TOKENS.items()
        for suffix in ("", "_dark")
        if f"{name}{suffix}" in accepted
    }
    theme = gr.themes.Base(
        primary_hue=gr.themes.colors.yellow,
        neutral_hue=gr.themes.colors.green,
    ).set(**tokens)

    handle = make_handler(agent_factory or build_agent)
    with gr.Blocks(title="教学平台 · agent", theme=theme, css=CSS) as demo:
        gr.Markdown(
            "## agent 课堂\n"
            '<span class="faint" style="color:#9fb3aa">同一个图，换一双眼睛。'
            "grounded 先检索再回答、逐条核对；chat 是直接课堂（ADR 0011），不检索、不判定。</span>"
        )
        with gr.Row():
            with gr.Column(scale=3):
                transcript = gr.Markdown(render_transcript(GREETING_TURNS), elem_id="transcript")
                turns = gr.State(list(GREETING_TURNS))
                with gr.Row():
                    message = gr.Textbox(
                        label="你的话",
                        lines=2,
                        scale=5,
                        placeholder="用你自己的话说说，或直接问……（Enter 发送）",
                    )
                    send = gr.Button("发送", variant="primary", size="lg", scale=1)
                with gr.Row():
                    mode = gr.Radio(
                        ["grounded", "chat"],
                        value="grounded",
                        label="模式",
                        scale=3,
                        info="grounded：先检索、再回答、另一位 actor 逐条核对；chat：直接课堂，无校验。",
                    )
                    with gr.Accordion("续上一次（会话 id）", open=False):
                        thread = gr.Textbox(
                            show_label=False,
                            value="ui",
                            placeholder="换一个名字就是新开一节",
                        )
                gr.Examples(
                    ["时区为什么会出现缺口", "MCP 的工具描述可以直接信任吗", "夏令时最早是哪个国家发明的"],
                    inputs=message,
                    label="试试这些",
                )
            with gr.Column(scale=2):
                details = gr.Markdown(EMPTY_PANE, elem_id="details-pane")
        outputs = [transcript, message, details, turns]
        inputs = [message, mode, thread, turns]
        send.click(handle, inputs, outputs)
        message.submit(handle, inputs, outputs)
    return demo


def main() -> int:
    utf8_console()
    port = int(os.environ.get("ATP_UI_PORT", "18089"))
    build_ui().launch(server_name="127.0.0.1", server_port=port, head=HEAD)
    return 0


if __name__ == "__main__":
    sys.exit(main())
