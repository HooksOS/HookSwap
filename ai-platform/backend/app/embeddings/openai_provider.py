"""OpenAI embeddings provider.

Behaviourally identical to the implementation that previously lived inline in
``app.retrieval.store`` (same ``kind``, same floor, same lazy import), with
batching added so ingestion does not make one HTTP call per chunk.
"""
from __future__ import annotations

from typing import Any, Sequence

# OpenAI accepts large arrays; 256 keeps request bodies modest for long chunks.
MAX_BATCH = 256


class OpenAIEmbedder:
    """Real embeddings via OpenAI, wired only behind config (keyed). Optional dependency."""

    kind = "openai"
    recommended_min_score = 0.30

    def __init__(self, model: str, dim: int, api_key: str) -> None:
        self.model = model
        self.dim = dim
        self._api_key = api_key
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            from openai import OpenAI  # imported lazily so the core runs without openai

            self._client = OpenAI(api_key=self._api_key)
        return self._client

    def embed(self, text: str) -> list[float]:
        resp = self._get_client().embeddings.create(model=self.model, input=text)
        return list(resp.data[0].embedding)

    def embed_document(self, text: str) -> list[float]:
        """OpenAI embeddings are symmetric — documents and queries share one encoding."""
        return self.embed(text)

    def embed_many(self, texts: Sequence[str]) -> list[list[float]]:
        texts = list(texts)
        out: list[list[float]] = []
        for start in range(0, len(texts), MAX_BATCH):
            batch = texts[start : start + MAX_BATCH]
            resp = self._get_client().embeddings.create(model=self.model, input=batch)
            # The API may return items out of order; `index` is authoritative.
            ordered = sorted(resp.data, key=lambda d: d.index)
            out.extend(list(d.embedding) for d in ordered)
        return out


__all__ = ["MAX_BATCH", "OpenAIEmbedder"]
