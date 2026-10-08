from agent.rag.assets import Passage
from agent.rag.rerank import RerankError, llm_rerank, parse_order
from agent.rag.store import Hit


def passage(passage_id: str, text: str) -> Passage:
    return Passage(
        domain="demo",
        domain_name="演示",
        passage_id=passage_id,
        source="Spec §1",
        url="https://example.test/spec",
        sha256=None,
        fetched_at=None,
        text=text,
    )


def hits() -> list[Hit]:
    return [
        Hit(passage=passage("A-first", "first"), score=0.03, vector_rank=1, lexical_rank=None),
        Hit(passage=passage("B-second", "second"), score=0.02, vector_rank=None, lexical_rank=1),
        Hit(passage=passage("C-third", "third"), score=0.01, vector_rank=2, lexical_rank=2),
    ]


def test_the_replys_order_is_taken_and_the_rest_keeps_its_relative_order() -> None:
    ranked = parse_order('["C-third", "A-first"]', hits())
    assert [hit.passage.passage_id for hit in ranked] == ["C-third", "A-first", "B-second"]


def test_a_reply_that_names_nothing_leaves_everything_alone() -> None:
    original = hits()
    assert [hit.passage.passage_id for hit in parse_order("抱歉，我无法排序。", original)] == [
        "A-first",
        "B-second",
        "C-third",
    ]


def test_duplicates_and_unknown_names_are_ignored() -> None:
    ranked = parse_order('["B-second", "B-second", "Z-nope", "A-first"]', hits())
    assert [hit.passage.passage_id for hit in ranked] == ["B-second", "A-first", "C-third"]


def test_without_a_provider_the_rerank_refuses_instead_of_pretending() -> None:
    try:
        llm_rerank("q", hits(), config=None)
    except RerankError:
        pass
    else:
        raise AssertionError("no provider must be a refusal, not a silent no-op")
