"""HookSwap X (Twitter) marketing assistant — grounded post drafting.

Pipeline (docs/marketing-rag-spec.md §3.5):

    topic/changelog
        -> guardrails.check_prompt         (hard-refuse price predictions/advice)
        -> RagPort.retrieve                (REAL HookSwap facts only)
        -> Claude claude-opus-4-8          (brand voice + guardrails in prompt,
                                            adaptive thinking, streamed)
        -> guardrails.validate_draft       (facts-only + compliance scan)
        -> {text, facts_used, hashtags, warnings}

FACTS-ONLY: every factual claim must trace to a retrieved source. The model is
instructed to state only facts present in the grounding block, and the output is
re-scanned for any number/address it could not ground. Market-moving numbers
(TVL, volume, price, APR) are never embedded — if a post needs one, it must come
from a live-data tool at generation time (not yet wired here; see the warning
emitted when a brief asks for live stats).

LLM: Anthropic Python SDK, model ``claude-opus-4-8``, ``thinking`` adaptive,
streamed. Credentials via zero-arg ``Anthropic()`` reading ``ANTHROPIC_API_KEY``.
When the key is unset the assistant returns an honest ``not_configured`` result
rather than crashing or fabricating a post.
"""
from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from . import guardrails
from .rag_port import GroundingFact, RagPort, get_grounding_provider

MODEL = "claude-opus-4-8"

BRAND_SYSTEM = """You are HookSwap Desk Writer, the marketing voice of HookSwap.

IDENTITY & VOICE
- HookSwap is a self-hosted, multi-chain on-chain DEX styled as a trading DESK /
  TERMINAL, not a form. Voice: precise, quantitative, understated. No hype, no
  emoji spam, no exclamation storms. Numbers read like a terminal.
- Taglines you may echo verbatim: "Trade on-chain like a desk, not a form",
  "A DEX in terminal form".

PRODUCT TRUTH (do not contradict)
- HookSwap is v2 + v3 only. There are NO hooks and NO v4. Never claim hooks, v4,
  or any feature not in the GROUNDING FACTS below. The name is aspirational;
  the shipped product excludes hooks.
- Products: swap, launchpad, locker, farms, referrals, airdrop, multisender.
  Perps (HookSwapPerps) is UPCOMING — label it as upcoming, never as live.

HARD FACTUAL CONSTRAINTS (facts-only)
- State ONLY facts present in the GROUNDING FACTS block below. If a claim is not
  grounded, do not make it. When unsure, say so or leave it out.
- NEVER invent or approximate a statistic (TVL, volume, APY/APR, price, pool
  count). Do not state any current market number — none are provided, so state
  none. Fee tiers may be quoted from the grounding (v2 0.30%; v3 0.01/0.05/0.30/
  1.00%).
- NEVER invent, complete, or "correct" a contract address or chain id. Quote a
  grounded address verbatim, character-for-character, or omit it.

COMPLIANCE (hard rules)
- No financial or investment advice. No "buy", "you should", "great entry".
- No price predictions, targets, or speculation on token value.
- No yield/return promises. No "guaranteed" anything.
- No security/audit claims — HookSwap does not publish an independent audit.
- Be honest about stage: HookSwap is early; liquidity is thin/seeded and some
  pairs have no route yet. Do not oversell readiness.

OUTPUT FORMAT
Return the tweet body as plain text, at most 280 characters, no surrounding
quotes. Do not include hashtags in the body — list them separately. Do not add
commentary. If the grounding is too thin to say anything true and useful, write
a short honest post and nothing invented."""

_HASHTAG_RE = re.compile(r"#\w+")
# Briefs that request live/market numbers we cannot ground without a live tool.
_LIVE_STAT_HINT = re.compile(
    r"\b(tvl|volume|24h|apr|apy|price|market\s*cap|liquidity\s+of|\$\d)\b", re.IGNORECASE
)
DEFAULT_HASHTAGS = ["#HookSwap", "#DeFi", "#onchain"]


@dataclass
class DraftResult:
    ok: bool
    text: str
    facts_used: list[dict[str, Any]] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    reason: str | None = None  # set when ok is False (e.g. refused/not_configured)
    model: str | None = None
    surface: str = "tweet"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class MarketingAssistant:
    """Drafts a grounded, on-brand HookSwap X post from a topic/changelog entry."""

    def __init__(self, rag: RagPort | None = None, anthropic_client: Any | None = None):
        # Grounding provider: real RAG engine if present, else static fact store.
        self._rag = rag or get_grounding_provider()
        # Injected client (tests) short-circuits credential resolution.
        self._client = anthropic_client
        self._client_explicit = anthropic_client is not None

    # -- LLM plumbing -------------------------------------------------------- #
    @staticmethod
    def is_configured() -> bool:
        return bool(os.getenv("ANTHROPIC_API_KEY"))

    def _get_client(self) -> Any | None:
        if self._client is not None:
            return self._client
        if not self.is_configured():
            return None
        try:
            from anthropic import Anthropic
        except ImportError:
            return None
        self._client = Anthropic()  # zero-arg: reads ANTHROPIC_API_KEY
        return self._client

    # -- prompt assembly ----------------------------------------------------- #
    @staticmethod
    def _render_grounding(facts: list[GroundingFact]) -> str:
        if not facts:
            return "(no grounding facts retrieved — do not state any specific fact, address, or number)"
        lines = []
        for i, f in enumerate(facts, 1):
            tag = f"[{i}] ({f.kind}"
            tag += f", {f.chain})" if f.chain else ")"
            lines.append(f"{tag} {f.text}  — source: {f.source}")
        return "\n".join(lines)

    def _build_user_prompt(
        self, topic: str, changelog: str | None, surface: str, facts: list[GroundingFact]
    ) -> str:
        parts = [
            f"SURFACE: {surface} (single X/Twitter post, tweet body <= 280 chars)",
            "",
            "BRIEF:",
            topic.strip(),
        ]
        if changelog:
            parts += ["", "CHANGELOG ENTRY (source material — do not exceed it):", changelog.strip()]
        parts += [
            "",
            "GROUNDING FACTS (the ONLY facts you may assert; cite by staying within them):",
            self._render_grounding(facts),
            "",
            "Write the tweet body now. Plain text only, <= 280 chars, no hashtags, no quotes.",
        ]
        return "\n".join(parts)

    def _call_claude(self, user_prompt: str) -> str:
        client = self._get_client()
        if client is None:
            raise RuntimeError("anthropic_not_configured")
        # Stream (long-generation safe) + adaptive thinking per house style.
        with client.messages.stream(
            model=MODEL,
            max_tokens=1024,
            thinking={"type": "adaptive"},
            system=BRAND_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            final = stream.get_final_message()
        chunks = [b.text for b in final.content if getattr(b, "type", None) == "text"]
        return "".join(chunks).strip()

    # -- post-processing ----------------------------------------------------- #
    @staticmethod
    def _extract_hashtags(text: str, chain: str | None) -> tuple[str, list[str]]:
        """Pull hashtags out of the body (voice keeps the body clean)."""
        tags = _HASHTAG_RE.findall(text)
        body = _HASHTAG_RE.sub("", text).strip()
        body = re.sub(r"\s{2,}", " ", body).strip(" -–—")
        if not tags:
            tags = list(DEFAULT_HASHTAGS)
        # de-dupe, preserve order
        seen: set[str] = set()
        ordered = []
        for t in tags:
            key = t.lower()
            if key not in seen:
                seen.add(key)
                ordered.append(t)
        return body, ordered

    # -- public API ---------------------------------------------------------- #
    def draft(
        self,
        topic: str,
        *,
        changelog: str | None = None,
        chain: str | None = None,
        surface: str = "tweet",
        top_k: int = 8,
    ) -> DraftResult:
        """Draft an X post. Never posts. Returns a grounded, validated draft."""
        # 1) prompt guardrail — hard-refuse before spending anything.
        prompt_check = guardrails.check_prompt(topic + " " + (changelog or ""))
        if not prompt_check.allowed:
            return DraftResult(
                ok=False,
                text="",
                reason="guardrail_refused",
                warnings=prompt_check.violations,
                surface=surface,
            )

        # 2) retrieve REAL grounding facts.
        facts = self._rag.retrieve(topic, top_k=top_k, chain=chain)
        pre_warnings: list[str] = []
        if _LIVE_STAT_HINT.search(topic + " " + (changelog or "")):
            pre_warnings.append(
                "brief references live/market stats (TVL/volume/price/APR); no "
                "live-data tool is wired, so the draft must not state such a "
                "number — verify none slipped in."
            )
        if not facts:
            pre_warnings.append("no grounding facts retrieved — draft will avoid specific claims")

        # 3) not-configured is honest, not a crash.
        client = self._get_client()
        if client is None:
            return DraftResult(
                ok=False,
                text="",
                reason="anthropic_not_configured",
                facts_used=[f.citation() for f in facts],
                warnings=pre_warnings
                + ["ANTHROPIC_API_KEY not set — cannot generate; grounding retrieved but no draft produced"],
                surface=surface,
            )

        # 4) generate.
        user_prompt = self._build_user_prompt(topic, changelog, surface, facts)
        try:
            raw = self._call_claude(user_prompt)
        except RuntimeError:
            return DraftResult(
                ok=False,
                text="",
                reason="anthropic_not_configured",
                facts_used=[f.citation() for f in facts],
                warnings=pre_warnings,
                surface=surface,
            )

        body, hashtags = self._extract_hashtags(raw, chain)

        # 5) post-generation facts-only + compliance validation.
        validation = guardrails.validate_draft(body, facts)
        warnings = pre_warnings + list(validation.warnings)

        return DraftResult(
            ok=validation.ok,
            text=body,
            facts_used=[f.citation() for f in facts],
            hashtags=hashtags,
            warnings=warnings,
            reason=None if validation.ok else "validation_flagged",
            model=MODEL,
            surface=surface,
        )
