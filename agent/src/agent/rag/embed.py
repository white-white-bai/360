"""Embedders: one interface, three implementations.

The provider this project uses has no `/embeddings` route — checked against its live catalogue,
not assumed — so the default real backend is LOCAL: fastembed's ONNX multilingual model, no API
key, no network after the first download. The OpenAI-compatible backend exists for whoever has
such an endpoint, and the fake one exists so every path above it is testable without a model.
"""

from __future__ import annotations

import hashlib
import os
from typing import Mapping, Protocol, Sequence

from .tokens import tokenize


class Embedder(Protocol):
    """Vectors for texts. The dimension is whatever the implementation returns — nobody hardcodes it."""

    name: str

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


def _stable_bucket(token: str, buckets: int) -> int:
    """A hash that survives process restarts; Python's own `hash()` does not."""
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=4).digest()
    return int.from_bytes(digest, "big") % buckets


class FakeEmbedder:
    """Deterministic, offline, and NOT semantic.

    A hashed bag of words projected into `dim` floats: exactly as smart as BM25 and no smarter.
    It keeps index, fusion and provenance testable offline, and it cannot be mistaken for a real
    embedder because a cross-lingual query fails on it loudly and immediately.
    """

    def __init__(self, dim: int = 64) -> None:
        self.name = f"fake-{dim}"
        self.dim = dim

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            vector = [0.0] * self.dim
            for token in tokenize(text):
                vector[_stable_bucket(token, self.dim)] += 1.0
            norm = sum(value * value for value in vector) ** 0.5
            vectors.append([value / norm for value in vector] if norm > 0 else vector)
        return vectors


class LocalEmbedder:
    """fastembed (ONNX): the real semantic backend for a machine with no embeddings API."""

    DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    def __init__(self, model_name: str | None = None) -> None:
        from fastembed import TextEmbedding  # imported here: a machine that never embeds locally pays nothing

        self.name = model_name or self.DEFAULT_MODEL
        self._model = TextEmbedding(model_name=self.name)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(value) for value in vector] for vector in self._model.embed(list(texts))]


class OpenAiEmbedder:
    """An OpenAI-compatible `/embeddings` route, for whoever has one."""

    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 60.0) -> None:
        self.name = f"{model} at {base_url}"
        self._url = f"{base_url.rstrip('/')}/embeddings"
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        import httpx

        response = httpx.post(
            self._url,
            headers={"authorization": f"Bearer {self._api_key}"},
            json={"model": self._model, "input": list(texts)},
            timeout=self._timeout,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"embeddings endpoint returned HTTP {response.status_code}: {response.text[:200]}"
            )
        data = response.json().get("data", [])
        return [[float(value) for value in item.get("embedding", [])] for item in data]


def embedder_from_env(
    env: Mapping[str, str] | None = None, backend: str | None = None
) -> Embedder:
    """Pick the embedder the way the rest of the service picks configuration.

    `auto` (the default): an explicit embeddings endpoint wins; otherwise the local model — the
    honest choice while the configured provider has no embeddings route.
    """
    source = os.environ if env is None else env
    chosen = (backend or source.get("ATP_EMBED_BACKEND") or "auto").strip().lower()

    if chosen == "fake":
        return FakeEmbedder()
    if chosen == "openai":
        return _openai_from_env(source)
    if chosen == "local":
        return LocalEmbedder((source.get("ATP_EMBED_MODEL") or "").strip() or None)
    if (source.get("ATP_EMBED_BASE_URL") or "").strip():
        return _openai_from_env(source)
    return LocalEmbedder((source.get("ATP_EMBED_MODEL") or "").strip() or None)


def _openai_from_env(source: Mapping[str, str]) -> OpenAiEmbedder:
    base_url = (source.get("ATP_EMBED_BASE_URL") or "").strip()
    if base_url == "":
        raise RuntimeError("ATP_EMBED_BASE_URL is required for the openai embedder backend")
    api_key = (source.get("ATP_EMBED_API_KEY") or source.get("ATP_API_KEY") or "").strip()
    model = (source.get("ATP_EMBED_MODEL") or "").strip() or "text-embedding-3-small"
    return OpenAiEmbedder(base_url, api_key, model)
