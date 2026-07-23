"""Shared RAG grounding port for the marketing slice.

The marketing bot retrieves its grounding facts through a ``RagPort`` — a thin,
stable interface so the marketing slice and the concurrent RAG-core work
(``app.rag.engine``) compose without a hard build-order dependency.

DEPENDENCY NOTE (coordinate with the RAG-core agent):
    The RAG core (``app/main.py`` + ``app/rag/engine.py`` + ``ingestion/``) is
    being built concurrently and is not present yet. This module defines the
    contract both sides share:

        * ``GroundingFact``  — one retrieved, citable fact.
        * ``RagPort``        — ``retrieve(query, *, top_k, chain, kinds)``.

    ``get_grounding_provider()`` prefers the real engine when it appears
    (``app.rag.engine.get_rag_engine()`` or a ``RagEngine`` exposing
    ``retrieve``), adapting it to ``RagPort``. Until then it falls back to
    ``StaticFactStore`` — a keyword-scored reader over a bundled corpus of
    VERIFIED, in-repo HookSwap facts (``grounding/hookswap_facts.json``). That
    keeps FACTS-ONLY real even before the vector store exists: grounding comes
    from real sources, never the model's imagination.

    When the RAG core lands, it only needs to satisfy ``RagPort`` (or expose a
    ``retrieve`` returning objects with ``text`` + ``source``); no change here.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, Sequence, runtime_checkable

_FACTS_PATH = Path(__file__).with_name("grounding") / "hookswap_facts.json"

# Kinds of grounding a fact can carry. "address" and "fee" are the exact-match
# facts the bot may quote verbatim; live market stats are NEVER a static fact.
FactKind = str  # "brand" | "feature" | "fee" | "chain" | "address" | "stage"


@dataclass
class GroundingFact:
    """One retrieved, citable grounding fact.

    ``text`` is what the model may rely on; ``source`` is the citation shown to
    reviewers and attached to every claim. ``score`` is retrieval relevance.
    """

    text: str
    source: str
    kind: FactKind = "feature"
    chain: str | None = None
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def citation(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "source": self.source,
            "kind": self.kind,
            "chain": self.chain,
        }


@runtime_checkable
class RagPort(Protocol):
    """The retrieval contract the marketing slice depends on.

    The concurrent RAG engine can satisfy this directly (or expose a
    ``retrieve`` returning objects with ``.text`` and ``.source`` — see
    ``_EngineAdapter``).
    """

    def retrieve(
        self,
        query: str,
        *,
        top_k: int = 8,
        chain: str | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[GroundingFact]: ...


class StaticFactStore:
    """Keyword-scored reader over the bundled verified-facts corpus.

    Deterministic, dependency-free, and offline — suitable as the grounding
    source until the vector RAG engine is wired, and as the test fixture.
    """

    def __init__(self, facts_path: Path | None = None) -> None:
        self._path = facts_path or _FACTS_PATH
        self._facts: list[dict[str, Any]] = self._load()

    def _load(self) -> list[dict[str, Any]]:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return list(raw.get("facts", []))

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return re.findall(r"[a-z0-9.%$]+", text.lower())

    def retrieve(
        self,
        query: str,
        *,
        top_k: int = 8,
        chain: str | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[GroundingFact]:
        q_tokens = set(self._tokens(query))
        chain_slug = chain.lower().strip() if chain else None
        kind_set = {k.lower() for k in kinds} if kinds else None

        scored: list[tuple[float, dict[str, Any]]] = []
        for fact in self._facts:
            if kind_set and fact.get("kind", "").lower() not in kind_set:
                continue
            f_chain = fact.get("chain")
            # A chain filter keeps chain-agnostic facts (brand/fees/scope) plus
            # facts for that specific chain; it drops other chains' addresses.
            if chain_slug and f_chain and f_chain != chain_slug:
                continue

            keywords = {k.lower() for k in fact.get("keywords", [])}
            body_tokens = set(self._tokens(fact.get("text", "")))
            overlap = len(q_tokens & (keywords | body_tokens))
            score = float(overlap)
            # Nudge exact-fact kinds and the requested chain so a chain-scoped
            # announcement surfaces that chain's addresses.
            if chain_slug and f_chain == chain_slug:
                score += 1.5
            if fact.get("kind") in ("brand", "stage"):
                score += 0.25  # voice + honesty anchors are always useful
            if score > 0:
                scored.append((score, fact))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        out: list[GroundingFact] = []
        for score, fact in scored[:top_k]:
            out.append(
                GroundingFact(
                    text=fact.get("text", ""),
                    source=fact.get("source", "hookswap_facts.json"),
                    kind=fact.get("kind", "feature"),
                    chain=fact.get("chain"),
                    score=score,
                    metadata={"id": fact.get("id")},
                )
            )
        return out


class _EngineAdapter:
    """Adapts a concurrent RAG engine to ``RagPort``.

    Accepts either a real ``RagPort`` or a looser engine exposing ``retrieve``
    that returns objects/dicts carrying ``text`` and ``source`` (the shape the
    RAG-core ``RagEngine`` is expected to produce).
    """

    def __init__(self, engine: Any) -> None:
        self._engine = engine

    def retrieve(
        self,
        query: str,
        *,
        top_k: int = 8,
        chain: str | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[GroundingFact]:
        raw = self._engine.retrieve(query, top_k=top_k, chain=chain, kinds=kinds)
        facts: list[GroundingFact] = []
        for item in raw or []:
            if isinstance(item, GroundingFact):
                facts.append(item)
            elif isinstance(item, dict):
                facts.append(
                    GroundingFact(
                        text=item.get("text") or item.get("snippet", ""),
                        source=item.get("source") or item.get("source_uri", "rag"),
                        kind=item.get("kind", "feature"),
                        chain=item.get("chain"),
                        score=float(item.get("score", 0.0) or 0.0),
                        metadata=item.get("metadata", {}),
                    )
                )
            else:  # duck-typed object (SearchHit-like)
                facts.append(
                    GroundingFact(
                        text=getattr(item, "text", None) or getattr(item, "snippet", ""),
                        source=getattr(item, "source", None)
                        or getattr(item, "source_uri", "rag"),
                        kind=getattr(item, "kind", "feature"),
                        chain=getattr(item, "chain", None),
                        score=float(getattr(item, "score", 0.0) or 0.0),
                    )
                )
        return facts


def get_grounding_provider() -> RagPort:
    """Return the best available grounding provider.

    Prefers the concurrent RAG engine; falls back to the bundled static store.
    """
    try:  # pragma: no cover - exercised once the RAG core lands
        from app.rag import engine as rag_engine  # type: ignore

        factory = getattr(rag_engine, "get_rag_engine", None) or getattr(
            rag_engine, "get_engine", None
        )
        if factory is not None:
            real = factory()
            if real is not None and hasattr(real, "retrieve"):
                return _EngineAdapter(real)
    except Exception:
        # RAG core not present / not importable yet — fall back honestly.
        pass
    return StaticFactStore()
