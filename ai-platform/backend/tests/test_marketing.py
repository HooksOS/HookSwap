"""Tests for the HookSwap marketing bot slice.

Mocks Claude and X — NO real API calls. Proves:
  * a draft is grounded (facts_used non-empty, no ungrounded facts flagged),
  * guardrails hard-refuse a price-prediction brief (before calling Claude),
  * the branded card renders (PNG) or honestly emits SVG,
  * an ungrounded stat is never stamped on the card,
  * the validator flags ungrounded numbers/addresses,
  * publish returns honest "not configured" without X credentials and never
    auto-publishes without confirm.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make `app` importable when run directly (pytest rootdir = backend/).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.marketing import guardrails
from app.marketing.image_card import render_card
from app.marketing.marketing_assistant import MarketingAssistant
from app.marketing.rag_port import GroundingFact, StaticFactStore
from app.marketing.x_client import XClient, XCredentials


# --------------------------------------------------------------------------- #
# Fake Claude client (mimics client.messages.stream(...).get_final_message())  #
# --------------------------------------------------------------------------- #
class _Block:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _Final:
    def __init__(self, text: str) -> None:
        self.content = [_Block(text)]


class _Stream:
    def __init__(self, text: str) -> None:
        self._text = text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return _Final(self._text)


class _Messages:
    def __init__(self, text: str, calls: list) -> None:
        self._text = text
        self._calls = calls

    def stream(self, **kwargs):
        self._calls.append(kwargs)
        return _Stream(self._text)


class FakeClaude:
    """Records calls and returns a fixed body — never touches the network."""

    def __init__(self, text: str) -> None:
        self.calls: list = []
        self.messages = _Messages(text, self.calls)


# --------------------------------------------------------------------------- #
# grounding                                                                    #
# --------------------------------------------------------------------------- #
def test_static_fact_store_retrieves_real_facts():
    store = StaticFactStore()
    facts = store.retrieve("what chains and fees does HookSwap have", top_k=8)
    assert facts, "static fact store should retrieve verified facts"
    assert all(f.source for f in facts), "every fact must carry a citation"


def test_draft_is_grounded():
    # Body uses only grounded language (v2/v3, terminal, no numbers/addresses).
    fake = FakeClaude("HookSwap: v2 + v3 pools, no forms. A DEX in terminal form.")
    assistant = MarketingAssistant(rag=StaticFactStore(), anthropic_client=fake)
    result = assistant.draft("Introduce HookSwap's multi-chain v2+v3 DEX")

    assert result.ok is True
    assert result.facts_used, "draft must trace to retrieved grounding facts"
    assert result.text
    assert fake.calls, "Claude should have been called"
    # model + adaptive thinking wired
    assert fake.calls[0]["model"] == "claude-opus-4-8"
    assert fake.calls[0]["thinking"] == {"type": "adaptive"}
    # no ungrounded facts flagged
    assert not any("ungrounded" in w for w in result.warnings)


def test_draft_flags_ungrounded_number_from_model():
    # Model fabricates a TVL figure — validator must flag it, ok=False.
    fake = FakeClaude("HookSwap now has $42,000,000 TVL across chains.")
    assistant = MarketingAssistant(rag=StaticFactStore(), anthropic_client=fake)
    result = assistant.draft("Post about HookSwap growth")
    assert result.ok is False
    assert any("ungrounded number" in w for w in result.warnings)


def test_draft_flags_ungrounded_address():
    fake = FakeClaude("Router live at 0x1111111111111111111111111111111111111111 on Robinhood.")
    assistant = MarketingAssistant(rag=StaticFactStore(), anthropic_client=fake)
    result = assistant.draft("Announce the router", chain="robinhood")
    assert result.ok is False
    assert any("ungrounded contract address" in w for w in result.warnings)


def test_grounded_address_passes():
    # The real Robinhood Universal Router address IS in the grounding.
    addr = "0x3D30133F4d4A80684F02d8310faF572E3dc193b3"
    fake = FakeClaude(f"HookSwap Universal Router is live on Robinhood at {addr}.")
    assistant = MarketingAssistant(rag=StaticFactStore(), anthropic_client=fake)
    result = assistant.draft("Announce the Universal Router on Robinhood", chain="robinhood")
    assert not any("ungrounded contract address" in w for w in result.warnings)


# --------------------------------------------------------------------------- #
# guardrails                                                                   #
# --------------------------------------------------------------------------- #
def test_guardrail_rejects_price_prediction():
    fake = FakeClaude("should never be produced")
    assistant = MarketingAssistant(rag=StaticFactStore(), anthropic_client=fake)
    result = assistant.draft("Will HOOK hit a $10 price target soon? predict the price")
    assert result.ok is False
    assert result.reason == "guardrail_refused"
    assert result.text == ""
    assert fake.calls == [], "Claude must NOT be called for a refused brief"


def test_guardrail_rejects_financial_advice():
    check = guardrails.check_prompt("Tell everyone they should buy now, great entry")
    assert check.allowed is False


def test_validator_flags_banned_v4_and_hooks():
    facts = [GroundingFact(text="HookSwap ships v2 + v3 only.", source="x")]
    v = guardrails.validate_draft("HookSwap v4 hooks are live and audited!", facts)
    assert v.ok is False
    assert set(v.banned_claims) >= {"v4", "hooks", "audited"}


def test_validator_flags_overlength():
    facts = [GroundingFact(text="HookSwap is a DEX.", source="x")]
    v = guardrails.validate_draft("HookSwap is a DEX. " * 30, facts)
    assert any("exceeds 280" in w for w in v.warnings)


# --------------------------------------------------------------------------- #
# image card                                                                   #
# --------------------------------------------------------------------------- #
def test_card_renders_or_emits_svg():
    facts = [GroundingFact(text="HookSwap runs on seven chains.", source="x")]
    card = render_card("Farms are live on X Layer", facts=facts)
    assert card.ok is True
    assert card.format in {"png", "svg"}
    if card.format == "svg":
        assert isinstance(card.data, str) and "<svg" in card.data
        assert any("rasterizer" in w for w in card.warnings)
    else:
        assert isinstance(card.data, (bytes, bytearray)) and len(card.data) > 0


def test_card_omits_ungrounded_stat():
    facts = [GroundingFact(text="HookSwap runs on seven chains.", source="x")]
    card = render_card("Big milestone", facts=facts, stat="$5,000,000 TVL")
    assert card.stat_used is None
    assert any("not found in grounding" in w for w in card.warnings)


def test_card_stamps_grounded_stat():
    facts = [GroundingFact(text="HookSwap runs on seven chains.", source="x")]
    card = render_card("Milestone", facts=facts, stat="seven chains")
    assert card.stat_used == "seven chains"


# --------------------------------------------------------------------------- #
# X client — honest not-configured                                             #
# --------------------------------------------------------------------------- #
def test_x_client_not_configured(monkeypatch):
    for name in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"):
        monkeypatch.delenv(name, raising=False)
    x = XClient()
    assert x.is_configured() is False
    result = x.post_tweet("hello world")
    assert result["ok"] is False
    assert result["reason"] == "x_not_configured"


def test_x_client_configured_detection():
    creds = XCredentials("k", "s", "t", "ts")
    x = XClient(creds=creds)
    assert x.is_configured() is True


def test_oauth1_header_shape():
    from app.marketing.x_client import _oauth1_header

    creds = XCredentials("k", "s", "t", "ts")
    header = _oauth1_header(creds, "POST", "https://api.twitter.com/2/tweets")
    assert header.startswith("OAuth ")
    assert "oauth_signature=" in header
    assert "oauth_consumer_key=" in header


# --------------------------------------------------------------------------- #
# routes (require fastapi)                                                     #
# --------------------------------------------------------------------------- #
def test_publish_requires_confirm(monkeypatch):
    pytest.importorskip("fastapi")
    from app.marketing import routes

    monkeypatch.setattr(
        routes,
        "MarketingAssistant",
        lambda *a, **k: MarketingAssistant(
            rag=StaticFactStore(),
            anthropic_client=FakeClaude("HookSwap: v2 + v3 pools. A DEX in terminal form."),
        ),
    )
    req = routes.PublishRequest(topic="Announce HookSwap", confirm=False, with_card=False)
    resp = routes.publish_post(req)
    assert resp.posted is False
    assert resp.reason == "confirm_required"


def test_publish_honest_not_configured(monkeypatch):
    pytest.importorskip("fastapi")
    from app.marketing import routes

    for name in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(
        routes,
        "MarketingAssistant",
        lambda *a, **k: MarketingAssistant(
            rag=StaticFactStore(),
            anthropic_client=FakeClaude("HookSwap: v2 + v3 pools. A DEX in terminal form."),
        ),
    )
    req = routes.PublishRequest(topic="Announce HookSwap", confirm=True, with_card=False)
    resp = routes.publish_post(req)
    assert resp.posted is False
    assert resp.reason == "x_not_configured"


if __name__ == "__main__":  # allow `python tests/test_marketing.py`
    sys.exit(pytest.main([__file__, "-q"]))
