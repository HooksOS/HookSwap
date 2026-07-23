"""Guardrails for HookSwap marketing generation (facts-only + compliance).

Two enforcement points, mirroring docs/marketing-rag-spec.md §5:

  * ``check_prompt`` — pre-generation. Hard-refuses briefs that ask for a price
    prediction / target / financial advice / a guaranteed yield, before any
    tokens are spent.
  * ``validate_draft`` — post-generation. Regex/pattern-scans the model's output
    and flags: any number / % / $-figure not present in the turn's grounding
    (or a quotable fee tier); any 0x contract address not present verbatim in
    grounding; banned claims (hooks, v4, "audited", guaranteed returns); advice
    / price-prediction language; and over-length tweet bodies.

FACTS-ONLY is the north star: a stat or address the bot cannot ground is a
production defect, not a style miss. The validator makes that structural.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from .rag_port import GroundingFact

TWEET_LIMIT = 280

# Fee tiers are stable, doc-defined facts the bot may quote without a live tool
# call (marketing-rag-spec.md §5.2). Everything else numeric must be grounded.
QUOTABLE_FEE_STRINGS = {"0.01%", "0.05%", "0.30%", "0.3%", "1.00%", "1%"}

# --- compliance patterns (hard-refuse on the prompt) ------------------------- #
_PRICE_PREDICTION = re.compile(
    r"\b(price\s+(target|prediction|forecast)|"
    r"(will|gonna|going\s+to)\s+(hit|reach|moon|pump|dump|explode|skyrocket|"
    r"\d+\s*x|\$)|"
    r"to\s+the\s+moon|"
    r"\d+\s*x\b|"
    r"(guarantee\w*|promised?)\s+(return|profit|gain|yield|apy|apr)|"
    r"how\s+high\s+will|when\s+(moon|lambo)|"
    r"predict\s+(the\s+)?price)\b",
    re.IGNORECASE,
)
_FINANCIAL_ADVICE = re.compile(
    r"\b(you\s+should\s+(buy|sell|ape|invest|allocate)|"
    r"(great|good|best)\s+(entry|buy|time\s+to\s+buy)|"
    r"financial\s+advice|"
    r"(buy|sell)\s+now|"
    r"投资建议)\b",
    re.IGNORECASE,
)

# --- banned claims (scanned in the OUTPUT) ---------------------------------- #
_BANNED_OUTPUT = {
    "hooks": re.compile(r"\bhooks?\b", re.IGNORECASE),
    "v4": re.compile(r"\bv4\b", re.IGNORECASE),
    "audited": re.compile(r"\baudit(ed|s)?\b", re.IGNORECASE),
    "guaranteed_yield": re.compile(
        r"\bguarantee\w*\s+(return|profit|gain|yield|apy|apr|income)\b", re.IGNORECASE
    ),
}

# --- fact extraction --------------------------------------------------------- #
_ADDRESS_RE = re.compile(r"0x[a-fA-F0-9]{40}")
# numbers: $1,234.5 | 12.5% | 4663 | 1.00 — captured with any leading $ and
# trailing %. Used to diff draft figures against grounded figures.
_NUMBER_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?%?")


@dataclass
class PromptCheck:
    allowed: bool
    violations: list[str] = field(default_factory=list)


@dataclass
class DraftValidation:
    ok: bool
    warnings: list[str] = field(default_factory=list)
    ungrounded_numbers: list[str] = field(default_factory=list)
    ungrounded_addresses: list[str] = field(default_factory=list)
    banned_claims: list[str] = field(default_factory=list)


def check_prompt(topic: str) -> PromptCheck:
    """Pre-generation refusal gate for compliance-violating briefs."""
    violations: list[str] = []
    if _PRICE_PREDICTION.search(topic):
        violations.append(
            "refused: brief asks for a price prediction/target — HookSwap Desk "
            "Writer does not predict or speculate on token value."
        )
    if _FINANCIAL_ADVICE.search(topic):
        violations.append(
            "refused: brief asks for financial/investment advice — not permitted."
        )
    return PromptCheck(allowed=not violations, violations=violations)


def _normalize_number(tok: str) -> str:
    return tok.replace(",", "").rstrip(".").lower()


def _grounded_number_set(facts: Iterable[GroundingFact]) -> set[str]:
    grounded: set[str] = set()
    for fact in facts:
        for tok in _NUMBER_RE.findall(fact.text):
            grounded.add(_normalize_number(tok))
    for fee in QUOTABLE_FEE_STRINGS:
        grounded.add(_normalize_number(fee))
    return grounded


def _grounded_address_set(facts: Iterable[GroundingFact]) -> set[str]:
    grounded: set[str] = set()
    for fact in facts:
        for addr in _ADDRESS_RE.findall(fact.text):
            grounded.add(addr.lower())
    return grounded


def validate_draft(text: str, facts: Iterable[GroundingFact]) -> DraftValidation:
    """Post-generation facts-only + compliance scan of a drafted tweet body."""
    facts = list(facts)
    warnings: list[str] = []

    grounded_numbers = _grounded_number_set(facts)
    grounded_addresses = _grounded_address_set(facts)

    # 1) ungrounded numeric stats
    ungrounded_numbers: list[str] = []
    for tok in _NUMBER_RE.findall(text):
        norm = _normalize_number(tok)
        if not norm or norm in {"", "."}:
            continue
        # bare small integers with no $/% that are part of grounded facts pass;
        # everything must trace to grounding or a quotable fee tier.
        if norm not in grounded_numbers:
            ungrounded_numbers.append(tok)
    if ungrounded_numbers:
        warnings.append(
            "ungrounded number(s) not present in grounding/tool output: "
            + ", ".join(sorted(set(ungrounded_numbers)))
        )

    # 2) ungrounded contract addresses
    ungrounded_addresses: list[str] = []
    for addr in _ADDRESS_RE.findall(text):
        if addr.lower() not in grounded_addresses:
            ungrounded_addresses.append(addr)
    if ungrounded_addresses:
        warnings.append(
            "ungrounded contract address(es) not present verbatim in grounding: "
            + ", ".join(sorted(set(ungrounded_addresses)))
        )

    # 3) banned claims
    banned: list[str] = []
    for label, pattern in _BANNED_OUTPUT.items():
        if pattern.search(text):
            banned.append(label)
    if banned:
        warnings.append("banned claim(s) present (LOCKED no-v4/no-hooks/no-audit): " + ", ".join(banned))

    # 4) advice / price-prediction language leaking into the output
    if _PRICE_PREDICTION.search(text) or _FINANCIAL_ADVICE.search(text):
        warnings.append("advice/price-prediction language present in draft")

    # 5) length
    if len(text) > TWEET_LIMIT:
        warnings.append(f"tweet body exceeds {TWEET_LIMIT} chars ({len(text)})")

    ok = not (ungrounded_numbers or ungrounded_addresses or banned)
    return DraftValidation(
        ok=ok,
        warnings=warnings,
        ungrounded_numbers=ungrounded_numbers,
        ungrounded_addresses=ungrounded_addresses,
        banned_claims=banned,
    )
