import json
from pathlib import Path

import pytest
from fastmcp import Client

from agent import mcp_server
from agent.rag.assets import Passage
from agent.rag.store import Hit
from agent.tools import Toolbox


class StubRetriever:
    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        return [
            Hit(
                passage=Passage(
                    domain="time-zones",
                    domain_name="时间戳、时区与夏令时",
                    passage_id="P-gap-and-overlap",
                    source="RFC 9557 §1.2",
                    url="https://www.rfc-editor.org/rfc/rfc9557#section-1.2",
                    sha256=None,
                    fetched_at=None,
                    text="A gap exists when clocks move forward over a local time.",
                ),
                score=0.03,
                vector_rank=1,
                lexical_rank=1,
            )
        ]


def stub_toolbox(domains: Path) -> Toolbox:
    return Toolbox(retriever=StubRetriever(), domains_dir=domains)


def text_of(result) -> str:
    data = getattr(result, "data", None)
    if isinstance(data, str):
        return data
    return result.content[0].text


async def test_the_signing_door_is_not_on_the_protocol(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(mcp_server, "_toolbox", lambda: stub_toolbox(tmp_path))
    async with Client(mcp_server.mcp) as client:
        tools = await client.list_tools()

    names = {tool.name for tool in tools}
    assert {
        "search_corpus",
        "list_domains",
        "read_domain",
        "describe_draft",
        "validate_draft",
        "build_domain",
    } <= names
    assert not any("sign" in name.lower() for name in names), (
        "a protocol that could sign would be a protocol that signs — ADR 0006/0010"
    )
    assert "recall_learner" not in names, (
        "the learner's own words stay in the classroom; the protocol is not a reader of them"
    )


async def test_search_over_the_protocol_returns_provenance(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(mcp_server, "_toolbox", lambda: stub_toolbox(tmp_path))
    async with Client(mcp_server.mcp) as client:
        result = await client.call_tool("search_corpus", {"query": "缺口"})

    payload = json.loads(text_of(result))
    assert payload["hits"][0]["id"] == "P-gap-and-overlap"
    assert payload["hits"][0]["url"] == "https://www.rfc-editor.org/rfc/rfc9557#section-1.2"


async def test_a_draft_can_be_described_but_not_signed(monkeypatch, tmp_path: Path) -> None:
    drafts = tmp_path / "domains-draft"
    (drafts / "demo-draft").mkdir(parents=True)
    (drafts / "demo-draft" / "meta.md").write_text("id: demo-draft\nname: 演示草稿\n", encoding="utf-8")
    (drafts / "demo-draft" / "sources.json").write_text(
        json.dumps([{"url": "https://example.test/spec", "fetchedAt": "2026-10-08", "sha256": "abc"}]),
        encoding="utf-8",
    )
    monkeypatch.setattr(mcp_server, "DRAFTS_DIR", drafts)

    async with Client(mcp_server.mcp) as client:
        described = json.loads(text_of(await client.call_tool("describe_draft", {"draft_id": "demo-draft"})))
        missing = json.loads(text_of(await client.call_tool("validate_draft", {"draft_id": "nope"})))

    assert "演示草稿" in described["meta"]
    assert described["sources"][0]["sha256"] == "abc"
    assert "no draft named nope" in missing["error"]


def test_an_id_that_would_reach_the_filesystem_badly_is_refused() -> None:
    assert mcp_server._safe_id("fine-id_1") == "fine-id_1"
    for bad in ("../secrets", "a/b", "a\\b", "", "  "):
        with pytest.raises(ValueError):
            mcp_server._safe_id(bad)
