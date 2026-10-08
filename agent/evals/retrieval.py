"""The golden queries, run by hand: `python evals/retrieval.py`.

Stage 1's acceptance (the plan): each query must place its target passage in the top K. This is
not a pytest because it needs the real local model — a download on first use. The unit tests pin
the machinery with the fake embedder; this script tells the truth about retrieval quality on the
machine it runs on, and fails loudly rather than quietly skipping.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent.app import domains_dir  # noqa: E402
from agent.config import config_from_env  # noqa: E402
from agent.rag.assets import load_passages  # noqa: E402
from agent.rag.embed import embedder_from_env  # noqa: E402
from agent.rag.rerank import POOL, RerankError, llm_rerank  # noqa: E402
from agent.rag.store import Retriever  # noqa: E402

# (question, acceptable passages, within top K).
#
# Several ids can carry the same statement, and that is the catalogue's own shape, not a bug:
# the built Domains drew on overlapping public sources, so agent-app-dev-core and
# agent-dev-essentials both hold the MCP tool-descriptions quote, under different ids. The
# acceptance is "the claim is found with a citation" — not "this one file wins".
GOLDEN: list[tuple[str, tuple[str, ...], int]] = [
    ("偏移量是怎么算出来的，正负号是什么意思", ("P-offset-is-signed",), 3),
    ("为什么时区会出现缺口和时间重叠", ("P-gap-and-overlap",), 3),
    ("MCP 的工具描述可以直接相信吗", ("P-mcp-untrusted-annotations", "mcp-tool-descriptions-untrusted"), 3),
    ("ReAct 和思维链在论文里是什么关系", ("P-react-separate-topics",), 5),
    ("JSON Schema 的关键词是干什么的", ("P-jsonschema-keywords",), 3),
]


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Golden retrieval acceptance")
    parser.add_argument("--no-rerank", action="store_true", help="score the hybrid alone")
    args = parser.parse_args()

    directory = domains_dir()
    passages = load_passages(directory)
    if not passages:
        print(f"no passages under {directory}")
        return 1

    embedder = embedder_from_env()
    retriever = Retriever(passages, embedder)
    rerank_config = None if args.no_rerank else config_from_env()
    print(
        f"{len(passages)} passages · embedder {embedder.name} · "
        f"rerank {'off' if args.no_rerank else ('on' if rerank_config else 'requested but no provider')}\n"
    )

    missed = 0
    for question, accepted, top in GOLDEN:
        hits = retriever.search(question, k=top if args.no_rerank else max(top, POOL))
        if not args.no_rerank:
            try:
                hits = llm_rerank(question, hits, config=rerank_config)
            except RerankError as error:
                print(f"（rerank failed: {error}）")
        hits = hits[:top]
        rank = next(
            (index for index, hit in enumerate(hits, start=1) if hit.passage.passage_id in accepted),
            None,
        )
        mark = f"hit #{rank}" if rank is not None else "MISS"
        if rank is None:
            missed += 1
        got = ", ".join(hit.passage.passage_id for hit in hits)
        print(f"{mark:8} top-{top}  {question}")
        print(f"         wanted {' | '.join(accepted)} · got: {got}")

    total = len(GOLDEN)
    print(f"\nhits@K: {total - missed}/{total}")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
