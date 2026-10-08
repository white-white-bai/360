import json
from pathlib import Path

import pytest

from agent.rag.assets import Passage
from agent.rag.store import Hit
from agent.tools import Toolbox, parse_tool_names, tool_schemas


def make_domain(root: Path) -> None:
    domain = root / "demo"
    domain.mkdir(parents=True)
    (domain / "meta.md").write_text("id: demo\nname: 演示课程\nowner: 白杨\n", encoding="utf-8")
    (domain / "corpus.md").write_text(
        "## P-one\nsource: Spec §1 — https://example.test/spec\n> The first passage.\n", encoding="utf-8"
    )
    (domain / "misconceptions.md").write_text("## M-1\nname: 常见错误\n", encoding="utf-8")
    (domain / "checks.md").write_text("## C-1\nprompt: 请复述\n", encoding="utf-8")


class StubRetriever:
    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        return [
            Hit(
                passage=Passage(
                    domain="demo",
                    domain_name="演示课程",
                    passage_id="P-one",
                    source="Spec §1",
                    url="https://example.test/spec",
                    sha256="abc",
                    fetched_at="2026-10-08",
                    text="The first passage.",
                ),
                score=0.02,
                vector_rank=1,
                lexical_rank=2,
            )
        ]


def toolbox(root: Path) -> Toolbox:
    return Toolbox(retriever=StubRetriever(), domains_dir=root)


def test_search_corpus_returns_hits_with_their_provenance(tmp_path: Path) -> None:
    make_domain(tmp_path)
    result = json.loads(toolbox(tmp_path).run("search_corpus", {"query": "第一个段落"}))
    first = result["hits"][0]
    assert first["id"] == "P-one"
    assert first["source"] == "Spec §1"
    assert first["url"] == "https://example.test/spec", "a tool result the verifier can check against"


def test_the_catalogue_lists_only_signed_shaped_domains(tmp_path: Path) -> None:
    make_domain(tmp_path)
    (tmp_path / "not-a-domain").mkdir()
    result = json.loads(toolbox(tmp_path).run("list_catalogue", {}))
    assert result["domains"] == [{"id": "demo", "name": "演示课程"}]


def test_reading_a_domain_carries_its_boundary_material(tmp_path: Path) -> None:
    make_domain(tmp_path)
    result = json.loads(toolbox(tmp_path).run("read_domain", {"domain": "demo"}))
    assert "owner: 白杨" in result["meta"]
    assert "M-1" in result["misconceptions"]
    assert "C-1" in result["checks"]

    missing = json.loads(toolbox(tmp_path).run("read_domain", {"domain": "nope"}))
    assert "no Domain named nope" in missing["error"]


def test_a_bad_call_comes_back_as_an_error_the_model_can_read(tmp_path: Path) -> None:
    make_domain(tmp_path)
    assert "no tool named" in json.loads(toolbox(tmp_path).run("delete_everything", {}))["error"]
    assert "needs a query" in json.loads(toolbox(tmp_path).run("search_corpus", {}))["error"]


def test_the_schemas_are_copied_not_shared() -> None:
    schemas = tool_schemas()
    schemas[0]["function"]["name"] = "mutated"
    assert tool_schemas()[0]["function"]["name"] == "search_corpus", "a caller cannot edit the shipped schemas"


def test_a_narrowed_session_is_enforced_twice(tmp_path: Path) -> None:
    make_domain(tmp_path)
    narrow = Toolbox(retriever=StubRetriever(), domains_dir=tmp_path, allowed=frozenset({"search_corpus"}))

    assert [schema["function"]["name"] for schema in narrow.schemas()] == ["search_corpus"], (
        "the model is not even offered what the session does not allow"
    )
    refused = json.loads(narrow.run("list_catalogue", {}))
    assert "not allowed" in refused["error"], "and a call that arrives anyway is refused"


def test_the_default_session_keeps_every_read_only_tool(tmp_path: Path) -> None:
    make_domain(tmp_path)
    assert len(Toolbox(retriever=StubRetriever(), domains_dir=tmp_path).schemas()) == 4


def test_an_unknown_tool_name_is_refused_not_ignored() -> None:
    assert parse_tool_names("search_corpus, read_domain") == frozenset({"search_corpus", "read_domain"})
    with pytest.raises(ValueError):
        parse_tool_names("search_corpus, mind_reader")
