"""Retrieval layer for the HookSwap RAG core.

A thin, dependency-light store over the ingested static HookSwap corpus. It mirrors
the knowledge-graph library's ``InMemoryVectorIndex`` + hashing-embedder pattern
(``knowledge-graph/hookswap_kg/vector.py``) so the RAG core runs fully offline, and
is pluggable to Qdrant / OpenAI embeddings behind config flags for production.
"""

from app.retrieval.store import (
    Embedder,
    OpenAIEmbedder,
    Retrieved,
    RetrievalStore,
    StableHashEmbedder,
    build_embedder,
    default_corpus_path,
)

__all__ = [
    "Embedder",
    "OpenAIEmbedder",
    "Retrieved",
    "RetrievalStore",
    "StableHashEmbedder",
    "build_embedder",
    "default_corpus_path",
]
