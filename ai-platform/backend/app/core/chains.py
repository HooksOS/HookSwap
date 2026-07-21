"""HookSwap chain registry.

Registry + adapter pattern (README §"Chain registry"): the platform is only
"live" on the chains below, but new chains are added by config alone. This
mirrors the DEX's ``contracts/deployments/*.json`` and the shared
``packages/chains/chains.ts``. Retrieval + live-data tools are chain-aware and
resolve chains through this single source of truth.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class ChainId(IntEnum):
    ROBINHOOD = 4663
    HYPEREVM = 999
    INK = 57073
    MEGAETH = 4326
    XLAYER = 196
    TEMPO = 4217
    SEPOLIA = 11155111


@dataclass(frozen=True, slots=True)
class ChainInfo:
    chain_id: ChainId
    slug: str
    name: str
    native_symbol: str
    is_testnet: bool = False
    is_validation_chain: bool = False
    gas_token: str | None = None  # when gas is paid in a non-native ERC-20
    aliases: tuple[str, ...] = field(default_factory=tuple)


# The live registry. Order = display/priority order (Robinhood primary).
CHAINS: dict[ChainId, ChainInfo] = {
    ChainId.ROBINHOOD: ChainInfo(
        ChainId.ROBINHOOD, "robinhood", "Robinhood Chain", "ETH",
        aliases=("robinhoodchain", "rh"),
    ),
    ChainId.HYPEREVM: ChainInfo(
        ChainId.HYPEREVM, "hyperevm", "HyperEVM", "HYPE",
        aliases=("hyperliquid", "hyper"),
    ),
    ChainId.INK: ChainInfo(ChainId.INK, "ink", "Ink", "ETH"),
    ChainId.MEGAETH: ChainInfo(ChainId.MEGAETH, "megaeth", "MegaETH", "ETH"),
    ChainId.XLAYER: ChainInfo(
        ChainId.XLAYER, "xlayer", "X Layer", "OKB", gas_token="OKB",
        aliases=("okx", "oklayer"),
    ),
    ChainId.TEMPO: ChainInfo(
        ChainId.TEMPO, "tempo", "Tempo", "pathUSD", gas_token="pathUSD",
    ),
    ChainId.SEPOLIA: ChainInfo(
        ChainId.SEPOLIA, "sepolia", "Sepolia", "ETH",
        is_testnet=True, is_validation_chain=True,
    ),
}

# slug/alias -> ChainId lookup, built once.
_SLUG_INDEX: dict[str, ChainId] = {}
for _info in CHAINS.values():
    _SLUG_INDEX[_info.slug] = _info.chain_id
    _SLUG_INDEX[str(_info.chain_id.value)] = _info.chain_id
    for _alias in _info.aliases:
        _SLUG_INDEX[_alias] = _info.chain_id


def resolve_chain(value: str | int | None) -> ChainInfo | None:
    """Resolve a chain from an id, slug, or alias. Returns None if unknown."""
    if value is None:
        return None
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        try:
            return CHAINS.get(ChainId(int(value)))
        except ValueError:
            return None
    cid = _SLUG_INDEX.get(str(value).strip().lower())
    return CHAINS.get(cid) if cid else None


def all_chain_ids() -> list[int]:
    return [c.value for c in CHAINS]


def is_supported(value: str | int | None) -> bool:
    return resolve_chain(value) is not None
