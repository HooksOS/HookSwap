"""RagEngine — facts-only, citation-backed generation grounded in the HookSwap corpus.

The engine is the single choke point where retrieval, prompt construction, and the
Claude call meet. Its contract enforces the project's core rule (FACTS ONLY):

1. Retrieve top-k chunks from the ingested corpus.
2. If nothing clears the relevance floor → answer the honest
   "I don't have that in the HookSwap knowledge base." and mark ``grounded=False``.
   No model call is made.
3. Otherwise build a grounded prompt whose system instruction forbids inventing
   addresses / numbers / facts and requires citing sources by their bracket id, then
   call Claude (``claude-opus-4-8``, adaptive thinking, streaming) and return the answer
   plus the citations it was grounded on.

Honest degradation:
- No ``ANTHROPIC_API_KEY`` (and no injected client): a *grounded* query raises
  ``LLMNotConfiguredError`` → the REST layer returns 503. An *ungrounded* query still
  answers (the fixed "not in KB" line needs no model).
- No OpenAI key: retrieval transparently uses the offline stable-hash embedder
  (see ``app.retrieval.store.build_embedder``); the core still runs.

The Claude call shape (per the Anthropic SDK):
    with client.messages.stream(model="claude-opus-4-8", max_tokens=...,
                                thinking={"type": "adaptive"}, system=..., messages=[...]) as s:
        final = s.get_final_message()
Streaming is used because grounded answers can be long; ``.get_final_message()`` collects
the full text without hand-managing stream events.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

from app.core.config import Settings, settings as global_settings
from app.core.logging import get_logger
from app.retrieval.store import Retrieved, RetrievalStore, build_embedder, resolve_corpus_path

log = get_logger("rag.engine")

LLM_MODEL_DEFAULT = "claude-opus-4-8"
NOT_IN_KB = "I don't have that in the HookSwap knowledge base."

SYSTEM_PROMPT = """You are the HookSwap knowledge assistant. HookSwap is a multi-chain \
DEX and its surrounding tooling.

ABSOLUTE RULES — FACTS ONLY (non-negotiable):
- Answer ONLY using the numbered SOURCES provided in the user message. Treat them as the \
sole source of truth.
- NEVER invent, guess, infer, or approximate any address, contract, chain id, number, \
statistic, date, or fact. If a specific value (e.g. a contract address or a figure) is \
not present verbatim in the sources, say you don't have it — do not produce a \
plausible-looking value.
- Cite every claim inline with its source bracket id, e.g. [S1], [S3]. Every factual \
sentence must carry at least one citation.
- If the sources do not contain the answer, reply exactly: \
"I don't have that in the HookSwap knowledge base." and nothing else.
- Do not use outside knowledge about other DEXes or chains unless it appears in the sources.
- Be concise and precise. Prefer quoting exact addresses/values from the sources over \
paraphrasing them."""


class LLMNotConfiguredError(RuntimeError):
    """Raised when a grounded answer needs the LLM but no Anthropic credential is available."""


@dataclass(slots=True)
class Citation:
    source_id: str
    snippet: str
    score: float = 0.0


@dataclass(slots=True)
class RagAnswer:
    answer: str
    citations: list[Citation] = field(default_factory=list)
    grounded: bool = False
    model: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "citations": [
                {"source_id": c.source_id, "snippet": c.snippet, "score": round(c.score, 4)}
                for c in self.citations
            ],
            "grounded": self.grounded,
            "model": self.model,
        }


class RagEngine:
    """Retrieval + grounded generation. Sync (call from async endpoints via threadpool)."""

    def __init__(
        self,
        store: RetrievalStore,
        *,
        settings: Optional[Settings] = None,
        anthropic_client: Any = None,
    ) -> None:
        self.store = store
        self.settings = settings or global_settings
        self.model = getattr(self.settings, "llm_model", None) or LLM_MODEL_DEFAULT
        self.max_tokens = int(getattr(self.settings, "llm_max_tokens", 4096))
        self._injected_client = anthropic_client
        self._client: Any = anthropic_client

    # ------------------------------------------------------------------ #
    # Construction helpers                                               #
    # ------------------------------------------------------------------ #
    @classmethod
    def from_settings(cls, settings: Optional[Settings] = None) -> "RagEngine":
        """Load the persisted corpus (or start empty) and build the engine. Never raises."""
        st = settings or global_settings
        embedder = build_embedder(st)
        path = resolve_corpus_path(st)
        # For the offline hash embedder, let the corpus file drive the vector dimension
        # (load() reconciles); pass the keyed embedder through for the OpenAI path.
        load_embedder = None if getattr(embedder, "kind", None) == "stable-hash" else embedder
        try:
            loaded = RetrievalStore.load_if_exists(path, embedder=load_embedder)
        except Exception as exc:  # corrupt corpus must not crash boot
            log.warning("corpus_load_failed", path=str(path), error=str(exc))
            loaded = None
        store = loaded or RetrievalStore(embedder=embedder)
        if loaded is None:
            log.warning("corpus_missing", path=str(path), hint="run ingestion/ingest_docs.py")
        else:
            log.info("corpus_loaded", path=str(path), chunks=store.size, sources=len(store.sources()))
        return cls(store, settings=st)

    # ------------------------------------------------------------------ #
    # LLM availability / client                                          #
    # ------------------------------------------------------------------ #
    @property
    def llm_configured(self) -> bool:
        if self._injected_client is not None:
            return True
        return bool(
            os.getenv("ANTHROPIC_API_KEY")
            or getattr(self.settings, "anthropic_api_key", None)
        )

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self.llm_configured:
            raise LLMNotConfiguredError(
                "LLM not configured: set ANTHROPIC_API_KEY to enable grounded generation."
            )
        # Key may live only in settings (env-prefixed) — surface it to the SDK's resolver.
        key = getattr(self.settings, "anthropic_api_key", None)
        if key and not os.getenv("ANTHROPIC_API_KEY"):
            os.environ["ANTHROPIC_API_KEY"] = key
        from anthropic import Anthropic  # lazy: core imports without anthropic installed

        self._client = Anthropic()  # zero-arg: resolves ANTHROPIC_API_KEY from env
        return self._client

    # ------------------------------------------------------------------ #
    # Retrieval + prompt                                                 #
    # ------------------------------------------------------------------ #
    def retrieve(self, query: str, *, top_k: Optional[int] = None) -> list[Retrieved]:
        k = top_k or int(getattr(self.settings, "rag_top_k", 8))
        return self.store.search(query, top_k=k)

    def _relevant(self, hits: list[Retrieved]) -> list[Retrieved]:
        floor = getattr(self.store.embedder, "recommended_min_score", 0.06)
        cfg = getattr(self.settings, "rag_min_confidence", None)
        # Respect a configured floor only when it is not stricter-than-sane for this embedder.
        threshold = floor if cfg is None else min(cfg, floor) if floor else cfg
        return [h for h in hits if h.score >= threshold]

    @staticmethod
    def _build_user_prompt(query: str, hits: list[Retrieved]) -> str:
        parts = ["SOURCES:"]
        for i, h in enumerate(hits, start=1):
            parts.append(f"[S{i}] (source_id: {h.source_id})\n{h.text.strip()}")
        parts.append(
            "\nQUESTION:\n"
            + query
            + "\n\nAnswer using ONLY the sources above, citing each fact as [S#]. "
            "If the sources don't contain the answer, reply exactly: "
            f'"{NOT_IN_KB}"'
        )
        return "\n\n".join(parts)

    @staticmethod
    def _citations(hits: list[Retrieved]) -> list[Citation]:
        return [Citation(source_id=h.source_id, snippet=h.snippet(), score=h.score) for h in hits]

    # ------------------------------------------------------------------ #
    # Generation                                                         #
    # ------------------------------------------------------------------ #
    def answer(self, query: str, *, top_k: Optional[int] = None) -> RagAnswer:
        hits = self._relevant(self.retrieve(query, top_k=top_k))
        if not hits:
            return RagAnswer(answer=NOT_IN_KB, citations=[], grounded=False, model=None)
        # grounded path needs the model
        text = self._generate(self._build_user_prompt(query, hits))
        return RagAnswer(
            answer=text,
            citations=self._citations(hits),
            grounded=True,
            model=self.model,
        )

    def _generate(self, user_prompt: str) -> str:
        client = self._get_client()  # raises LLMNotConfiguredError if no credential
        with client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            final = stream.get_final_message()
        return _text_of(final)

    # ------------------------------------------------------------------ #
    # Streaming (SSE-friendly sync generator)                            #
    # ------------------------------------------------------------------ #
    def stream_answer(self, query: str, *, top_k: Optional[int] = None) -> Iterator[dict[str, Any]]:
        """Yield event dicts: {"type": ..., "data": ...}. Enforces the same grounding rules.

        Raises ``LLMNotConfiguredError`` (before yielding) when a grounded answer needs the
        model but no credential is available — the REST layer converts that to a 503.
        """
        hits = self._relevant(self.retrieve(query, top_k=top_k))
        if not hits:
            yield {"type": "token", "data": NOT_IN_KB}
            yield {"type": "grounded", "data": False}
            yield {"type": "done", "data": {"grounded": False}}
            return

        client = self._get_client()  # raises before any token if unconfigured
        citations = [
            {"source_id": c.source_id, "snippet": c.snippet, "score": round(c.score, 4)}
            for c in self._citations(hits)
        ]
        yield {"type": "citations", "data": citations}
        yield {"type": "grounded", "data": True}
        with client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": self._build_user_prompt(query, hits)}],
        ) as stream:
            for delta in stream.text_stream:
                if delta:
                    yield {"type": "token", "data": delta}
        yield {"type": "done", "data": {"grounded": True, "model": self.model}}


def _text_of(message: Any) -> str:
    """Concatenate text blocks from an Anthropic message (ignores thinking blocks)."""
    parts: list[str] = []
    for block in getattr(message, "content", []) or []:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", ""))
    return "".join(parts).strip()


__all__ = ["Citation", "LLMNotConfiguredError", "RagAnswer", "RagEngine"]
