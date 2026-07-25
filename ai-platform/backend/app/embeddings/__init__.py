"""Embedding provider abstraction.

Owns the ``Embedder`` contract and every provider implementation. ``app.retrieval.store``
re-exports these names, so historical imports
(``from app.retrieval.store import build_embedder, StableHashEmbedder, ...``) keep working
unchanged — the dependency runs ``retrieval -> embeddings``, never the reverse.
"""
from app.embeddings.base import (
    BatchEmbedder,
    Embedder,
    embed_texts,
    supports_batch,
    tokenize,
)
from app.embeddings.factory import build_embedder
from app.embeddings.hashing import StableHashEmbedder
from app.embeddings.openai_provider import OpenAIEmbedder
from app.embeddings.voyage import VoyageEmbedder

__all__ = [
    "BatchEmbedder",
    "Embedder",
    "OpenAIEmbedder",
    "StableHashEmbedder",
    "VoyageEmbedder",
    "build_embedder",
    "embed_texts",
    "supports_batch",
    "tokenize",
]
