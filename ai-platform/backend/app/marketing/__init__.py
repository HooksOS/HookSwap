"""HookSwap X (Twitter) AI marketing slice of the RAG platform.

Grounded, on-brand, facts-only post + branded-image drafting, with opt-in,
confirmation-gated publishing to X. See ``docs/marketing-rag-spec.md``.

Public surface:
    MarketingAssistant  — draft a grounded X post (marketing_assistant)
    render_card         — branded DAYSIGNAL image card (image_card)
    XClient             — honest, opt-in X poster (x_client)
    router              — FastAPI routes (routes)
    RagPort / GroundingFact — shared retrieval contract (rag_port)

Heavy deps (anthropic, httpx, tweepy, cairosvg/Pillow, fastapi) are imported
lazily so the leaf modules import cleanly without them; ``routes`` requires
fastapi. The concurrent RAG core satisfies ``RagPort``; until then the bundled
``StaticFactStore`` grounds against verified in-repo facts.
"""
from __future__ import annotations

__all__ = [
    "MarketingAssistant",
    "DraftResult",
    "render_card",
    "CardResult",
    "XClient",
    "GroundingFact",
    "RagPort",
    "StaticFactStore",
    "get_grounding_provider",
    "LiveStatsClient",
    "get_live_stats_provider",
]

from .image_card import CardResult, render_card
from .live_stats import LiveStatsClient, get_live_stats_provider
from .marketing_assistant import DraftResult, MarketingAssistant
from .rag_port import GroundingFact, RagPort, StaticFactStore, get_grounding_provider
from .x_client import XClient
