"""Deterministic, keyless, offline embedder — the always-available fallback.

Uses ``hashlib.blake2b`` rather than the builtin ``hash()``: builtin hashing is
salted per process (PYTHONHASHSEED), so vectors written by the ingestion process
would not share a space with vectors computed by the server process. blake2b is
stable across processes and machines, which is what makes a persisted corpus
reusable at all.
"""
from __future__ import annotations

import hashlib
import math

from app.embeddings.base import tokenize


class StableHashEmbedder:
    """Bag-of-words hashing embedder (offline, keyless, cross-process stable)."""

    kind = "stable-hash"
    # Floor calibrated against the real HookSwap corpus so genuinely off-topic
    # queries fall below it (honest "not in KB") while on-topic queries clear it.
    # A large `dim` keeps hash-collision noise well under this floor.
    recommended_min_score = 0.13

    def __init__(self, dim: int = 4096) -> None:
        self.dim = dim

    def _bucket(self, token: str) -> int:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "big") % self.dim

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in tokenize(text):
            vec[self._bucket(tok)] += 1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def embed_many(self, texts):  # noqa: ANN001, ANN201 - protocol-shaped
        """Local compute: batching is just a loop, but it keeps the fast path uniform."""
        return [self.embed(t) for t in texts]


__all__ = ["StableHashEmbedder"]
