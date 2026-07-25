"""Tests for the marketing <-> RAG bridge.

``app.marketing.rag_port.get_grounding_provider()`` has always probed
``app.rag.engine`` for a ``get_rag_engine``/``get_engine`` factory. That factory did
not exist, so the probe silently failed and the X marketing bot was permanently
pinned to ``StaticFactStore`` — grounded on a small bundled JSON instead of the
ingested corpus, with no error anywhere. These tests pin the contract so it cannot
silently regress again.
"""
from __future__ import annotations

import pytest

from app.marketing.rag_port import GroundingFact, StaticFactStore, get_grounding_provider
from app.rag import engine as rag_engine
from app.rag.engine import RagEngine, get_rag_engine, reset_rag_engine
from app.retrieval.store import RetrievalStore, StableHashEmbedder


@pytest.fixture(autouse=True)
def _clear_engine_cache():
    reset_rag_engine()
    yield
    reset_rag_engine()


def _store_with_facts() -> RetrievalStore:
    s = RetrievalStore(embedder=StableHashEmbedder(dim=512))
    s.add_many(
        [
            {
                "id": "rh",
                "text": "Robinhood Chain has chain id 4663 and the HookSwap v2 router "
                        "is deployed at 0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA.",
                "source_id": "contracts/deployments/robinhood.json",
                "metadata": {"doc_type": "deployment", "chain": "robinhood"},
            },
            {
                "id": "hype",
                "text": "HyperEVM has chain id 999 and its wrapped native token is WHYPE.",
                "source_id": "contracts/deployments/hyperevm.json",
                "metadata": {"doc_type": "deployment", "chain": "hyperevm"},
            },
            {
                "id": "fee",
                "text": "HookSwap charges a 0.3% interface fee on swaps.",
                "source_id": "docs/fees.md",
                "metadata": {"doc_type": "doc"},
            },
        ]
    )
    return s


# --------------------------------------------------------------------------- #
# The factory                                                                 #
# --------------------------------------------------------------------------- #
def test_get_rag_engine_returns_none_on_empty_corpus(monkeypatch):
    """An empty engine would satisfy the probe and then ground NOTHING.

    That is strictly worse than the static store, so the factory must decline.
    """
    monkeypatch.setattr(
        RagEngine, "from_settings",
        classmethod(lambda cls, settings=None: cls(RetrievalStore(embedder=StableHashEmbedder(dim=64)))),
    )
    assert get_rag_engine() is None


def test_get_rag_engine_returns_engine_when_corpus_present(monkeypatch):
    monkeypatch.setattr(
        RagEngine, "from_settings",
        classmethod(lambda cls, settings=None: cls(_store_with_facts())),
    )
    eng = get_rag_engine()
    assert eng is not None and eng.store.size == 3


def test_get_rag_engine_never_raises(monkeypatch):
    """Grounding lookup must not be able to break a caller."""
    def _boom(cls, settings=None):
        raise RuntimeError("corrupt corpus")

    monkeypatch.setattr(RagEngine, "from_settings", classmethod(_boom))
    assert get_rag_engine() is None


def test_engine_is_cached_then_resettable(monkeypatch):
    calls = {"n": 0}

    def _make(cls, settings=None):
        calls["n"] += 1
        return cls(_store_with_facts())

    monkeypatch.setattr(RagEngine, "from_settings", classmethod(_make))
    get_rag_engine(); get_rag_engine()
    assert calls["n"] == 1, "corpus JSON must be parsed once, not per call"
    reset_rag_engine()
    get_rag_engine()
    assert calls["n"] == 2


# --------------------------------------------------------------------------- #
# retrieve() must accept the RagPort kwargs                                   #
# --------------------------------------------------------------------------- #
def test_retrieve_accepts_chain_and_kinds_kwargs():
    """_EngineAdapter calls retrieve(query, top_k=, chain=, kinds=) positionally-free.

    Before this, RagEngine.retrieve only took top_k, so the adapter raised TypeError.
    """
    eng = RagEngine(_store_with_facts())
    hits = eng.retrieve("chain id", top_k=3, chain=None, kinds=None)
    assert hits


def test_chain_filter_drops_other_chains_but_keeps_agnostic_facts():
    eng = RagEngine(_store_with_facts())
    hits = eng.retrieve("chain id and fees", top_k=8, chain="robinhood")
    chains = {h.chain for h in hits}
    assert "hyperevm" not in chains, "another chain's addresses must not leak into a scoped post"
    # chain-agnostic grounding (brand/fee/scope) must survive the filter
    assert None in chains or any(h.metadata.get("doc_type") == "doc" for h in hits)


def test_kinds_filter_selects_doc_type():
    eng = RagEngine(_store_with_facts())
    hits = eng.retrieve("router address", top_k=8, kinds=["deployment"])
    assert hits and all(h.metadata.get("doc_type") == "deployment" for h in hits)


# --------------------------------------------------------------------------- #
# End-to-end: the marketing port now resolves to the real engine              #
# --------------------------------------------------------------------------- #
def test_grounding_provider_uses_real_engine_when_corpus_present(monkeypatch):
    monkeypatch.setattr(
        RagEngine, "from_settings",
        classmethod(lambda cls, settings=None: cls(_store_with_facts())),
    )
    provider = get_grounding_provider()
    assert not isinstance(provider, StaticFactStore), "should no longer be pinned to static facts"

    facts = provider.retrieve("what is the robinhood router address", top_k=3)
    assert facts and all(isinstance(f, GroundingFact) for f in facts)
    # citations must name the real document, not the literal placeholder "rag"
    assert any(f.source.endswith("robinhood.json") for f in facts), [f.source for f in facts]
    assert all(f.source != "rag" for f in facts)


# --------------------------------------------------------------------------- #
# The relevance floor (FACTS-ONLY)                                            #
# --------------------------------------------------------------------------- #
class _FloorEmbedder(StableHashEmbedder):
    """Hash embedder with a deliberately high floor, to test threshold logic."""

    recommended_min_score = 0.55


def test_retrieve_applies_the_relevance_floor():
    """retrieve() — not just answer() — must drop weak hits.

    The marketing RagPort calls retrieve() directly. Without the floor here, an
    off-topic prompt still returned the best-ranked chunks (scoring ~0.40 against a
    0.55 floor), so a post could be "grounded" in unrelated documents.
    """
    s = _store_with_facts()
    s.embedder = _FloorEmbedder(dim=512)
    eng = RagEngine(s)
    assert eng.retrieve("sourdough bread baking technique", top_k=5) == []


def test_config_cannot_lower_a_calibrated_embedder_floor():
    """rag_min_confidence must never weaken a stricter measured floor.

    The old `min(cfg, floor)` turned Voyage's measured 0.55 into the generic 0.35,
    and "What is the capital of France?" scores 0.4951 on the real corpus — i.e.
    off-topic questions were being accepted as grounded.
    """
    s = _store_with_facts()
    s.embedder = _FloorEmbedder(dim=512)
    eng = RagEngine(s, settings=type("S", (), {"rag_min_confidence": 0.35, "rag_top_k": 8})())
    assert eng._threshold() == pytest.approx(0.55)


def test_config_floor_used_only_when_embedder_publishes_none():
    class _NoFloor(StableHashEmbedder):
        recommended_min_score = 0.0

    s = _store_with_facts()
    s.embedder = _NoFloor(dim=512)
    eng = RagEngine(s, settings=type("S", (), {"rag_min_confidence": 0.42, "rag_top_k": 8})())
    assert eng._threshold() == pytest.approx(0.42)


def test_grounding_provider_falls_back_to_static_without_corpus(monkeypatch):
    monkeypatch.setattr(
        RagEngine, "from_settings",
        classmethod(lambda cls, settings=None: cls(RetrievalStore(embedder=StableHashEmbedder(dim=64)))),
    )
    assert isinstance(get_grounding_provider(), StaticFactStore)
