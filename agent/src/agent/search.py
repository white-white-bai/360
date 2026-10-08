"""`python -m agent.search "<question>"` — the retrieval door (stage 1's acceptance).

Prints every hit with its provenance: Domain, passage id, citation and URL — the same citation a
lesson would carry through the kernel's proof. A hit without its source is not a hit; it is a
sentence.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .app import domains_dir
from .config import config_from_env
from .console import utf8_console
from .rag.assets import load_passages
from .rag.embed import embedder_from_env
from .rag.rerank import POOL, RerankError, llm_rerank
from .rag.store import Retriever


def main() -> int:
    utf8_console()
    parser = argparse.ArgumentParser(description="Hybrid retrieval over the signed Domains")
    parser.add_argument("query", help="the question, in whatever language it is asked")
    parser.add_argument("--k", type=int, default=6, help="how many hits to keep")
    parser.add_argument("--backend", choices=["auto", "local", "fake", "openai"], default="auto")
    parser.add_argument("--domains", default="", help="override the domains directory")
    parser.add_argument("--no-vector", action="store_true", help="BM25 only — needs no model at all")
    parser.add_argument("--no-rerank", action="store_true", help="keep the fused order, skip the LLM")
    args = parser.parse_args()

    directory = Path(args.domains) if args.domains else domains_dir()
    passages = load_passages(directory)
    if not passages:
        print(f"no passages under {directory}", file=sys.stderr)
        return 1

    use_vector = not args.no_vector
    embedder = embedder_from_env(backend=args.backend) if use_vector else None
    retriever = Retriever(passages, embedder, use_vector=use_vector)

    # Recall wide, then let the chat model reorder the pool and keep only k. A rerank that
    # cannot happen (no provider, a bad reply) is said out loud and the fused order stands.
    wanted = args.k if args.no_rerank else max(args.k, POOL)
    hits = retriever.search(args.query, k=wanted)
    if not args.no_rerank:
        try:
            hits = llm_rerank(args.query, hits, config=config_from_env())
        except RerankError as error:
            print(f"（重排没做成：{error}；下面是融合顺序。）", file=sys.stderr)
    hits = hits[: args.k]

    label = embedder.name if embedder is not None else "BM25 only"
    reranked = (
        "reranked（顺序是重排结果；[] 内是重排前的融合分，仅作参考）"
        if not args.no_rerank
        else "融合顺序"
    )
    print(f"{len(passages)} passages from {directory} · {label} · {reranked}")
    for rank, hit in enumerate(hits, start=1):
        ranks = []
        if hit.vector_rank is not None:
            ranks.append(f"vec #{hit.vector_rank}")
        if hit.lexical_rank is not None:
            ranks.append(f"bm25 #{hit.lexical_rank}")
        print(f"\n{rank}. [{hit.score:.4f}] {hit.passage.domain} · {hit.passage.passage_id}  ({', '.join(ranks)})")
        source = hit.passage.source + (f" — {hit.passage.url}" if hit.passage.url else "")
        print(f"   来源: {source}")
        preview = hit.passage.text.replace("\n", " ")
        print(f"   {preview[:160]}{'…' if len(preview) > 160 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
