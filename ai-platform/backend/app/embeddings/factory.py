"""Provider selection.

Before this package existed, ``build_embedder`` had a single ``openai`` branch and
everything else — including ``voyage``, which config has always accepted — fell
through to the offline hash embedder *silently*. A deployment configured for
Voyage would boot, serve, and retrieve at bag-of-words quality with no signal that
the configured provider was never used. That is exactly the kind of silent
degradation the project rule forbids, so selection here is explicit and logged:

* provider configured + key present            -> that provider
* provider configured + key MISSING            -> hash fallback, logged at WARNING
* provider unimplemented (bge / nomic)         -> hash fallback, logged at WARNING

The fallback is deliberate (a keyless box must still run) but it is never quiet.
"""
from __future__ import annotations

import os
from typing import Any

from app.embeddings._log import get_logger
from app.embeddings.base import Embedder
from app.embeddings.hashing import StableHashEmbedder
from app.embeddings.openai_provider import OpenAIEmbedder
from app.embeddings.voyage import DEFAULT_DIM as VOYAGE_DEFAULT_DIM
from app.embeddings.voyage import DEFAULT_MODEL as VOYAGE_DEFAULT_MODEL
from app.embeddings.voyage import VoyageEmbedder

log = get_logger("embeddings.factory")

# Providers that are declared in Settings but have no implementation yet. Named
# explicitly so the warning can say *why* it fell back.
_UNIMPLEMENTED = {"bge", "nomic"}


def _get(settings: Any, name: str, default: Any = None) -> Any:
    """Duck-typed settings read — ingestion passes a SimpleNamespace, not Settings."""
    return getattr(settings, name, default)


def build_embedder(settings: Any) -> Embedder:
    """Pick the embedder from config. Falls back to offline hashing, loudly."""
    provider = (_get(settings, "embedding_provider", "openai") or "openai").lower()

    if provider == "voyage":
        key = _get(settings, "voyage_api_key") or os.getenv("VOYAGE_API_KEY")
        if key:
            model = _get(settings, "embedding_model") or VOYAGE_DEFAULT_MODEL
            # A dim configured for a different provider (e.g. OpenAI's 3072) would
            # mislabel the corpus, so only honour it when it is a size Voyage can
            # actually emit; otherwise take the model's native 1024.
            configured_dim = int(_get(settings, "embedding_dim", VOYAGE_DEFAULT_DIM) or VOYAGE_DEFAULT_DIM)
            valid = configured_dim in (256, 512, 1024, 2048)
            if not valid:
                log.warning(
                    "voyage_dim_invalid",
                    configured=configured_dim,
                    using=VOYAGE_DEFAULT_DIM,
                    hint="Voyage emits 256/512/1024/2048; set HOOKSWAP_AI_EMBEDDING_DIM accordingly",
                )
            dim = configured_dim if valid else VOYAGE_DEFAULT_DIM
            log.info("embedder_selected", provider="voyage", model=model, dim=dim)
            return VoyageEmbedder(
                model=model,
                dim=dim,
                api_key=key,
                output_dimension=dim if dim != VOYAGE_DEFAULT_DIM else None,
            )
        log.warning(
            "embedder_fallback",
            requested="voyage",
            reason="no voyage_api_key / VOYAGE_API_KEY",
            using="stable-hash",
        )
        return StableHashEmbedder()

    if provider == "openai":
        key = _get(settings, "openai_api_key") or os.getenv("OPENAI_API_KEY")
        if key:
            model = _get(settings, "embedding_model") or "text-embedding-3-large"
            dim = int(_get(settings, "embedding_dim", 3072) or 3072)
            log.info("embedder_selected", provider="openai", model=model, dim=dim)
            return OpenAIEmbedder(model=model, dim=dim, api_key=key)
        log.warning(
            "embedder_fallback",
            requested="openai",
            reason="no openai_api_key / OPENAI_API_KEY",
            using="stable-hash",
        )
        return StableHashEmbedder()

    if provider in _UNIMPLEMENTED:
        log.warning(
            "embedder_fallback",
            requested=provider,
            reason="provider declared in config but not implemented",
            using="stable-hash",
        )
        return StableHashEmbedder()

    log.info("embedder_selected", provider="stable-hash", requested=provider)
    return StableHashEmbedder()


__all__ = ["build_embedder"]
