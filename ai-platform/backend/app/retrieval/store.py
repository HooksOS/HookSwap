"""Retrieval store over the ingested static HookSwap corpus.

Design
------
This is the runnable, offline-first retrieval surface for the RAG core. It reuses the
knowledge-graph library's approach (``knowledge-graph/hookswap_kg/vector.py``):
cosine similarity over a bag-of-words hashing embedding, no external service required.

Why not import ``hookswap_kg._HashingEmbedder`` directly:
- It uses Python's builtin ``hash()``, which is **salted per process** (PYTHONHASHSEED).
  Ingestion and the API server run in *different processes*, so a query embedded in the
  server would live in a different vector space than the chunks embedded during ingestion
  — cosine similarity would be meaningless across the boundary.
- ``StableHashEmbedder`` below uses ``hashlib.blake2b`` so the embedding is byte-identical
  across processes and machines. The persisted corpus therefore round-trips correctly.

Pluggability: ``build_embedder(settings)`` returns the local ``StableHashEmbedder`` by
default (keyless, offline) and an ``OpenAIEmbedder`` only when
``embedding_provider == "openai"`` AND an OpenAI key is configured. The store persists to
a single JSON file so the ingestion script and the server share one source of truth.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

CORPUS_SCHEMA_VERSION = 1


# --------------------------------------------------------------------------- #
# Result type                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class Retrieved:
    """A single retrieval result carrying its citation-ready provenance."""

    id: str
    score: float
    text: str
    source_id: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def snippet(self, max_chars: int = 320) -> str:
        s = " ".join(self.text.split())
        return s if len(s) <= max_chars else s[: max_chars - 1].rstrip() + "…"

    # -- aliases consumed by app.marketing.rag_port._EngineAdapter -------------
    # The adapter duck-types `.source` / `.kind` / `.chain`; without these it
    # would fall back to the literal string "rag" as the citation source, so
    # every marketing claim would cite "rag" instead of the real document.
    @property
    def source(self) -> str:
        return self.source_id

    @property
    def kind(self) -> str:
        return str((self.metadata or {}).get("doc_type") or "feature")

    @property
    def chain(self) -> Optional[str]:
        value = (self.metadata or {}).get("chain")
        return str(value) if value else None


# --------------------------------------------------------------------------- #
# Embedders                                                                   #
# --------------------------------------------------------------------------- #
# The provider implementations moved to `app.embeddings` (which also added real
# Voyage support and batched `embed_many`). They are re-exported here unchanged so
# every historical import path keeps working:
#     from app.retrieval.store import Embedder, StableHashEmbedder, OpenAIEmbedder, build_embedder
# Dependency direction is retrieval -> embeddings; `app.embeddings` never imports
# `app.retrieval`.
from app.embeddings.base import Embedder, embed_texts, supports_batch, tokenize as _tokenize
from app.embeddings.factory import build_embedder
from app.embeddings.hashing import StableHashEmbedder
from app.embeddings.openai_provider import OpenAIEmbedder
from app.embeddings.voyage import VoyageEmbedder


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# --------------------------------------------------------------------------- #
# Corpus path resolution                                                      #
# --------------------------------------------------------------------------- #
def default_corpus_path() -> Path:
    """``<ai-platform>/data/corpus.json`` — resolved from this file, cwd-independent."""
    # store.py -> retrieval -> app -> backend -> ai-platform
    ai_platform = Path(__file__).resolve().parents[3]
    return ai_platform / "data" / "corpus.json"


def resolve_corpus_path(settings: Any | None = None) -> Path:
    if settings is not None:
        configured = getattr(settings, "corpus_path", None)
        if configured:
            return Path(configured).expanduser().resolve()
    env = os.getenv("HOOKSWAP_AI_CORPUS_PATH")
    if env:
        return Path(env).expanduser().resolve()
    return default_corpus_path()


# --------------------------------------------------------------------------- #
# Store                                                                       #
# --------------------------------------------------------------------------- #
class RetrievalStore:
    """Cosine-similarity store over embedded corpus chunks; JSON-persisted."""

    def __init__(self, embedder: Optional[Embedder] = None) -> None:
        self.embedder: Embedder = embedder or StableHashEmbedder()
        # each item: (Retrieved, vector)
        self._items: list[tuple[Retrieved, list[float]]] = []

    # -- write ------------------------------------------------------------
    def add(
        self,
        *,
        id: str,
        text: str,
        source_id: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        # Asymmetric providers (Voyage) encode stored documents differently from
        # search queries; use the document side when the embedder distinguishes them.
        embed_doc = getattr(self.embedder, "embed_document", None)
        vec = embed_doc(text) if callable(embed_doc) else self.embedder.embed(text)
        self._items.append(
            (Retrieved(id=id, score=0.0, text=text, source_id=source_id, metadata=metadata or {}), vec)
        )

    def add_many(self, records: Iterable[dict[str, Any]]) -> int:
        """Bulk-add records ``{id, text, source_id, metadata?}`` in ONE embedding pass.

        Ingestion must not make one API round-trip per chunk — the repo corpus is
        thousands of chunks, so per-chunk calls against a keyed provider are both
        unusably slow and needlessly expensive. ``embed_texts`` uses the provider's
        batch endpoint when it has one and falls back to a loop when it does not.
        """
        items = list(records)
        if not items:
            return 0
        vectors = embed_texts(self.embedder, [r["text"] for r in items])
        for rec, vec in zip(items, vectors):
            self._items.append(
                (
                    Retrieved(
                        id=rec["id"],
                        score=0.0,
                        text=rec["text"],
                        source_id=rec["source_id"],
                        metadata=rec.get("metadata") or {},
                    ),
                    list(vec),
                )
            )
        return len(items)

    def clear(self) -> None:
        self._items.clear()

    @property
    def size(self) -> int:
        return len(self._items)

    def sources(self) -> list[str]:
        seen: list[str] = []
        for hit, _ in self._items:
            if hit.source_id not in seen:
                seen.append(hit.source_id)
        return seen

    # -- read -------------------------------------------------------------
    def search(self, query: str, *, top_k: int = 8) -> list[Retrieved]:
        if not self._items:
            return []
        qv = self.embedder.embed(query)
        scored: list[Retrieved] = []
        for hit, vec in self._items:
            scored.append(
                Retrieved(
                    id=hit.id,
                    score=_cosine(qv, vec),
                    text=hit.text,
                    source_id=hit.source_id,
                    metadata=hit.metadata,
                )
            )
        scored.sort(key=lambda h: h.score, reverse=True)
        return scored[:top_k]

    # -- persistence ------------------------------------------------------
    def save(self, path: str | os.PathLike[str]) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": CORPUS_SCHEMA_VERSION,
            "embedder": {"kind": self.embedder.kind, "dim": self.embedder.dim},
            "items": [
                {
                    "id": hit.id,
                    "text": hit.text,
                    "source_id": hit.source_id,
                    "metadata": hit.metadata,
                    "vector": vec,
                }
                for hit, vec in self._items
            ],
        }
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp, p)

    @classmethod
    def load(cls, path: str | os.PathLike[str], embedder: Optional[Embedder] = None) -> "RetrievalStore":
        p = Path(path)
        data = json.loads(p.read_text(encoding="utf-8"))
        meta = data.get("embedder", {})
        file_dim = int(meta.get("dim", 4096))
        emb = embedder
        if emb is None:
            emb = StableHashEmbedder(dim=file_dim)
        elif isinstance(emb, StableHashEmbedder) and emb.dim != file_dim:
            # query vectors must live in the SAME space as the stored ones — the
            # corpus file is authoritative for the hashing embedder's dimension.
            emb = StableHashEmbedder(dim=file_dim)
        store = cls(embedder=emb)
        for it in data.get("items", []):
            store._items.append(
                (
                    Retrieved(
                        id=it["id"],
                        score=0.0,
                        text=it["text"],
                        source_id=it["source_id"],
                        metadata=it.get("metadata", {}),
                    ),
                    list(it["vector"]),
                )
            )
        return store

    @classmethod
    def load_if_exists(
        cls, path: str | os.PathLike[str], embedder: Optional[Embedder] = None
    ) -> Optional["RetrievalStore"]:
        return cls.load(path, embedder=embedder) if Path(path).exists() else None


__all__ = [
    "CORPUS_SCHEMA_VERSION",
    "Embedder",
    "OpenAIEmbedder",
    "Retrieved",
    "RetrievalStore",
    "StableHashEmbedder",
    "VoyageEmbedder",
    "build_embedder",
    "default_corpus_path",
    "embed_texts",
    "resolve_corpus_path",
    "supports_batch",
]
