from agent.rag.assets import Passage
from agent.rag.embed import FakeEmbedder
from agent.rag.store import Retriever


def passage(passage_id: str, text: str, source: str = "Spec §1", url: str | None = "https://example.test/spec") -> Passage:
    return Passage(
        domain="demo",
        domain_name="演示",
        passage_id=passage_id,
        source=source,
        url=url,
        sha256=None,
        fetched_at=None,
        text=text,
    )


PASSAGES = [
    passage("P-offset-is-signed", "An offset is computed as local time minus UTC, and a numeric offset carries an explicit sign."),
    passage("P-zone-is-a-set-of-rules", "A time zone is a set of rules, not a fixed offset."),
    passage("P-mcp-tool-safety", "Tools represent arbitrary code execution and must be treated with appropriate caution."),
]


def test_a_query_reaches_its_passage_with_provenance_attached() -> None:
    retriever = Retriever(PASSAGES, FakeEmbedder())
    hits = retriever.search("explicit sign of an offset", k=2)
    top = hits[0]
    assert top.passage.passage_id == "P-offset-is-signed"
    assert top.passage.source == "Spec §1"
    assert top.passage.url == "https://example.test/spec", "a hit carries the citation, not just the text"
    assert top.lexical_rank is not None, "the words half found it"
    assert top.vector_rank is not None, "and so did the vectors half (the fake one is lexical by construction)"
    assert top.score > 0


def test_the_two_halves_can_be_switched_off_independently() -> None:
    lexical_only = Retriever(PASSAGES, None, use_vector=False).search("time zone rules", k=1)
    assert lexical_only[0].passage.passage_id == "P-zone-is-a-set-of-rules"
    assert lexical_only[0].vector_rank is None

    vector_only = Retriever(PASSAGES, FakeEmbedder(), use_lexical=False).search("arbitrary code execution", k=1)
    assert vector_only[0].passage.passage_id == "P-mcp-tool-safety"
    assert vector_only[0].lexical_rank is None


def test_cjk_queries_match_cjk_text_without_a_segmentation_dictionary() -> None:
    retriever = Retriever([passage("P-zh", "时区是一套规则，不是固定的偏移量。")], None, use_vector=False)
    hits = retriever.search("偏移量是什么", k=1)
    assert hits[0].passage.passage_id == "P-zh"


def test_a_half_with_no_signal_gets_no_vote() -> None:
    # A Chinese query over English-only passages: the words half shares no token and must
    # abstain rather than rank by file order. The bug this pins: noise that ranked well on two
    # meaningless lists used to beat the one passage that actually matched. A large dim keeps the
    # fake embedder's hash collisions negligible, so the vectors half is equally honest and empty.
    retriever = Retriever(PASSAGES, FakeEmbedder(dim=4096))
    assert retriever.search("偏移量和时区什么关系", k=3) == [], "no half had anything to say"

    lexical = retriever.search("explicit sign of an offset", k=1)
    assert lexical[0].lexical_rank == 1, "when it does read the question, its ranking stands"


def test_an_empty_corpus_is_refused_rather_than_answered() -> None:
    try:
        Retriever([], FakeEmbedder())
    except ValueError as error:
        assert "no passages" in str(error)
    else:
        raise AssertionError("building over nothing must fail loudly")
