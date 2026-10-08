import json
from pathlib import Path

from agent.graph.graph import build_graph, fresh_turn
from agent.model import ModelReply, ScriptedModel, ToolCall
from agent.rag.assets import Passage
from agent.rag.store import Hit
from agent.tools import Toolbox


def hit(passage_id: str = "P-gap-and-overlap") -> Hit:
    return Hit(
        passage=Passage(
            domain="time-zones",
            domain_name="时间戳、时区与夏令时",
            passage_id=passage_id,
            source="RFC 9557 §1.2",
            url="https://www.rfc-editor.org/rfc/rfc9557#section-1.2",
            sha256=None,
            fetched_at=None,
            text="A gap exists when clocks move forward over a local time, so that local times are skipped.",
        ),
        score=0.03,
        vector_rank=1,
        lexical_rank=1,
    )


class StubRetriever:
    def __init__(self, hits: list[Hit]) -> None:
        self.hits = hits

    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        return self.hits[:k]


def toolbox(hits: list[Hit] | None = None) -> Toolbox:
    return Toolbox(retriever=StubRetriever(hits if hits is not None else [hit()]), domains_dir=Path("unused"))


def search_call() -> ModelReply:
    return ModelReply("", [ToolCall(id="call-1", name="search_corpus", arguments={"query": "为什么有缺口"})])


def verdict(supported: bool) -> ModelReply:
    return ModelReply(
        text=json.dumps(
            {
                "claims": [
                    {
                        "claim": "缺口时本地时间被跳过",
                        "supported": supported,
                        "passage": "P-gap-and-overlap" if supported else None,
                        "reason": "出自 P-gap-and-overlap" if supported else "语料没有说这一条",
                    }
                ]
            }
        )
    )


def test_grounded_turn_searches_answers_and_is_verified_by_another_actor() -> None:
    model = ScriptedModel(
        [
            search_call(),
            ModelReply("缺口发生在时钟向前拨的时候，有些本地时刻被跳过。[P-gap-and-overlap]"),
            verdict(True),
        ]
    )
    agent = build_graph(model, toolbox(), max_steps=4)
    final = agent.invoke(fresh_turn("时区为什么有缺口", "grounded"))

    assert final["answer"].startswith("缺口")
    assert final["verified"] is True
    assert [item["id"] for item in final["hits"]] == ["P-gap-and-overlap"], "the hits carry provenance"
    assert final["steps"] == 2, "one call to choose the tool, one to answer"
    assert model.seen[1]["messages"][-1]["role"] == "tool", "the search result reached the teacher"
    assert json.loads(model.seen[1]["messages"][-1]["content"])["hits"][0]["url"].startswith("https://")
    assert {row.actor for row in model.ledger.rows()} == {"lead-explainer", "verifier"}, "both actors cost money"


def test_an_unsupported_claim_gets_one_revision_and_then_the_verdict_stands() -> None:
    model = ScriptedModel(
        [
            search_call(),
            ModelReply("缺口是因为地球自转变慢了。[P-gap-and-overlap]"),
            verdict(False),
            ModelReply("换个说法：缺口是时钟前拨时被跳过的本地时刻。[P-gap-and-overlap]"),
            verdict(True),
        ]
    )
    agent = build_graph(model, toolbox(), max_steps=4)
    final = agent.invoke(fresh_turn("时区为什么有缺口", "grounded"))

    assert final["revised"] is True
    assert final["verified"] is True, "the revision fixed it"
    assert "没有可追溯的出处" in json.dumps(model.seen[3]["messages"], ensure_ascii=False), "the reasons reached the teacher"


def test_a_second_refusal_is_final_and_the_reasons_travel_with_the_answer() -> None:
    model = ScriptedModel(
        [
            search_call(),
            ModelReply("第一版答案。"),
            verdict(False),
            ModelReply("第二版答案。"),
            verdict(False),
        ]
    )
    agent = build_graph(model, toolbox(), max_steps=4)
    final = agent.invoke(fresh_turn("时区为什么有缺口", "grounded"))

    assert final["verified"] is False
    assert final["answer"] == "第二版答案。"
    assert final["verdicts"][0]["supported"] is False
    # A sixth call would raise inside ScriptedModel: the graph stopped at its own bound.


def test_chat_mode_has_no_tools_and_nobody_judges_it() -> None:
    model = ScriptedModel([ModelReply("先讲第一点：时区是一套规则。")])
    agent = build_graph(model, toolbox(), max_steps=4)
    final = agent.invoke(fresh_turn("时区是什么", "chat"))

    assert final["answer"].startswith("先讲")
    assert final["verified"] is None
    assert final["hits"] == []
    assert [seen["actor"] for seen in model.seen] == ["lead-explainer"], "no verifier in chat mode"
    assert model.seen[0]["tools"] == [], "and no tools offered"


def test_the_tool_bound_stops_a_loop_that_would_not_stop() -> None:
    model = ScriptedModel([search_call(), search_call()])
    agent = build_graph(model, toolbox(), max_steps=2)
    final = agent.invoke(fresh_turn("一直搜", "grounded"))

    assert final.get("answer", "") == "", "the bound ended the turn instead of looping"
    assert final["verified"] is None, "there was nothing to verify"
    # A third call would raise inside ScriptedModel — that is the bound being tested.


def test_the_verifier_sees_an_empty_corpus_as_an_empty_corpus() -> None:
    model = ScriptedModel(
        [
            ModelReply("语料里没有覆盖这个问题。"),
            ModelReply(json.dumps({"claims": []})),
        ]
    )
    agent = build_graph(model, toolbox(hits=[]), max_steps=4)
    final = agent.invoke(fresh_turn("语料外的问题", "grounded"))

    assert final["verified"] is True, "nothing asserted, nothing unsupported"
    prompt = model.seen[1]["messages"][-1]["content"]
    assert "(none — the teacher retrieved nothing)" in prompt, "the verifier is told when there is nothing"
