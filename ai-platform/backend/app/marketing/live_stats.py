"""Live-stats grounding tool for the HookSwap marketing bot.

Fetches REAL protocol stats (total TVL / 24h volume, USD) from the HookSwap
data-api (``{data_api_base_url}/v1/stats``) and turns them into grounding facts,
so that any live number a post cites traces to the API — never the model's
imagination.

FACTS-ONLY (hard rule): this NEVER fabricates a number. On ANY failure —
``httpx`` not installed, network error, non-200, unparseable body, empty or
zero-valued series — it returns NO facts, and the assistant + guardrails then
guarantee the draft omits the stat. A fact is emitted only when a concrete,
finite, POSITIVE USD value is parsed from the real response.

The ``/v1/stats`` payload is the protobuf-JSON of ``ProtocolStatsResponse``
(``data-api/src/exploreStatsHandlers.ts``)::

    {
      "dailyProtocolTvl":        {"v2": [{"currency":"USD","timestamp":N,"value":X}], "v3": [], "v4": []},
      "historicalProtocolVolume":{"Month": {"v2": [...]}, "Year": {...}, "Max": {...}}
    }

The parser walks it defensively (case-insensitive bucket lookup, finite-number
guards) so a shape drift degrades to "omit", never to a wrong number.
"""
from __future__ import annotations

import math
from typing import Any

from .rag_port import GroundingFact

# HookSwap live chains (slug -> numeric chain id the data-api expects). A slug
# not in this map -> no chainId param -> all-networks aggregate (still real).
_CHAIN_ID_BY_SLUG: dict[str, int] = {
    "robinhood": 4663,
    "megaeth": 4326,
    "ink": 57073,
    "xlayer": 196,
    "hyperevm": 999,
    "tempo": 4217,
    "stable": 988,
    "sepolia": 11155111,
}


def _latest_value(series: Any) -> float | None:
    """Latest (max-timestamp) finite ``value`` from a proto point series, or None."""
    if not isinstance(series, list) or not series:
        return None
    best_ts: float | None = None
    best_val: float | None = None
    for pt in series:
        if not isinstance(pt, dict):
            continue
        try:
            v = float(pt.get("value"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(v):
            continue
        try:
            ts = float(pt.get("timestamp", 0) or 0)
        except (TypeError, ValueError):
            ts = 0.0
        if best_ts is None or ts >= best_ts:
            best_ts, best_val = ts, v
    return best_val


def _split_latest(split: Any) -> float | None:
    """Sum the latest point of each non-empty v2/v3/v4 series in a VolumeSplit/TVL."""
    if not isinstance(split, dict):
        return None
    total = 0.0
    found = False
    for key in ("v2", "v3", "v4"):
        val = _latest_value(split.get(key))
        if val is not None:
            total += val
            found = True
    return total if found else None


def _find_key(d: Any, name: str) -> Any:
    """Case-insensitive key lookup (proto JSON bucket names are Month/Year/Max)."""
    if not isinstance(d, dict):
        return None
    for k, v in d.items():
        if isinstance(k, str) and k.lower() == name.lower():
            return v
    return None


def _usd_forms(v: float) -> list[str]:
    """Faithful string forms of one real USD value, so the guardrail grounds
    whichever the model reproduces ($1,234,567.00 / $1,234,567 / $1.23M)."""
    forms: list[str] = [f"${v:,.2f}", f"${int(round(v)):,}"]
    if v >= 1_000_000:
        forms.append(f"${v / 1_000_000:.2f}M")
    elif v >= 1_000:
        forms.append(f"${v / 1_000:.2f}K")
    seen: set[str] = set()
    out: list[str] = []
    for f in forms:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def _usd_phrase(v: float) -> str:
    forms = _usd_forms(v)
    lead = forms[-1]  # compact (M/K) leads for readability
    extras = [f for f in forms if f != lead]
    return lead + (f" (exactly {', '.join(extras)})" if extras else "")


class LiveStatsClient:
    """Fetches real protocol TVL / 24h volume from the data-api as grounding facts."""

    def __init__(self, base_url: str = "https://data.hookswap.org", timeout_s: float = 6.0) -> None:
        self._base = base_url.rstrip("/")
        self._timeout = timeout_s

    def fetch(self, chain: str | None = None) -> list[GroundingFact]:
        """Return grounded TVL/volume facts, or [] on any failure (never raises)."""
        try:
            import httpx  # lazy: leaf import must not require httpx
        except ImportError:
            return []

        url = self._base + "/v1/stats"
        cid = _CHAIN_ID_BY_SLUG.get((chain or "").lower().strip()) if chain else None
        params = {"chainId": str(cid)} if cid else {}
        try:
            resp = httpx.get(url, params=params, timeout=self._timeout)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            return []
        if not isinstance(data, dict):
            return []

        scope = chain if chain else "all HookSwap chains"
        source = url + (f"?chainId={cid}" if cid else "")
        facts: list[GroundingFact] = []

        tvl = _split_latest(data.get("dailyProtocolTvl"))
        if tvl is not None and math.isfinite(tvl) and tvl > 0:
            facts.append(
                GroundingFact(
                    text=(
                        f"HookSwap protocol TVL across live v2 pools ({scope}) is "
                        f"{_usd_phrase(tvl)} — real-time from the data-api."
                    ),
                    source=source,
                    kind="stat",
                    chain=chain,
                )
            )

        vol_bucket = (
            _find_key(data.get("historicalProtocolVolume"), "Max")
            or _find_key(data.get("historicalProtocolVolume"), "Year")
            or _find_key(data.get("historicalProtocolVolume"), "Month")
        )
        vol = _split_latest(vol_bucket)
        if vol is not None and math.isfinite(vol) and vol > 0:
            facts.append(
                GroundingFact(
                    text=(
                        f"HookSwap 24h trading volume across live v2 pools ({scope}) is "
                        f"{_usd_phrase(vol)} — real-time from the data-api."
                    ),
                    source=source,
                    kind="stat",
                    chain=chain,
                )
            )
        return facts


def get_live_stats_provider() -> LiveStatsClient | None:
    """Config-driven live-stats provider, or None when disabled.

    Reads ``marketing_live_stats_enabled`` + ``data_api_base_url`` from Settings;
    degrades to a default client if Settings can't be loaded.
    """
    try:
        from app.core.config import get_settings

        s = get_settings()
        if not s.marketing_live_stats_enabled:
            return None
        return LiveStatsClient(base_url=s.data_api_base_url, timeout_s=s.marketing_live_stats_timeout_s)
    except Exception:
        return LiveStatsClient()
