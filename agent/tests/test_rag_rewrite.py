import json
from pathlib import Path

import pytest

from agent.rag.rewrite import RewriteError, parse_queries, rewrite_query


def test_parse_queries_keeps_the_question_first_and_caps_at_three() -> None:
    queries = parse_queries('["why gaps happen", "DST transition explanation", "an extra one"]', "为什么有缺口")
    assert queries == ["为什么有缺口", "why gaps happen", "DST transition explanation"], (
        "the learner's own question leads; a reformulation can only add"
    )


def test_parse_queries_survives_fences_and_refuses_garbage() -> None:
    assert parse_queries('```json\n["a"]\n```', "q") == ["q", "a"]
    assert parse_queries("我建议你搜索时区", "q") == ["q"], (
        "a reply that is not a JSON array is an error, not a query nobody wrote"
    )
    assert parse_queries('["q", "q"]', "q") == ["q"], "the original is not duplicated"


def test_rewrite_without_a_provider_refuses_rather_than_pretending() -> None:
    with pytest.raises(RewriteError):
        rewrite_query("为什么有缺口", config=None)


def test_a_failed_rewrite_leaves_the_original_question_and_says_so(monkeypatch, tmp_path: Path) -> None:
    from agent.rag.assets import Passage
    from agent.rag.store import Hit
    from agent.tools import Toolbox

    class StubRetriever:
        def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
            return [
                Hit(
                    passage=Passage(
                        domain="demo",
                        domain_name="演示",
                        passage_id="P-one",
                        source="Spec §1",
                        url="https://example.test/spec",
                        sha256=None,
                        fetched_at=None,
                        text="The first passage.",
                    ),
                    score=0.02,
                    vector_rank=1,
                    lexical_rank=1,
                )
            ]

    def refusing(*args, **kwargs):
        raise RewriteError("rewriter unreachable: timed out")

    monkeypatch.setattr("agent.tools.rewrite_query", refusing)
    toolbox = Toolbox(
        retriever=StubRetriever(),
        domains_dir=tmp_path,
        rewrite_config=object(),  # configured, so the call is attempted
    )
    payload = json.loads(toolbox.search_corpus("为什么有缺口"))
    assert payload["queries"] == ["为什么有缺口"], "degraded to the question as asked"
    assert "rewrite skipped" in payload["note"]
    assert payload["hits"][0]["id"] == "P-one"
