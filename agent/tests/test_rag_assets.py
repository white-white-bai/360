from pathlib import Path

from agent.rag.assets import parse_corpus, parse_meta, split_source
from agent.rag.tokens import tokenize

HAND_WRITTEN = """<!--\nREVIEWED. Signed off by 白杨 on 2026-09-28.\n-->\n\n# Corpus — time stamps\n\n## P-offset-is-signed\n\nsource: RFC 3339 §4.2 "Local Offsets" — https://www.rfc-editor.org/rfc/rfc3339#section-4.2\n\nAn offset is computed as local time minus UTC, and a numeric offset carries an\nexplicit sign.\n\n## P-zone-is-a-set-of-rules\n\nsource: RFC 9557 §1.2 — https://www.rfc-editor.org/rfc/rfc9557#section-1.2\n\nA time zone is a set of rules, not a fixed offset.\n"""

BUILT = """## P-mcp-tool-safety\nsource: Specification § Security and Trust & Safety — Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18\n> Tools represent arbitrary code execution and must be treated with appropriate caution.\n"""


def test_the_hand_written_shape_parses_with_its_citation() -> None:
    passages = parse_corpus(HAND_WRITTEN, domain="time-zones", domain_name="时间戳、时区与夏令时")
    assert [p.passage_id for p in passages] == ["P-offset-is-signed", "P-zone-is-a-set-of-rules"]
    first = passages[0]
    assert first.domain == "time-zones"
    assert first.source == 'RFC 3339 §4.2 "Local Offsets"'
    assert first.url == "https://www.rfc-editor.org/rfc/rfc3339#section-4.2"
    assert "local time minus UTC" in first.text
    assert "<!--" not in first.text, "the file's leading review record is not a passage"


def test_the_built_shape_parses_blockquotes_and_double_dash_sources() -> None:
    passages = parse_corpus(BUILT, domain="agent-dev-essentials", domain_name="LLM Agent 开发基础")
    assert len(passages) == 1
    passage = passages[0]
    assert passage.text == "Tools represent arbitrary code execution and must be treated with appropriate caution."
    assert passage.source == "Specification § Security and Trust & Safety — Tool Safety"
    assert passage.url == "https://modelcontextprotocol.io/specification/2025-06-18"


def test_sources_json_enriches_by_url() -> None:
    passages = parse_corpus(
        BUILT,
        domain="agent-dev-essentials",
        domain_name="LLM Agent 开发基础",
        provenance={"https://modelcontextprotocol.io/specification/2025-06-18": {"sha256": "abc123", "fetchedAt": "2026-09-29"}},
    )
    assert passages[0].sha256 == "abc123"
    assert passages[0].fetched_at == "2026-09-29"


def test_meta_and_source_splitting_details() -> None:
    meta = parse_meta("id: time-zones\nname: 时间戳、时区与夏令时\nowner: TODO\n")
    assert meta["id"] == "time-zones"
    assert meta["name"] == "时间戳、时区与夏令时"

    citation, url = split_source("Specification — Tool Safety — https://example.test/spec")
    assert citation == "Specification — Tool Safety"
    assert url == "https://example.test/spec"
    assert split_source("no url here") == ("no url here", None)


def test_the_tokenizer_speaks_both_scripts() -> None:
    assert tokenize("RFC 3339") == ["rfc", "3339"]
    tokens = tokenize("偏移量的")
    assert "偏移" in tokens and "移量" in tokens, "CJK becomes character bigrams"
    assert tokenize("ReAct agent") == ["react", "agent"], "case folds"
