"""Vector-retrieval abstraction used by the graph-augmented fusion layer.

The platform's canonical vector store is **Qdrant** (see ai-platform README), fronted
by a ``VectorStore`` abstraction in ``backend/app/vectorstore``. The knowledge graph
does not re-embed anything; it consumes that same index through the small
``VectorIndex`` protocol below so the KG and the RAG engine stay on one source of
truth.

For local development / tests we ship ``InMemoryVectorIndex``, a cosine-similarity
index over unit vectors — no external service required.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol, Sequence, runtime_checkable


@dataclass(slots=True)
class VectorHit:
    """A single vector-retrieval result.

    ``node_id`` links the hit back into the graph when the embedded chunk is
    associated with a graph node (via ``Node.embedding_ref`` / metadata). It may be
    ``None`` for free-floating document chunks that are not yet linked to an entity.
    """

    id: str
    score: float
    text: str
    node_id: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class Embedder(Protocol):
    """Provider-agnostic embedder (OpenAI / Voyage / BGE / Nomic behind the abstraction)."""

    async def embed(self, text: str) -> list[float]: ...


@runtime_checkable
class VectorIndex(Protocol):
    """Minimal read surface the KG needs from the platform vector store."""

    async def search(
        self,
        query: str,
        *,
        top_k: int = 10,
        filters: Optional[dict[str, Any]] = None,
    ) -> list[VectorHit]:
        """Return the ``top_k`` most similar chunks for ``query`` (optionally filtered)."""
        ...


# --------------------------------------------------------------------------- #
# In-memory reference implementation (dev / tests)                            #
# --------------------------------------------------------------------------- #
def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class InMemoryVectorIndex:
    """Cosine-similarity index for local use.

    Accepts an ``Embedder``; if none is supplied it uses a deterministic hashing
    embedder so tests are reproducible without a network call.
    """

    def __init__(self, embedder: Optional[Embedder] = None, dim: int = 256) -> None:
        self._embedder = embedder or _HashingEmbedder(dim)
        self._items: list[tuple[VectorHit, list[float]]] = []

    async def add(
        self,
        *,
        id: str,
        text: str,
        node_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        vec = await self._embedder.embed(text)
        hit = VectorHit(id=id, score=0.0, text=text, node_id=node_id, metadata=metadata or {})
        self._items.append((hit, vec))

    async def search(
        self,
        query: str,
        *,
        top_k: int = 10,
        filters: Optional[dict[str, Any]] = None,
    ) -> list[VectorHit]:
        qvec = await self._embedder.embed(query)
        scored: list[VectorHit] = []
        for hit, vec in self._items:
            if filters and not _match_filters(hit.metadata, filters):
                continue
            score = _cosine(qvec, vec)
            scored.append(
                VectorHit(
                    id=hit.id,
                    score=score,
                    text=hit.text,
                    node_id=hit.node_id,
                    metadata=hit.metadata,
                )
            )
        scored.sort(key=lambda h: h.score, reverse=True)
        return scored[:top_k]


def _match_filters(meta: dict[str, Any], filters: dict[str, Any]) -> bool:
    for k, v in filters.items():
        if meta.get(k) != v:
            return False
    return True


class _HashingEmbedder:
    """Deterministic bag-of-words hashing embedder (no dependencies, reproducible)."""

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    async def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in text.lower().split():
            h = hash(tok) % self.dim
            vec[h] += 1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]


__all__ = [
    "Embedder",
    "InMemoryVectorIndex",
    "VectorHit",
    "VectorIndex",
]
