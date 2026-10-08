"""Hybrid retrieval: FAISS for meaning, BM25 for words, RRF to fuse the two rankings.

Why both, in THIS corpus specifically: the learner asks in Chinese while the signed Domains
quote mostly-English specifications, so lexical search alone cannot match 偏移量 to "offset";
and dense search alone drowns the exact identifiers — passage ids, RFC numbers, protocol names —
that a learner may quote verbatim. RRF is the fusion because the two halves produce scores on
incomparable scales, and ranks need no calibration between them.

A half that has NO signal gets no vote. This was learned the hard way: with a Chinese query over
English passages, BM25 scores every passage zero, `sorted` then degrades to file order, and RRF
over that arbitrary ranking drowns the half that actually matched — the best semantic hit (cosine
0.71) lost to noise that happened to rank well on both meaningless lists. So the words half
abstains when the corpus contains none of the query's words, and the vectors half drops
similarities that are not positive. A ranking of zeros is not an opinion.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .assets import Passage
from .embed import Embedder
from .tokens import tokenize

# 60: the constant from the RRF paper, and the one every implementation copies. It decides how
# quickly a first place decays; changing it changes what "both halves agreed" is worth.
_RRF_K = 60


@dataclass(frozen=True)
class Hit:
    passage: Passage
    score: float
    vector_rank: int | None
    lexical_rank: int | None


class Retriever:
    """Built once per (passages, embedder); queried many times.

    A half can be switched off (`use_vector=False` needs no model at all) — which is how the
    lexical path stays testable and how a machine without the local model still retrieves.
    """

    def __init__(
        self,
        passages: Sequence[Passage],
        embedder: Embedder | None,
        *,
        use_vector: bool = True,
        use_lexical: bool = True,
    ) -> None:
        if not passages:
            raise ValueError("no passages to retrieve from — check the domains directory")
        self.passages = list(passages)

        self._bm25 = None
        if use_lexical:
            from rank_bm25 import BM25Okapi

            tokenized = [tokenize(passage.text) or [""] for passage in self.passages]
            self._bm25 = BM25Okapi(tokenized)

        self._faiss = None
        self._index = None
        self._embedder = embedder
        if use_vector:
            if embedder is None:
                raise ValueError("use_vector=True needs an embedder")
            import faiss
            import numpy as np

            vectors = np.asarray(embedder.embed([p.text for p in self.passages]), dtype="float32")
            if vectors.ndim != 2 or vectors.shape[0] != len(self.passages) or vectors.shape[1] == 0:
                raise ValueError(f"the embedder returned {vectors.shape}, not one non-empty vector per passage")
            faiss.normalize_L2(vectors)  # inner product on unit vectors is cosine
            index = faiss.IndexFlatIP(vectors.shape[1])
            index.add(vectors)
            self._faiss = faiss
            self._index = index
            self._np = np

    def search(self, query: str, *, k: int = 6, pool: int = 20) -> list[Hit]:
        """Both halves rank a pool; RRF fuses the ranks; the top k keep their provenance."""
        lists: dict[str, list[int]] = {}

        if self._index is not None and self._embedder is not None:
            vector = self._np.asarray(self._embedder.embed([query]), dtype="float32")
            self._faiss.normalize_L2(vector)
            scores, neighbours = self._index.search(vector, min(pool, len(self.passages)))
            # A zero or negative cosine is not a weaker hit; it is not a hit. Letting ties at
            # zero vote would hand arbitrary index order the weight of a real ranking.
            lists["vector"] = [
                int(index)
                for score, index in zip(scores[0], neighbours[0])
                if score > 0 and 0 <= index < len(self.passages)
            ]

        if self._bm25 is not None:
            tokens = tokenize(query) or [""]
            # The words half abstains when the corpus contains NONE of the query's words — which
            # is the case that used to hurt: BM25 scores every passage zero, sorting degrades to
            # file order, and that arbitrary ranking then outweighed the half that did match.
            if any(token in self._bm25.idf for token in tokens):
                scores = self._bm25.get_scores(tokens)
                ranked = sorted(range(len(self.passages)), key=lambda index: -float(scores[index]))
                lists["lexical"] = ranked[:pool]
            # else: nothing to read the question with, so nothing to say.

        fused: dict[int, float] = {}
        ranks: dict[int, dict[str, int]] = {}
        for name, order in lists.items():
            for rank, index in enumerate(order):
                fused[index] = fused.get(index, 0.0) + 1.0 / (_RRF_K + rank + 1)
                ranks.setdefault(index, {})[name] = rank + 1

        ordered = sorted(fused, key=lambda index: (-fused[index], index))
        return [
            Hit(
                passage=self.passages[index],
                score=fused[index],
                vector_rank=ranks[index].get("vector"),
                lexical_rank=ranks[index].get("lexical"),
            )
            for index in ordered[:k]
        ]
