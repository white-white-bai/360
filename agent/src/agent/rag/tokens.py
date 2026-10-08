"""One tokenizer for both halves of the hybrid.

BM25 and the fake embedder must see the same words, or a test would be verifying a different
tokenization than the one that runs. Latin runs are words; CJK has no spaces, so a run of Han
characters becomes its character bigrams (the standard cheap n-gram trick) — which keeps 偏移量
matchable inside 偏移量的 without a segmentation dictionary.
"""

from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")


def tokenize(text: str) -> list[str]:
    lowered = text.lower()
    tokens = _WORD.findall(lowered)
    for run in _HAN.findall(lowered):
        if len(run) == 1:
            tokens.append(run)
        else:
            tokens.extend(run[index : index + 2] for index in range(len(run) - 1))
    return tokens
