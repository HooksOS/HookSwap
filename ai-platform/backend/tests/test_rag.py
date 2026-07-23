"""RAG core tests.

Proves the three facts-only guarantees WITHOUT calling the real Anthropic API (the
client is mocked):

  1. Retrieval returns the relevant HookSwap docs for an on-topic query.
  2. A grounded query returns an answer with citations and ``grounded=True``,
     and the Claude call is made with the required shape (model / adaptive thinking).
  3. An ungrounded query returns the honest "not in the knowledge base" answer with
     ``grounded=False`` and makes NO LLM call.
  4. A grounded query with no LLM configured raises ``LLMNotConfiguredError`` (-> 503).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.rag.engine import LLMNotConfiguredError, NOT_IN_KB, RagEngine
from app.retrieval.store import RetrievalStore, StableHashEmbedder


# --------------------------------------------------------------------------- #
# Fakes                                                                       #
# --------------------------------------------------------------------------- #
class _FakeTextBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class _FakeMessage:
    def __init__(self, text: str) -> None:
        self.content = [_FakeTextBlock(text)]


class _FakeStream:
    def __init__(self, text: str) -> None:
        self._text = text

    def __enter__(self) -> "_FakeStream":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def get_final_message(self) -> _FakeMessage:
        return _FakeMessage(self._text)

    @property
    def text_stream(self):
        yield self._text


class _FakeMessages:
    def __init__(self, text: str, calls: list) -> None:
        self._text = text
        self._calls = calls

    def stream(self, **kwargs) -> _FakeStream:
        self._calls.append(kwargs)
        return _FakeStream(self._text)


class _FakeAnthropic:
    """Stand-in for anthropic.Anthropic — records calls, never hits the network."""

    def __init__(self, text: str = "HookSwap deploys its own v2+v3+UR stack on Robinhood Chain [S1].") -> None:
        self.calls: list = []
        self.messages = _FakeMessages(text, self.calls)


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        rag_top_k=8,
        rag_min_confidence=None,
        llm_model="claude-opus-4-8",
        llm_max_tokens=4096,
        anthropic_api_key=None,
    )


@pytest.fixture()
def store() -> RetrievalStore:
    s = RetrievalStore(embedder=StableHashEmbedder())
    s.add(
        id="claude::0",
        text=(
            "HookSwap is a multi-chain DEX. It deploys its own full v2 and v3 and "
            "Universal Router stack on Robinhood Chain, MegaETH, Ink, XLayer, HyperEVM, "
            "Tempo, and Sepolia."
        ),
        source_id="CLAUDE.md#Deploy",
        metadata={"doc_type": "project_facts"},
    )
    s.add(
        id="dep::0",
        text=(
            "HookSwap on-chain deployment addresses (megaeth) chain=megaeth chainId=4326. "
            "v2Factory: 0xD1Cf664944173140AFc302c169eFD55c24966B45. "
            "v2Router02: 0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA."
        ),
        source_id="contracts/deployments/megaeth.json",
        metadata={"doc_type": "deployment", "chain_id": 4326},
    )
    s.add(
        id="chains::0",
        text=(
            "HookSwap live chain registry: Robinhood Chain slug robinhood chainId 4663 "
            "native ETH; Sepolia chainId 11155111 testnet canonical validation chain."
        ),
        source_id="hookswap:chain-registry",
        metadata={"doc_type": "chain_registry"},
    )
    return s


@pytest.fixture()
def engine(store: RetrievalStore) -> RagEngine:
    return RagEngine(store, settings=_settings(), anthropic_client=_FakeAnthropic())


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
def test_retrieval_returns_hookswap_docs(store: RetrievalStore) -> None:
    hits = store.search("what contract addresses are deployed on megaeth chain", top_k=3)
    assert hits, "expected retrieval to return corpus chunks"
    assert hits[0].score > 0
    # the megaeth deployment doc should be the top hit for that query
    assert hits[0].source_id == "contracts/deployments/megaeth.json"
    assert "0xD1Cf66" in hits[0].text  # real address preserved verbatim


def test_grounded_answer_has_citations_and_calls_claude(engine: RagEngine) -> None:
    result = engine.answer("Which chains does HookSwap deploy its own stack on?")
    assert result.grounded is True
    assert result.model == "claude-opus-4-8"
    assert result.citations, "grounded answer must carry citations"
    assert any(c.source_id == "CLAUDE.md#Deploy" for c in result.citations)
    assert "[S1]" in result.answer  # mocked model output flowed through

    # verify the Claude call shape (model + adaptive thinking + streaming)
    calls = engine._client.calls  # the injected fake
    assert len(calls) == 1
    call = calls[0]
    assert call["model"] == "claude-opus-4-8"
    assert call["thinking"] == {"type": "adaptive"}
    assert call["messages"][0]["role"] == "user"
    assert "SOURCES:" in call["messages"][0]["content"]


def test_ungrounded_query_is_honest_and_makes_no_llm_call(engine: RagEngine) -> None:
    fake = engine._client
    result = engine.answer("xylophone marmalade quokka zeppelin unrelated gibberish")
    assert result.grounded is False
    assert result.answer == NOT_IN_KB
    assert result.citations == []
    assert fake.calls == [], "no LLM call should be made for an ungrounded query"


def test_grounded_without_llm_raises_503_signal(store: RetrievalStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    eng = RagEngine(store, settings=_settings(), anthropic_client=None)
    assert eng.llm_configured is False
    with pytest.raises(LLMNotConfiguredError):
        eng.answer("Which chains does HookSwap deploy its own stack on?")


def test_stream_answer_ungrounded_emits_done(engine: RagEngine) -> None:
    events = list(engine.stream_answer("xylophone marmalade quokka zeppelin gibberish"))
    types = [e["type"] for e in events]
    assert "done" in types
    assert any(e["type"] == "token" and e["data"] == NOT_IN_KB for e in events)
    assert engine._client.calls == []  # no model call for ungrounded stream


def test_stream_answer_grounded_streams_tokens(engine: RagEngine) -> None:
    events = list(engine.stream_answer("Which chains does HookSwap deploy on?"))
    types = [e["type"] for e in events]
    assert "citations" in types
    assert "token" in types
    assert types[-1] == "done"
    assert len(engine._client.calls) == 1
