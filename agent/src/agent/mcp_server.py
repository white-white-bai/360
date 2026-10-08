"""`python -m agent.mcp_server` — the platform's doors, over the Model Context Protocol.

What is exposed: search, the catalogue, a Domain in full, a draft's material, the validator's
verdict on a draft, and the builder. What is NOT exposed, deliberately: anything that SIGNS.
ADR 0006/0010 make the signature a human act — this protocol may prepare material for a person,
and must never be able to be the person.

The validator is not reimplemented here either: `validate_draft` shells the platform's own
`validate-draft` entry, because two implementations of one rule diverge and then which one the
signature gate consults becomes a coin toss.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from fastmcp import FastMCP

from .app import DEFAULT_DOMAINS_DIR, domains_dir
from .config import config_from_env
from .rag.assets import load_passages
from .rag.embed import embedder_from_env
from .rag.store import Retriever
from .tools import Toolbox

REPO_ROOT = DEFAULT_DOMAINS_DIR.parent
PLATFORM_DIR = REPO_ROOT / "platform"
DRAFTS_DIR = REPO_ROOT / "domains-draft"

mcp = FastMCP("agent-teaching-platform")


@lru_cache(maxsize=1)
def _toolbox() -> Toolbox:
    """Built on the first search, not on import: listing tools must not load a model."""
    config = config_from_env()
    retriever = Retriever(load_passages(domains_dir()), embedder_from_env())
    return Toolbox(retriever=retriever, domains_dir=domains_dir(), rerank_config=config)


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("node is not on PATH — the platform's validator needs it")
    return node


def _safe_id(value: str) -> str:
    """A draft id reaching the filesystem is a boundary; the platform's store refuses the same ids."""
    candidate = value.strip()
    if candidate == "" or any(part in candidate for part in ("/", "\\", "..")):
        raise ValueError(f"unsafe draft id {value!r}")
    return candidate


@mcp.tool
def search_corpus(query: str) -> str:
    """在已签字的教材语料里检索与该问题相关的段落。每个结果带 id、来源与 URL——回答任何知识问题都应先调用它。"""
    return _toolbox().search_corpus(query)


@mcp.tool
def list_domains() -> str:
    """列出目录里已签字的教材（id 与名称）。"""
    return _toolbox().list_catalogue()


@mcp.tool
def read_domain(domain: str) -> str:
    """读一份教材的全貌：边界、常见误解与期末检查题。"""
    return _toolbox().read_domain(domain)


@mcp.tool
def describe_draft(draft_id: str) -> str:
    """读一份等签字草稿的材料：meta、语料段落、来源与校验基线——只读，签不签由人决定。"""
    directory = DRAFTS_DIR / _safe_id(draft_id)
    if not directory.is_dir():
        return json.dumps({"error": f"no draft named {draft_id}"}, ensure_ascii=False)
    payload: dict[str, object] = {"id": draft_id}
    for name in ("meta", "corpus", "misconceptions", "checks"):
        path = directory / f"{name}.md"
        if path.is_file():
            payload[name] = path.read_text(encoding="utf-8")
    sources_path = directory / "sources.json"
    if sources_path.is_file():
        try:
            records = json.loads(sources_path.read_text(encoding="utf-8"))
            payload["sources"] = [
                {"url": item.get("url"), "fetchedAt": item.get("fetchedAt"), "sha256": item.get("sha256")}
                for item in records
                if isinstance(item, dict)
            ]
        except json.JSONDecodeError:
            payload["sources"] = "(sources.json could not be parsed)"
    return json.dumps(payload, ensure_ascii=False)


@mcp.tool
def validate_draft(draft_id: str) -> str:
    """用平台自己的校验器检查一份草稿（同一套规则，签字闸门用的就是它）。返回 JSON。"""
    directory = DRAFTS_DIR / _safe_id(draft_id)
    if not directory.is_dir():
        return json.dumps({"error": f"no draft named {draft_id}"}, ensure_ascii=False)
    result = subprocess.run(
        [_node(), "src/validate/run-validate-draft.ts", str(directory)],
        cwd=str(PLATFORM_DIR),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0 and result.stdout.strip() == "":
        return json.dumps({"error": result.stderr.strip()[:500] or "validator failed"}, ensure_ascii=False)
    return result.stdout.strip()


@mcp.tool
def build_domain(topic: str) -> str:
    """从公开来源现做一份教材草稿（需要 provider，可能几分钟）。它只写草稿：签字必须由人在平台上做。"""
    npm = shutil.which("npm")
    if npm is None:
        return json.dumps({"error": "npm is not on PATH"}, ensure_ascii=False)
    result = subprocess.run(
        [npm, "run", "build-domain", "--", topic],
        cwd=str(PLATFORM_DIR),
        capture_output=True,
        text=True,
        timeout=900,
    )
    tail = (result.stdout + "\n" + result.stderr).strip()[-1500:]
    return json.dumps({"ok": result.returncode == 0, "output": tail}, ensure_ascii=False)


if __name__ == "__main__":
    mcp.run()
