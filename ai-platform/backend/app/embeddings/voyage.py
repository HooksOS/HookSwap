"""Voyage AI embeddings provider.

Voyage is an *asymmetric* embedding model family: it wants to know whether a text
is a stored document or a search query, and encodes them differently. Getting this
wrong is the single most common way to silently lose retrieval quality, so the
mapping is explicit here:

    embed(text)          -> input_type="query"     (the search path: store.search)
    embed_document(text) -> input_type="document"  (single-chunk ingest)
    embed_many(texts)    -> input_type="document"  (bulk ingest, one round-trip)

``embed`` defaults to the query side because the only caller of the bare
``Embedder.embed`` on a hot path is ``RetrievalStore.search``. Ingestion goes
through ``embed_many`` / ``embed_document``.

Batching matters: the HookSwap corpus is thousands of chunks and Voyage caps a
request at 128 inputs, so ingestion is chunked into 128-text batches instead of
one HTTP request per chunk.
"""
from __future__ import annotations

import os
import time
from typing import Any, Sequence

from app.embeddings._log import get_logger

log = get_logger("embeddings.voyage")

# Voyage rejects requests above 128 inputs.
MAX_BATCH = 128

# Voyage accounts WITHOUT a payment method are throttled to 3 requests/min and
# 10K tokens/min (verified 2026-07-25: the API returned RateLimitError naming
# exactly those numbers). Ingesting this repo is ~150K tokens, so an unpaced run
# cannot finish. These defaults keep a free-tier key working — slowly but
# correctly — and are raised via env once billing is enabled:
#   HOOKSWAP_AI_VOYAGE_RPM / HOOKSWAP_AI_VOYAGE_TPM
DEFAULT_RPM = int(os.getenv("HOOKSWAP_AI_VOYAGE_RPM", "3"))
DEFAULT_TPM = int(os.getenv("HOOKSWAP_AI_VOYAGE_TPM", "10000"))

# Rough chars-per-token for English prose + code. Only used to SIZE batches under
# the token cap, so an approximation is fine — it is deliberately conservative
# (underestimating tokens would push a batch over the cap and get it rejected).
_CHARS_PER_TOKEN = 3.5


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / _CHARS_PER_TOKEN) + 1)

# Verified live 2026-07-25 against api.voyageai.com: voyage-3-large, voyage-3.5 and
# voyage-code-3 all return 1024-dimensional vectors by default.
DEFAULT_DIM = 1024
DEFAULT_MODEL = "voyage-3-large"


class VoyageEmbedder:
    """Real embeddings via Voyage AI. Optional dependency, imported lazily."""

    kind = "voyage"
    # The "is this grounded?" floor, MEASURED against the real 416-chunk HookSwap
    # corpus with scripts/calibrate_floor.py (2026-07-25, voyage-3-large/1024):
    #     on-topic  min = 0.6208  ("What is the interface fee on swaps?")
    #     off-topic max = 0.4951  ("What is the capital of France?")
    # 0.55 sits in that gap. Do not lower it toward the hash embedder's 0.13 — the
    # cosine floor of a trained model is much higher, and an earlier guessed 0.45
    # would have admitted "What is the capital of France?" as GROUNDED, which is
    # exactly the fabrication path the FACTS-ONLY rule exists to prevent.
    # Re-run the calibration whenever the corpus or model changes.
    recommended_min_score = 0.55

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        dim: int = DEFAULT_DIM,
        api_key: str | None = None,
        *,
        output_dimension: int | None = None,
        rpm: int = DEFAULT_RPM,
        tpm: int = DEFAULT_TPM,
        max_retries: int = 6,
    ) -> None:
        self.model = model
        self.dim = dim
        self._api_key = api_key
        # Only voyage-3-large / voyage-code-3 accept a non-default output_dimension;
        # left None we take the model's native size (1024 for the current family).
        self._output_dimension = output_dimension
        self._client: Any = None
        self._rpm = max(1, rpm)
        self._tpm = max(1_000, tpm)
        self._max_retries = max_retries
        self._min_interval = 60.0 / self._rpm
        self._last_request_at = 0.0
        # rolling 60s window of (sent_at, tokens) used to honour the TPM cap
        self._token_window: list[tuple[float, int]] = []

    def _get_client(self) -> Any:
        if self._client is None:
            import voyageai  # lazy: the core must import without voyageai installed

            self._client = voyageai.Client(api_key=self._api_key)
        return self._client

    def _throttle(self, tokens: int = 0) -> None:
        """Block until this request fits BOTH the request/min and token/min caps.

        Pacing on requests alone is not enough and was the reason ingestion still
        failed: 8K-token batches sent every 20s satisfies 3 RPM but delivers 24K
        tokens/min against a 10K cap. The token side is a rolling 60s window, so
        we wait until enough old usage has aged out to fit the new batch.
        """
        # 1) requests-per-minute
        elapsed = time.monotonic() - self._last_request_at
        if self._last_request_at and elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)

        # 2) tokens-per-minute (rolling window)
        while tokens:
            now = time.monotonic()
            self._token_window = [(t, n) for (t, n) in self._token_window if now - t < 60.0]
            used = sum(n for _, n in self._token_window)
            if used + tokens <= self._tpm or not self._token_window:
                break
            oldest = min(t for t, _ in self._token_window)
            wait = max(0.5, 60.0 - (now - oldest) + 0.5)
            log.info("voyage_token_pacing", used_last_60s=used, need=tokens, sleeping_s=round(wait, 1))
            time.sleep(wait)

        self._last_request_at = time.monotonic()
        if tokens:
            self._token_window.append((self._last_request_at, tokens))

    def _embed(self, texts: Sequence[str], input_type: str) -> list[list[float]]:
        """One paced, retried API call. Assumes the caller already sized the batch."""
        kwargs: dict[str, Any] = {"model": self.model, "input_type": input_type}
        if self._output_dimension:
            kwargs["output_dimension"] = self._output_dimension

        batch_tokens = sum(_estimate_tokens(t) for t in texts)
        delay = 20.0
        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            self._throttle(batch_tokens)
            try:
                result = self._get_client().embed(list(texts), **kwargs)
                return [list(v) for v in result.embeddings]
            except Exception as exc:  # voyageai.error.RateLimitError and friends
                if type(exc).__name__ != "RateLimitError" or attempt == self._max_retries - 1:
                    raise
                last_exc = exc
                log.warning(
                    "voyage_rate_limited",
                    attempt=attempt + 1,
                    sleeping_s=round(delay, 1),
                    hint="add a payment method to lift the 3 RPM / 10K TPM free-tier cap",
                )
                time.sleep(delay)
                delay = min(delay * 1.5, 90.0)
        raise last_exc  # type: ignore[misc]

    def _token_sized_batches(self, texts: Sequence[str]) -> list[list[str]]:
        """Split into batches bounded by BOTH the 128-input cap and the token cap.

        A single request must stay under the per-minute token budget, otherwise it
        is rejected outright no matter how long we wait between calls. An oversized
        single text is still sent alone — Voyage truncates per its own limit rather
        than failing the whole run.
        """
        # Half the per-minute token budget: a batch must comfortably fit inside one
        # window, and smaller batches let the rolling limiter pace smoothly rather
        # than stalling a full 60s behind one oversized request.
        budget = max(1_000, int(self._tpm * 0.45))
        batches: list[list[str]] = []
        cur: list[str] = []
        cur_tokens = 0
        for t in texts:
            tok = _estimate_tokens(t)
            if cur and (len(cur) >= MAX_BATCH or cur_tokens + tok > budget):
                batches.append(cur)
                cur, cur_tokens = [], 0
            cur.append(t)
            cur_tokens += tok
        if cur:
            batches.append(cur)
        return batches

    # -- Embedder protocol -------------------------------------------------
    def embed(self, text: str) -> list[float]:
        """Embed a single SEARCH QUERY (the store.search path)."""
        return self._embed([text], "query")[0]

    def embed_document(self, text: str) -> list[float]:
        """Embed a single STORED DOCUMENT chunk."""
        return self._embed([text], "document")[0]

    # -- BatchEmbedder protocol -------------------------------------------
    def embed_many(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed many DOCUMENT chunks, batched under both the input and token caps."""
        texts = list(texts)
        batches = self._token_sized_batches(texts)
        log.info(
            "voyage_embed_many",
            texts=len(texts),
            batches=len(batches),
            rpm=self._rpm,
            tpm=self._tpm,
            eta_s=round(max(0, len(batches) - 1) * self._min_interval),
        )
        out: list[list[float]] = []
        for i, batch in enumerate(batches, start=1):
            out.extend(self._embed(batch, "document"))
            log.info("voyage_batch", batch=i, of=len(batches), embedded=len(out), total=len(texts))
        return out


__all__ = ["DEFAULT_DIM", "DEFAULT_MODEL", "MAX_BATCH", "VoyageEmbedder"]
