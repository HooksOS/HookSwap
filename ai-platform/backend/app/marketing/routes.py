"""FastAPI routes for the HookSwap marketing bot.

    POST /v1/marketing/draft    — draft an X post + branded card. Does NOT post.
    POST /v1/marketing/publish  — draft + post to X. Gated on x-config AND an
                                  explicit ``confirm: true`` so it never
                                  auto-publishes.

Wire into the app by including ``router`` (see ``include_marketing_routes`` for
the coordination hook with the concurrent RAG-core router aggregator).
"""
from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .image_card import render_card
from .marketing_assistant import DraftResult, MarketingAssistant
from .rag_port import GroundingFact
from .x_client import XClient

router = APIRouter(prefix="/v1/marketing", tags=["marketing"])


# --------------------------------------------------------------------------- #
# DTOs                                                                         #
# --------------------------------------------------------------------------- #
class DraftRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=4000)
    changelog: str | None = Field(default=None, max_length=8000)
    chain: str | None = None
    surface: str = "tweet"
    with_card: bool = True
    headline: str | None = None  # card headline; defaults to topic
    stat: str | None = None  # only stamped if grounded
    # None => auto (fetch real live stats only when the brief references a market
    # number); True => always fetch; False => never. Numbers always come from the
    # live-stats tool, never the model.
    with_live_stats: bool | None = None


class CardMeta(BaseModel):
    ok: bool
    format: str
    rasterizer: str | None = None
    stat_used: str | None = None
    warnings: list[str] = Field(default_factory=list)
    note: str | None = None
    data_base64: str | None = None  # PNG base64, or None
    svg: str | None = None  # SVG markup when no rasterizer


class DraftResponse(BaseModel):
    ok: bool
    text: str
    facts_used: list[dict[str, Any]] = Field(default_factory=list)
    hashtags: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    reason: str | None = None
    model: str | None = None
    surface: str = "tweet"
    card: CardMeta | None = None


class PublishRequest(DraftRequest):
    confirm: bool = False  # MUST be true to actually post — never auto-publish
    dry_run: bool = False  # preview exactly what WOULD post; never hits the network


class PublishResponse(BaseModel):
    ok: bool
    posted: bool
    reason: str | None = None
    draft: DraftResponse
    post_result: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def _facts_from_result(result: DraftResult) -> list[GroundingFact]:
    return [
        GroundingFact(
            text=c.get("text", ""),
            source=c.get("source", ""),
            kind=c.get("kind", "feature"),
            chain=c.get("chain"),
        )
        for c in result.facts_used
    ]


def _build_card(req: DraftRequest, result: DraftResult) -> CardMeta:
    facts = _facts_from_result(result)
    headline = req.headline or req.topic
    card = render_card(headline, facts=facts, stat=req.stat)
    data_b64 = None
    svg = None
    if card.format == "png" and isinstance(card.data, (bytes, bytearray)):
        data_b64 = base64.b64encode(card.data).decode()
    elif card.format == "svg" and isinstance(card.data, str):
        svg = card.data
    return CardMeta(
        ok=card.ok,
        format=card.format,
        rasterizer=card.rasterizer,
        stat_used=card.stat_used,
        warnings=card.warnings,
        note=card.note,
        data_base64=data_b64,
        svg=svg,
    )


def _result_to_response(result: DraftResult, card: CardMeta | None) -> DraftResponse:
    return DraftResponse(
        ok=result.ok,
        text=result.text,
        facts_used=result.facts_used,
        hashtags=result.hashtags,
        warnings=result.warnings,
        reason=result.reason,
        model=result.model,
        surface=result.surface,
        card=card,
    )


def _draft(req: DraftRequest, assistant: MarketingAssistant | None = None) -> tuple[DraftResult, DraftResponse]:
    assistant = assistant or MarketingAssistant()
    result = assistant.draft(
        req.topic,
        changelog=req.changelog,
        chain=req.chain,
        surface=req.surface,
        with_live_stats=req.with_live_stats,
    )
    card = _build_card(req, result) if req.with_card else None
    return result, _result_to_response(result, card)


# --------------------------------------------------------------------------- #
# endpoints                                                                    #
# --------------------------------------------------------------------------- #
@router.post("/draft", response_model=DraftResponse)
def draft_post(req: DraftRequest) -> DraftResponse:
    _, response = _draft(req)
    return response


@router.post("/publish", response_model=PublishResponse)
def publish_post(req: PublishRequest) -> PublishResponse:
    result, draft_response = _draft(req)

    # Explicit opt-in gate — never auto-publish.
    if not req.confirm:
        return PublishResponse(
            ok=False, posted=False, reason="confirm_required",
            draft=draft_response,
        )

    # Do not post a draft the guardrails flagged.
    if not result.ok:
        return PublishResponse(
            ok=False, posted=False, reason=result.reason or "draft_not_ok",
            draft=draft_response,
        )

    # Assemble the exact body + optional media that WOULD post.
    media_png = None
    if draft_response.card and draft_response.card.data_base64:
        media_png = base64.b64decode(draft_response.card.data_base64)

    body = draft_response.text
    if draft_response.hashtags:
        candidate = body + " " + " ".join(draft_response.hashtags)
        body = candidate if len(candidate) <= 280 else body

    x = XClient()

    # Explicit dry-run: preview what would post, hit no network (even if configured).
    if req.dry_run:
        return PublishResponse(
            ok=False, posted=False, reason="dry_run",
            draft=draft_response,
            post_result=x.post_tweet(body, media_png=media_png, dry_run=True),
        )

    # Honest DRY-RUN when X keys are absent — never fakes a post.
    if not x.is_configured():
        return PublishResponse(
            ok=False, posted=False, reason="x_not_configured",
            draft=draft_response,
            post_result={"ok": False, "dry_run": True, "reason": "x_not_configured"},
        )

    # Master kill-switch — auto-post only behind an explicit flag. Configured but
    # disabled => never posts; returns the full draft so an operator can review.
    from app.core.config import get_settings

    if not get_settings().marketing_auto_post_enabled:
        return PublishResponse(
            ok=False, posted=False, reason="auto_post_disabled",
            draft=draft_response,
            post_result={
                "ok": False,
                "dry_run": True,
                "reason": "auto_post_disabled",
                "detail": "set HOOKSWAP_AI_MARKETING_AUTO_POST_ENABLED=true to allow posting",
            },
        )

    post_result = x.post_tweet(body, media_png=media_png)
    return PublishResponse(
        ok=bool(post_result.get("ok")),
        posted=bool(post_result.get("ok")),
        reason=None if post_result.get("ok") else post_result.get("reason"),
        draft=draft_response,
        post_result=post_result,
    )


def include_marketing_routes(app: Any) -> None:
    """Attach marketing routes to a FastAPI app (RAG-core coordination hook).

    The concurrent RAG core owns ``app/main.py`` + its router aggregator. It can
    wire this slice with either::

        from app.marketing.routes import router as marketing_router
        app.include_router(marketing_router)

    or simply ``from app.marketing.routes import include_marketing_routes;
    include_marketing_routes(app)``.
    """
    app.include_router(router)
