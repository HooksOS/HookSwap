"""Embedder protocols and shared helpers.

The sync, single-text ``Embedder`` protocol is the one the retrieval layer has
always spoken (``app.retrieval.store`` call sites: ``store.add`` -> ``embed(text)``,
``store.search`` -> ``embed(query)``, and ``save`` -> ``embedder.kind`` / ``.dim``).
It is reproduced here verbatim so this package owns the contract without changing
a single existing caller.

``BatchEmbedder`` adds the piece that was missing: ``embed_many``. Ingesting the
HookSwap corpus one chunk per HTTP round-trip is unusable on a keyed provider —
the repo corpus is thousands of chunks, so per-chunk calls mean thousands of
requests. Providers that support batching implement ``embed_many``; callers that
do not care can keep using ``embed``.

``recommended_min_score`` is the relevance floor the RAG engine uses to decide
"grounded vs not in KB" (``rag.engine._relevant``). It is per-embedder because the
cosine distributions differ wildly: bag-of-words hashing produces low similarities
for genuinely related text, while a trained model puts related text much higher.
Setting one global floor would either let noise through on one and starve the other.
"""
from __future__ import annotations

from typing import Protocol, Sequence, runtime_checkable


@runtime_checkable
class Embedder(Protocol):
    """Sync, single-text embedding contract (the historical retrieval contract)."""

    kind: str
    dim: int
    recommended_min_score: float

    def embed(self, text: str) -> list[float]: ...


@runtime_checkable
class BatchEmbedder(Embedder, Protocol):
    """An ``Embedder`` that can embed many texts per call (one API round-trip)."""

    def embed_many(self, texts: Sequence[str]) -> list[list[float]]: ...


def supports_batch(embedder: object) -> bool:
    """True when ``embedder`` can embed a list in one call.

    Used by ingestion to pick the fast path without forcing every provider to
    implement batching.
    """
    return callable(getattr(embedder, "embed_many", None))


def embed_texts(embedder: object, texts: Sequence[str]) -> list[list[float]]:
    """Embed ``texts`` using the batch path when available, else one at a time.

    Single funnel so ingestion and any future bulk path get batching automatically
    from whichever provider is configured.
    """
    if supports_batch(embedder):
        return list(embedder.embed_many(texts))  # type: ignore[attr-defined]
    return [embedder.embed(t) for t in texts]  # type: ignore[attr-defined]


def tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric+underscore tokenizer.

    Shared by the hashing embedder. Kept here (not imported from
    ``app.retrieval.store``) so ``app.embeddings`` has no dependency on
    ``app.retrieval`` — the dependency runs the other way.
    """
    out: list[str] = []
    tok: list[str] = []
    for ch in text.lower():
        if ch.isalnum() or ch == "_":
            tok.append(ch)
        else:
            if tok:
                out.append("".join(tok))
                tok = []
    if tok:
        out.append("".join(tok))
    return out


__all__ = ["BatchEmbedder", "Embedder", "embed_texts", "supports_batch", "tokenize"]
