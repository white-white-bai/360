"""The corpus, parsed into the unit retrieval works on: the passage.

Why passages and not overlapping chunks: in this repository a passage is not a text fragment, it
is a CITATION — an id and a source that the builder's kernel proof, the validator and the sign
gate all treat as the thing a claim must trace to. Re-chunking would break the one property
retrieval exists to preserve here: every hit can be shown with the same provenance a lesson
would cite.

Both shapes the repository has produced are read: the hand-written paragraphs (time-zones) and
the builder's blockquoted verbatim quotes (`>` per line). sources.json, when present, enriches a
passage with the sha256 and fetch date of the document it came from.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

_HEADING = re.compile(r"^##\s+(.+?)\s*$")
_SOURCE_LINE = re.compile(r"^source:\s*(.+?)\s*$")
_META_LINE = re.compile(r"^([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$")


@dataclass(frozen=True)
class Passage:
    domain: str
    domain_name: str
    passage_id: str
    source: str
    url: str | None
    sha256: str | None
    fetched_at: str | None
    text: str


def parse_meta(text: str) -> dict[str, str]:
    """`key: value` lines of a meta.md, read generically — only id and name are used here."""
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = _META_LINE.match(line.strip())
        if match is not None:
            values[match.group(1)] = match.group(2)
    return values


def split_source(line: str) -> tuple[str, str | None]:
    """`<citation> — <url>`: the URL is the last em-dash segment, when it is one.

    Built Domains write two em dashes (`Specification — Tool Safety — https://…`), so this
    splits from the right rather than taking a fixed number of parts.
    """
    parts = [part.strip() for part in line.split(" — ")]
    if parts and parts[-1].startswith("http"):
        return " — ".join(parts[:-1]), parts[-1]
    return line.strip(), None


def parse_corpus(
    text: str,
    *,
    domain: str,
    domain_name: str,
    provenance: dict[str, dict[str, str]] | None = None,
) -> list[Passage]:
    """Parse one `corpus.md` into its passages, in file order."""
    sections: list[tuple[str, list[str]]] = []
    for raw in text.splitlines():
        heading = _HEADING.match(raw)
        if heading is not None:
            sections.append((heading.group(1).strip(), []))
        elif sections:
            # Everything before the first heading — the file's HTML comment record — falls here
            # and is dropped, which is exactly what should happen to it.
            sections[-1][1].append(raw)

    passages: list[Passage] = []
    for passage_id, body in sections:
        source_line = ""
        start = 0
        for index, raw in enumerate(body):
            match = _SOURCE_LINE.match(raw.strip())
            if match is not None:
                source_line = match.group(1)
                start = index + 1
                break
        lines = [line[2:] if line.startswith("> ") else line for line in body[start:]]
        passage_text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        if passage_text == "":
            continue
        citation, url = split_source(source_line)
        extra = (provenance or {}).get(url or "", {})
        passages.append(
            Passage(
                domain=domain,
                domain_name=domain_name,
                passage_id=passage_id,
                source=citation,
                url=url,
                sha256=extra.get("sha256") or None,
                fetched_at=extra.get("fetchedAt") or None,
                text=passage_text,
            )
        )
    return passages


def load_sources(domain_dir: Path) -> dict[str, dict[str, str]]:
    """sources.json, keyed by URL — the sha256 and fetch date a built Domain keeps for review."""
    path = domain_dir / "sources.json"
    if not path.is_file():
        return {}
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    by_url: dict[str, dict[str, str]] = {}
    for record in records if isinstance(records, list) else []:
        if isinstance(record, dict) and isinstance(record.get("url"), str):
            by_url[record["url"]] = {key: str(record.get(key, "")) for key in ("sha256", "fetchedAt")}
    return by_url


def load_passages(domains_dir: Path) -> list[Passage]:
    """Every passage of every Domain on disk, in a stable order (domain name, then file order)."""
    if not domains_dir.is_dir():
        return []
    passages: list[Passage] = []
    for domain_dir in sorted(domains_dir.iterdir()):
        corpus = domain_dir / "corpus.md"
        if not corpus.is_file():
            continue
        meta_path = domain_dir / "meta.md"
        meta = parse_meta(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
        passages.extend(
            parse_corpus(
                corpus.read_text(encoding="utf-8"),
                domain=meta.get("id", domain_dir.name),
                domain_name=meta.get("name", domain_dir.name),
                provenance=load_sources(domain_dir),
            )
        )
    return passages
