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

import hashlib
import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Protocol, runtime_checkable

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


# --------------------------------------------------------------------------- #
# Embedders                                                                   #
# --------------------------------------------------------------------------- #
@runtime_checkable
class Embedder(Protocol):
    kind: str
    dim: int
    recommended_min_score: float

    def embed(self, text: str) -> list[float]: ...


class StableHashEmbedder:
    """Deterministic bag-of-words hashing embedder (offline, keyless, cross-process).

    Mirrors ``hookswap_kg._HashingEmbedder`` but uses ``hashlib.blake2b`` instead of the
    process-salted builtin ``hash()`` so ingested vectors and query vectors share one space.
    """

    kind = "stable-hash"
    # Floor calibrated against the real HookSwap corpus so genuinely off-topic queries
    # fall below it (hit the honest "not in KB" path) while on-topic queries clear it.
    # Larger `dim` keeps hash-collision noise well under this floor.
    recommended_min_score = 0.13

    def __init__(self, dim: int = 4096) -> None:
        self.dim = dim

    def _bucket(self, token: str) -> int:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "big") % self.dim

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in _tokenize(text):
            vec[self._bucket(tok)] += 1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]


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


def build_embedder(settings: Any) -> Embedder:
    """Pick the embedder from config. Local stable-hash default keeps the core keyless.

    OpenAI is used only when explicitly selected *and* a key is present; otherwise we fall
    back to the offline embedder rather than crash (facts-only, never silently broken).
    """
    provider = getattr(settings, "embedding_provider", "openai")
    openai_key = getattr(settings, "openai_api_key", None) or os.getenv("OPENAI_API_KEY")
    if provider == "openai" and openai_key:
        return OpenAIEmbedder(
            model=getattr(settings, "embedding_model", "text-embedding-3-large"),
            dim=int(getattr(settings, "embedding_dim", 3072)),
            api_key=openai_key,
        )
    return StableHashEmbedder()


def _tokenize(text: str) -> list[str]:
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
        vec = self.embedder.embed(text)
        self._items.append(
            (Retrieved(id=id, score=0.0, text=text, source_id=source_id, metadata=metadata or {}), vec)
        )

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
    "build_embedder",
    "default_corpus_path",
    "resolve_corpus_path",
]
