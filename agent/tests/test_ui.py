import json
from pathlib import Path

from agent.graph.graph import build_graph
from agent.ledger import Ledger
from agent.model import ModelReply, ScriptedModel, ToolCall
from agent.rag.assets import Passage
from agent.rag.store import Hit
from agent.tools import Toolbox
from agent.ui import make_handler, render_details, render_transcript


class StubRetriever:
    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        return [
            Hit(
                passage=Passage(
                    domain="time-zones",
                    domain_name="时区",
                    passage_id="P-gap-and-overlap",
                    source="RFC 9557 §1.2",
                    url="https://example.test/rfc9557",
                    sha256=None,
                    fetched_at=None,
                    text="A gap exists when clocks move forward over a local time.",
                ),
                score=0.03,
                vector_rank=1,
                lexical_rank=1,
            )
        ]


def one_turn_factory():
    model = ScriptedModel(
        [
            ModelReply("", [ToolCall(id="c1", name="search_corpus", arguments={"query": "缺口"})]),
            ModelReply("缺口是时钟前拨时被跳过的本地时刻。[P-gap-and-overlap]"),
            ModelReply(json.dumps({"claims": [{"claim": "缺口存在", "supported": True, "passage": "P-gap-and-overlap", "reason": "ok"}]})),
        ]
    )
    toolbox = Toolbox(retriever=StubRetriever(), domains_dir=Path("unused"))
    return build_graph(model, toolbox, max_steps=4), model.ledger


def test_the_details_pane_says_what_happened(tmp_path: Path) -> None:
    agent, ledger = one_turn_factory()
    final = agent.invoke({"question": "时区为什么有缺口", "mode": "grounded", "steps": 0, "hits": [], "messages": []})
    text = render_details(final, ledger)

    assert "校验" in text and "通过" in text
    assert "P-gap-and-overlap" in text
    assert "语料" in text
    assert "账本" in text


def test_the_transcript_labels_both_voices_and_keeps_the_learner_s_words_as_text() -> None:
    text = render_transcript(
        [
            {"role": "assistant", "content": "**要点**"},
            {"role": "user", "content": "<b>不是这样的</b>"},
        ]
    )
    assert "主讲" in text and "你" in text
    assert "**要点**" in text, "the teacher's markdown stays markdown"
    assert '<div class="said">\n\n' in text, (
        "and it is separated by a blank line: CommonMark does not parse markdown inside a "
        "block-level HTML element without one — the first build shipped literal asterisks"
    )
    assert "&lt;b&gt;" in text and "<b>" not in text, "a learner who types html gets to see html"


def test_the_handler_streams_the_turn_instead_of_freezing_on_it(tmp_path: Path) -> None:
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return one_turn_factory()

    handle = make_handler(factory)
    events = list(handle("时区为什么有缺口", "grounded", "t1", []))

    assert calls["n"] == 1
    transcript, cleared, details, turns = events[-1]
    assert "缺口" in transcript, "the answer is in the transcript"
    assert 'class="turn learner"' in transcript and "时区为什么有缺口" in transcript
    assert cleared == ""
    assert "校验" in details and "通过" in details
    assert "缺口" in turns[-1]["content"], "and the turn list carries the conversation forward"

    # The point of the generator: a grounded turn takes tens of seconds, and the page shows the
    # steps as they happen rather than looking frozen for the whole minute.
    progress = [event[2] for event in events[:-1]]
    assert any("进度" in item for item in progress), "progress is streamed, not just the ending"
    assert any("检索完成" in item for item in progress), "the search step is visible while it runs"


def test_the_handler_survives_a_broken_factory_and_an_empty_message(tmp_path: Path) -> None:
    def refusing():
        raise RuntimeError("没有配置 provider")

    handle = make_handler(refusing)
    transcript, _, _, _ = list(handle("你好", "grounded", "t", []))[-1]
    assert "没做成" in transcript, "a failure is a turn the learner can read, not a stack trace"

    events = list(handle("   ", "grounded", "t", []))
    assert len(events) == 1
    transcript, cleared, details, turns = events[0]
    assert transcript == "" and cleared == "" and details == "" and turns == []


def test_an_undecided_turn_says_so() -> None:
    text = render_details({"verified": None, "verdicts": [], "hits": [], "challenge": ""}, Ledger())
    assert "未判定" in text
    assert "没有检索到" in text
