"""Tests for the embedding provider layer and the corpus round-trip.

These cover the gaps that let a misconfiguration ship silently:

* ``build_embedder`` selecting the WRONG provider (the original bug: a ``voyage``
  config fell through to bag-of-words hashing with no error and no log).
* the corpus save/load round-trip, which is what makes ingested vectors reusable
  by the server process at all.
* ``RPCType``-style asymmetry: Voyage must encode documents and queries
  differently, and the store must use the document side when writing.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.embeddings import build_embedder, embed_texts, supports_batch
from app.embeddings.hashing import StableHashEmbedder
from app.embeddings.openai_provider import OpenAIEmbedder
from app.embeddings.voyage import VoyageEmbedder
from app.retrieval.store import RetrievalStore


# --------------------------------------------------------------------------- #
# Provider selection                                                          #
# --------------------------------------------------------------------------- #
def _settings(**kw) -> SimpleNamespace:
    base = dict(
        embedding_provider="openai",
        embedding_model=None,
        embedding_dim=3072,
        openai_api_key=None,
        voyage_api_key=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_voyage_selected_when_key_present():
    e = build_embedder(_settings(embedding_provider="voyage", voyage_api_key="k", embedding_dim=1024))
    assert isinstance(e, VoyageEmbedder)
    assert e.kind == "voyage"
    assert e.dim == 1024


def test_voyage_without_key_falls_back_to_hash(monkeypatch):
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    e = build_embedder(_settings(embedding_provider="voyage"))
    assert isinstance(e, StableHashEmbedder)


def test_openai_selected_when_key_present():
    e = build_embedder(_settings(embedding_provider="openai", openai_api_key="k"))
    assert isinstance(e, OpenAIEmbedder)
    assert e.dim == 3072


def test_unimplemented_provider_falls_back_to_hash():
    # bge/nomic are declared in Settings but have no implementation; they must not
    # pretend to be configured.
    for provider in ("bge", "nomic"):
        assert isinstance(build_embedder(_settings(embedding_provider=provider)), StableHashEmbedder)


def test_voyage_rejects_dim_that_voyage_cannot_emit():
    # 3072 is OpenAI's size. Honouring it would mislabel the corpus, so the
    # embedder must fall back to Voyage's native 1024.
    e = build_embedder(_settings(embedding_provider="voyage", voyage_api_key="k", embedding_dim=3072))
    assert e.dim == 1024


# --------------------------------------------------------------------------- #
# Batching                                                                    #
# --------------------------------------------------------------------------- #
def test_hash_embedder_supports_batch_and_matches_single():
    e = StableHashEmbedder(dim=256)
    assert supports_batch(e)
    texts = ["HookSwap is a DEX", "Robinhood chain id 4663"]
    assert embed_texts(e, texts) == [e.embed(t) for t in texts]


def test_voyage_batches_respect_input_and_token_caps():
    e = VoyageEmbedder(api_key="k", tpm=10_000)
    # 200 texts would exceed the 128-input cap; long texts also exceed the token cap.
    batches = e._token_sized_batches(["word " * 200] * 200)
    assert batches, "must produce at least one batch"
    assert all(len(b) <= 128 for b in batches)
    assert sum(len(b) for b in batches) == 200, "no text may be dropped"


def test_voyage_uses_document_vs_query_input_type():
    """Asymmetric encoding is the whole point — losing it silently degrades recall."""
    e = VoyageEmbedder(api_key="k")
    seen: list[str] = []

    class _FakeResult:
        embeddings = [[0.1, 0.2]]

    class _FakeClient:
        def embed(self, texts, **kw):
            seen.append(kw["input_type"])
            return _FakeResult()

    e._client = _FakeClient()
    e._min_interval = 0  # don't pace the test
    e.embed("a query")
    e.embed_document("a document")
    assert seen == ["query", "document"]


# --------------------------------------------------------------------------- #
# Store: batched write + persistence round-trip                               #
# --------------------------------------------------------------------------- #
def test_add_many_matches_add_one_by_one():
    recs = [
        {"id": f"i{i}", "text": f"HookSwap fact number {i}", "source_id": "s", "metadata": {}}
        for i in range(5)
    ]
    a = RetrievalStore(embedder=StableHashEmbedder(dim=256))
    a.add_many(recs)
    b = RetrievalStore(embedder=StableHashEmbedder(dim=256))
    for r in recs:
        b.add(id=r["id"], text=r["text"], source_id=r["source_id"])
    assert a.size == b.size == 5
    assert [h.id for h, _ in a._items] == [h.id for h, _ in b._items]
    assert [v for _, v in a._items] == [v for _, v in b._items]


def test_store_uses_embed_document_when_provider_is_asymmetric():
    class _Asym:
        kind, dim, recommended_min_score = "asym", 2, 0.1

        def embed(self, text):          # query side
            return [1.0, 0.0]

        def embed_document(self, text):  # document side
            return [0.0, 1.0]

    s = RetrievalStore(embedder=_Asym())
    s.add(id="a", text="t", source_id="s")
    assert s._items[0][1] == [0.0, 1.0], "writes must use the DOCUMENT encoding"


def test_corpus_save_load_roundtrip(tmp_path):
    s = RetrievalStore(embedder=StableHashEmbedder(dim=256))
    s.add_many(
        [
            {"id": "a", "text": "Robinhood chain id is 4663", "source_id": "docs/chains.md",
             "metadata": {"doc_type": "doc", "chain": "robinhood"}},
            {"id": "b", "text": "HyperEVM chain id is 999", "source_id": "docs/chains.md",
             "metadata": {"doc_type": "doc", "chain": "hyperevm"}},
        ]
    )
    p = tmp_path / "corpus.json"
    s.save(p)

    payload = json.loads(p.read_text())
    assert payload["embedder"] == {"kind": "stable-hash", "dim": 256}
    assert len(payload["items"]) == 2

    loaded = RetrievalStore.load(p)
    assert loaded.size == 2
    hits = loaded.search("what chain id is robinhood", top_k=1)
    assert hits and hits[0].metadata["chain"] == "robinhood"


def test_retrieved_exposes_source_kind_chain_aliases():
    """rag_port._EngineAdapter duck-types these; without them citations read 'rag'."""
    s = RetrievalStore(embedder=StableHashEmbedder(dim=128))
    s.add(id="a", text="fee is 0.3%", source_id="docs/fees.md",
          metadata={"doc_type": "deployment", "chain": "robinhood"})
    hit = s.search("fee", top_k=1)[0]
    assert hit.source == "docs/fees.md"
    assert hit.kind == "deployment"
    assert hit.chain == "robinhood"


def test_load_reconciles_hash_dim_with_corpus_file(tmp_path):
    """Query vectors must live in the same space as stored ones, or scores are noise."""
    s = RetrievalStore(embedder=StableHashEmbedder(dim=256))
    s.add(id="a", text="HookSwap", source_id="s")
    p = tmp_path / "c.json"
    s.save(p)
    loaded = RetrievalStore.load(p, embedder=StableHashEmbedder(dim=4096))
    assert loaded.embedder.dim == 256
