"""Recall, then reorder: the hybrid's pool is reordered by the chat model.

This is the knowledge system's 召回重排序 and the plan's stage-1 lever. Why it exists here, in
numbers: on this corpus the hybrid's top-3 missed the right passage on 2 of 5 golden queries —
the target sat at rank 9 and rank 15, INSIDE a generous pool and outside any k worth returning.
A model that reads the question and the candidates fixes exactly that class of miss; nothing
here can fix a target outside the pool, which is why the pool is wide and the hybrid owns recall.

Failure policy: any error, or a reply that names no candidate, returns the original order — a
reranker that breaks retrieval is worse than no reranker.
"""

from __future__ import annotations

import re

import httpx

from ..config import Config
from .store import Hit

# Wider than any k a caller asks for: recall is the hybrid's job, ranking is this one's.
POOL = 20

_PROMPT = """你在为一个学习者做检索重排。给定一个问题与一批候选段落，按「该段落能否直接回答这个问题」从最相关到最不相关排序。

只输出一个 JSON 数组，元素是候选段落的完整 id（例如 "P-offset-is-signed"），从最相关到最不相关，不要输出任何其它内容。

# 问题
{query}

# 候选段落
{candidates}
"""

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-_.]*")


class RerankError(RuntimeError):
    """The rerank could not happen — the caller keeps the fused order and says why."""


def parse_order(reply: str, hits: list[Hit]) -> list[Hit]:
    """The reordering a reply asks for; anything it does not mention keeps its relative order."""
    by_id = {hit.passage.passage_id: hit for hit in hits}
    seen: set[str] = set()
    ranked: list[Hit] = []
    for name in _ID.findall(reply):
        if name in by_id and name not in seen:
            seen.add(name)
            ranked.append(by_id[name])
    ranked.extend(hit for hit in hits if hit.passage.passage_id not in seen)
    return ranked


def llm_rerank(
    query: str,
    hits: list[Hit],
    *,
    config: Config | None,
    # 120s, the same default the platform's provider uses: one call carries the whole pool, and a
    # flash model reading twenty passages is not a four-second job.
    timeout: float = 120.0,
) -> list[Hit]:
    """Reorder `hits` by the chat model's judgment, in one call.

    The configuration is the caller's to resolve and pass — deliberately not resolved here,
    because a default that reads the environment turns "no provider" into a live call nobody
    asked for, and makes the refusal path untestable without spending money.
    """
    if len(hits) <= 1:
        return hits
    if config is None:
        raise RerankError("no provider is configured to rerank with")

    candidates = "\n\n".join(f"[{hit.passage.passage_id}]\n{hit.passage.text}" for hit in hits)
    try:
        response = httpx.post(
            config.chat_url,
            headers={**config.auth_headers(), "content-type": "application/json"},
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": _PROMPT.format(query=query, candidates=candidates)}],
                "temperature": 0,
            },
            timeout=timeout,
        )
    except httpx.RequestError as error:
        raise RerankError(f"reranker unreachable: {error}") from error

    if response.status_code != 200:
        raise RerankError(f"reranker returned HTTP {response.status_code}: {response.text[:200]}")
    try:
        reply = response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as error:
        raise RerankError(f"reranker reply was not a completion: {response.text[:200]}") from error

    return parse_order(reply, hits)
