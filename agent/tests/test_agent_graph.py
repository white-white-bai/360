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
    assert final["challenge"] == "", "no misconception catalogue behind this one, so no challenger"


def test_an_unknown_citation_is_caught_by_the_kernel_not_by_the_verifier() -> None:
    model = ScriptedModel(
        [
            search_call(),
            # The live eval caught this shape: the model cited a REAL passage (it exists in
            # another Domain) that this run's search had not returned. A citation nobody was
            # given is a citation nobody can check — refused the same way a fabricated one is.
            ModelReply("工具描述不可以直接信任 [P-tool-annotations-untrusted]。"),
            ModelReply("工具描述不可以直接信任 [P-gap-and-overlap]。"),
            verdict(True),
        ]
    )
    agent = build_graph(model, toolbox(), max_steps=4)
    final = agent.invoke(fresh_turn("MCP 的工具描述可以直接信任吗", "grounded"))

    assert final["revised"] is True
    assert final["verified"] is True
    actors = [seen["actor"] for seen in model.seen]
    assert actors == ["lead-explainer", "lead-explainer", "lead-explainer", "verifier"], (
        "search, the bad answer, the revision — and the verifier was asked exactly once, about the good one"
    )
    revision = json.dumps(model.seen[2]["messages"], ensure_ascii=False)
    assert "P-tool-annotations-untrusted" in revision
    assert "可用的段落 id" in revision and "P-gap-and-overlap" in revision


def test_unknown_citations_ignores_ids_that_were_actually_retrieved() -> None:
    from agent.graph.nodes import unknown_citations

    hits = [{"id": "P-gap-and-overlap"}]
    assert unknown_citations("见 [P-gap-and-overlap] 与 [P-invented]", hits) == ["P-invented"]
    assert unknown_citations("没有任何引用", hits) == []


def test_the_policy_filters_what_the_model_is_offered() -> None:
    model = ScriptedModel([ModelReply("时区是一套规则。"), verdict(True)])
    narrow = Toolbox(
        retriever=StubRetriever([hit()]),
        domains_dir=Path("unused"),
        allowed=frozenset({"search_corpus"}),
    )
    agent = build_graph(model, narrow, max_steps=4)
    final = agent.invoke(fresh_turn("时区是什么", "grounded"))

    offered = [tool["function"]["name"] for tool in model.seen[0]["tools"]]
    assert offered == ["search_corpus"], "a policy that only refuses is a policy the model wastes calls on"
    assert final["verified"] is True


def test_the_challenger_names_and_refutes_a_catalogued_misconception(tmp_path: Path) -> None:
    domain = tmp_path / "time-zones"
    domain.mkdir()
    (domain / "meta.md").write_text("id: time-zones\nname: 时区\n", encoding="utf-8")
    (domain / "corpus.md").write_text(
        "## P-gap-and-overlap\nsource: RFC 9557 §1.2 — https://example.test/rfc\n> Gap text.\n",
        encoding="utf-8",
    )
    (domain / "misconceptions.md").write_text("## M-1\nname: 缺口就是时间变少了\n", encoding="utf-8")

    model = ScriptedModel(
        [
            search_call(),
            ModelReply("缺口是时钟前拨时被跳过的本地时刻。[P-gap-and-overlap]"),
            verdict(True),
            ModelReply("你把缺口理解成「时间变少了」——变少的不是时间，是没有任何钟面读数对应的那些时刻。"),
        ]
    )
    agent = build_graph(model, Toolbox(retriever=StubRetriever([hit()]), domains_dir=tmp_path), max_steps=4)
    final = agent.invoke(fresh_turn("时区为什么有缺口", "grounded"))

    assert final["challenge"].startswith("你把缺口")
    assert model.seen[-1]["actor"] == "challenger"
    assert "M-1" in model.seen[-1]["messages"][-1]["content"], "the misconceptions catalogue was the target list"


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
