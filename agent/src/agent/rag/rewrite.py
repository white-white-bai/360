"""Ask the model for better search queries before asking the corpus — 召回优化, and the plan's
measured lever.

Why rewrite at all: a learner's question is written to be ANSWERED, not to be searched ("夏令时
为什么有缺口"), and the corpus is written in a different register ("A gap exists when clocks move
forward over a local time").

MEASURED, not assumed. On the golden set (`evals/retrieval.py`), rewrite on and off both give
hits@K 5/5 with the same four first places — the ReAct case even ranks one worse with rewrites —
at the cost of one extra call per search. So the default is OFF, the mechanism stays, and
`--rewrite` turns it on: a lever that does not move the number it was built for stays down until
a corpus arrives where it does.

Failure policy: any error returns the original question alone, exactly like the rerank. A reply
that is not a JSON array is treated as an error, not as a query nobody wrote.
"""

from __future__ import annotations

import json
import re

import httpx

from ..config import Config

# The original plus two reformulations: a fourth is a different search, not more of this one.
MAX_QUERIES = 3

_PROMPT = """你在为一个检索系统改写查询。给定学习者的问题，给出最多 2 条不同措辞的检索查询，用来在教材语料里找到相关段落。语料以英文原始文档为主，专有名词可以保留英文。

只输出一个 JSON 数组，元素是查询字符串，不要输出其它内容。

# 学习者的问题
{question}
"""


class RewriteError(RuntimeError):
    """The rewrite could not happen — the caller searches the original and says why."""


def parse_queries(reply: str, question: str) -> list[str]:
    """The queries a reply asks for: the original always first, nothing invented, at most three."""
    text = reply.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]

    candidates: list[str] = []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            candidates = [item for item in parsed if isinstance(item, str)]
        else:
            candidates = []
    except json.JSONDecodeError:
        candidates = []

    queries = [question]
    for candidate in candidates:
        cleaned = re.sub(r"\s+", " ", candidate).strip()
        if cleaned != "" and cleaned not in queries:
            queries.append(cleaned)
        if len(queries) >= MAX_QUERIES:
            break
    return queries


def rewrite_query(question: str, *, config: Config | None, timeout: float = 60.0) -> list[str]:
    """One call, up to three queries. The configuration is the caller's to resolve and pass —
    a default that reads the environment turns "no provider" into a live call nobody asked for."""
    if config is None:
        raise RewriteError("no provider is configured to rewrite with")
    try:
        response = httpx.post(
            config.chat_url,
            headers={**config.auth_headers(), "content-type": "application/json"},
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": _PROMPT.format(question=question)}],
                "temperature": 0,
            },
            timeout=timeout,
        )
    except httpx.RequestError as error:
        raise RewriteError(f"rewriter unreachable: {error}") from error

    if response.status_code != 200:
        raise RewriteError(f"rewriter returned HTTP {response.status_code}: {response.text[:200]}")
    try:
        reply = response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as error:
        raise RewriteError(f"rewriter reply was not a completion: {response.text[:200]}") from error

    return parse_queries(reply, question)
