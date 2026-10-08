"""What the agent may DO — the tools, and the schemas the model chooses between.

Three for this stage, and each is a door to something that already exists and is already
trusted: the hybrid retriever, the Domain's own files, and the catalogue. Tools that WRITE
(building a Domain, signing one) are deliberately absent — building arrives with its gate in a
later stage, and signing is a human act that no tool here will ever expose.

A tool returns a JSON string: it is fed straight back to the model as the tool result, and a
result the model cannot parse is the same as no result at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ..config import Config
from ..memory import learner_brief
from ..rag.assets import parse_meta
from ..rag.rerank import POOL, RerankError, llm_rerank
from ..rag.store import Retriever
from ..telemetry import span

_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_corpus",
            "description": (
                "在已签字的教材语料里检索与该问题相关的段落，返回段落 id、出处与原文。"
                "回答任何关于知识本身的问题之前都必须先调用它；它搜不到，就说语料里没有，不要凭记忆回答。"
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "检索用的问题，用学习者提问的语言"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_catalogue",
            "description": "列出目录里已签字的教材（id 与名称）。用来知道这个平台到底能教什么。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_domain",
            "description": "读一份教材的全貌：它的边界、常见误解与期末检查题。当学习者问「这门课教什么/会考什么」时用它。",
            "parameters": {
                "type": "object",
                "properties": {"domain": {"type": "string", "description": "教材 id，如 time-zones"}},
                "required": ["domain"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall_learner",
            "description": (
                "读这位学习者自己的课堂记录：上过哪些课、问过什么（以及哪些被拒答）、"
                "课后的复习与迁移测量结果。当学习者提到「上次/以前」，或你想知道他们的薄弱点时用它。"
            ),
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "最多读几条，默认 3"}},
            },
        },
    },
]


def tool_schemas() -> list[dict]:
    """A copy, so a caller cannot edit the schemas the loop ships with."""
    return json.loads(json.dumps(_TOOL_SCHEMAS))


@dataclass
class Toolbox:
    """The tools, closed over a retriever and the assets directory."""

    retriever: Retriever
    domains_dir: Path
    rerank_config: Config | None = None
    # Where the learner's own session records live (the TypeScript platform writes them); None
    # means the memory tool answers "no records", which is the honest shape for a fresh machine.
    sessions_dir: Path | None = None

    def search_corpus(self, query: str) -> str:
        pool = self.retriever.search(query, k=POOL)
        if self.rerank_config is not None and pool:
            try:
                pool = llm_rerank(query, pool, config=self.rerank_config)
            except RerankError as error:
                # A rerank that cannot happen leaves the fused order — retrieval degrades, it
                # does not fail. The reason travels in the result so the model can weigh it.
                results = [self._hit(hit) for hit in pool[:5]]
                return json.dumps({"hits": results, "note": f"rerank skipped: {error}"}, ensure_ascii=False)
        return json.dumps({"hits": [self._hit(hit) for hit in pool[:5]]}, ensure_ascii=False)

    def list_catalogue(self) -> str:
        entries: list[dict[str, str]] = []
        if self.domains_dir.is_dir():
            for domain_dir in sorted(self.domains_dir.iterdir()):
                meta_path = domain_dir / "meta.md"
                if not (domain_dir / "corpus.md").is_file() or not meta_path.is_file():
                    continue
                meta = parse_meta(meta_path.read_text(encoding="utf-8"))
                entries.append({"id": meta.get("id", domain_dir.name), "name": meta.get("name", domain_dir.name)})
        return json.dumps({"domains": entries}, ensure_ascii=False)

    def read_domain(self, domain: str) -> str:
        directory = self.domains_dir / domain
        if not (directory / "corpus.md").is_file():
            return json.dumps({"error": f"no Domain named {domain}"}, ensure_ascii=False)
        payload: dict[str, object] = {"id": domain}
        for name, field in (("meta", "meta"), ("misconceptions", "misconceptions"), ("checks", "checks")):
            path = directory / f"{name}.md"
            if path.is_file():
                payload[field] = path.read_text(encoding="utf-8")[:4000]
        return json.dumps(payload, ensure_ascii=False)

    def run(self, name: str, arguments: dict) -> str:
        with span("tool.call", tool=name):
            if name == "search_corpus":
                query = str(arguments.get("query", "")).strip()
                if query == "":
                    return json.dumps({"error": "search_corpus needs a query"}, ensure_ascii=False)
                return self.search_corpus(query)
            if name == "list_catalogue":
                return self.list_catalogue()
            if name == "read_domain":
                return self.read_domain(str(arguments.get("domain", "")).strip())
            if name == "recall_learner":
                limit = arguments.get("limit")
                return learner_brief(self.sessions_dir, limit if isinstance(limit, int) and limit > 0 else 3)
            return json.dumps({"error": f"no tool named {name}"}, ensure_ascii=False)

    @staticmethod
    def _hit(hit) -> dict:
        return {
            "id": hit.passage.passage_id,
            "domain": hit.passage.domain,
            "source": hit.passage.source,
            "url": hit.passage.url,
            "text": hit.passage.text,
        }
