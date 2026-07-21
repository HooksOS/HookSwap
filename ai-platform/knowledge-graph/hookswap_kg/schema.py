"""Knowledge-graph schema — typed nodes and edges for the HookSwap domain.

The graph is a **property graph**: every node and edge carries a typed label plus
a free-form ``properties`` bag. Node identity is ``(type, key)`` where ``key`` is a
stable, source-derived natural identifier (e.g. a checksummed address + chainId for
on-chain entities, a slug for off-chain ones). This lets ingestion **upsert
idempotently** from many sources without minting duplicate nodes.

Design rules
------------
- **Grounded identity.** A node's ``key`` must be derivable from a real source. We
  never invent addresses; on-chain nodes are keyed by ``chainId:address``.
- **Typed edges.** Relationships use a closed ``EdgeType`` enum so traversal queries
  and the fusion layer can reason about semantics (e.g. only follow ``CONTAINS`` to
  go DEX→Pool).
- **Provenance.** Every node/edge records ``sources`` (source doc / tx / api ids) so
  answers built on the graph can cite where a fact came from.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Node & edge type vocabularies                                               #
# --------------------------------------------------------------------------- #
class NodeType(str, Enum):
    """The entity types modelled in the HookSwap knowledge graph."""

    CHAIN = "Chain"
    PROTOCOL = "Protocol"
    DEX = "DEX"
    TOKEN = "Token"
    POOL = "Pool"
    WALLET = "Wallet"
    DEVELOPER = "Developer"
    PROJECT = "Project"
    GOVERNANCE = "Governance"
    CAMPAIGN = "Campaign"
    PARTNER = "Partner"
    USER = "User"
    SMART_CONTRACT = "SmartContract"
    BRIDGE = "Bridge"
    # supporting node used to link narrative/document knowledge into the graph
    DOCUMENT = "Document"


class EdgeType(str, Enum):
    """Typed, directed relationships. Read as ``(source) -EDGE-> (target)``."""

    # topology / deployment
    DEPLOYED_ON = "DEPLOYED_ON"          # DEX/Protocol/SmartContract/Token -> Chain
    CONNECTS = "CONNECTS"                # Bridge -> Chain (both endpoints)
    CONTAINS = "CONTAINS"               # DEX -> Pool ; Protocol -> SmartContract
    IMPLEMENTS = "IMPLEMENTS"           # SmartContract -> Protocol (e.g. UR impl of routing)
    # pool composition & pricing
    HAS_TOKEN = "HAS_TOKEN"             # Pool -> Token (each side of the pair)
    WRAPS = "WRAPS"                     # Token(WETH) -> Chain native / Token
    PRICED_AGAINST = "PRICED_AGAINST"   # Token -> Token (anchor/quote asset)
    # actors
    PROVIDES_LIQUIDITY = "PROVIDES_LIQUIDITY"  # Wallet/User -> Pool
    SWAPPED_ON = "SWAPPED_ON"           # Wallet/User -> Pool/DEX
    HOLDS = "HOLDS"                     # Wallet/User -> Token
    DEPLOYED = "DEPLOYED"               # Developer -> SmartContract/Project
    MAINTAINS = "MAINTAINS"             # Developer -> Project
    OWNS_WALLET = "OWNS_WALLET"         # User -> Wallet
    # governance & growth
    GOVERNS = "GOVERNS"                 # Governance -> Protocol/DEX
    PROPOSED = "PROPOSED"               # Wallet/User -> Governance (proposal)
    VOTED_ON = "VOTED_ON"               # Wallet/User -> Governance
    RUNS_CAMPAIGN = "RUNS_CAMPAIGN"     # Project/DEX -> Campaign
    TARGETS = "TARGETS"                 # Campaign -> Chain/Pool/Token
    PARTNERED_WITH = "PARTNERED_WITH"   # DEX/Project <-> Partner
    INTEGRATES = "INTEGRATES"           # Project -> Protocol/DEX/SmartContract
    # knowledge linkage
    DOCUMENTS = "DOCUMENTS"             # Document -> any node (this doc describes X)
    REFERENCES = "REFERENCES"           # any -> any (weak association)
    SIMILAR_TO = "SIMILAR_TO"           # any -> any (vector-derived neighbor)


# Which (source_type -> edge -> target_type) combinations are semantically valid.
# Used by the service to reject nonsense edges early (a cheap grounding guard).
_ALLOWED: dict[EdgeType, set[tuple[NodeType, NodeType]]] = {
    EdgeType.DEPLOYED_ON: {
        (NodeType.DEX, NodeType.CHAIN),
        (NodeType.PROTOCOL, NodeType.CHAIN),
        (NodeType.SMART_CONTRACT, NodeType.CHAIN),
        (NodeType.TOKEN, NodeType.CHAIN),
        (NodeType.POOL, NodeType.CHAIN),
        (NodeType.PROJECT, NodeType.CHAIN),
        (NodeType.BRIDGE, NodeType.CHAIN),
    },
    EdgeType.CONNECTS: {(NodeType.BRIDGE, NodeType.CHAIN)},
    EdgeType.CONTAINS: {
        (NodeType.DEX, NodeType.POOL),
        (NodeType.PROTOCOL, NodeType.SMART_CONTRACT),
        (NodeType.DEX, NodeType.SMART_CONTRACT),
    },
    EdgeType.IMPLEMENTS: {
        (NodeType.SMART_CONTRACT, NodeType.PROTOCOL),
        (NodeType.DEX, NodeType.PROTOCOL),
    },
    EdgeType.HAS_TOKEN: {(NodeType.POOL, NodeType.TOKEN)},
    EdgeType.WRAPS: {(NodeType.TOKEN, NodeType.CHAIN), (NodeType.TOKEN, NodeType.TOKEN)},
    EdgeType.PRICED_AGAINST: {(NodeType.TOKEN, NodeType.TOKEN)},
    EdgeType.PROVIDES_LIQUIDITY: {
        (NodeType.WALLET, NodeType.POOL),
        (NodeType.USER, NodeType.POOL),
    },
    EdgeType.SWAPPED_ON: {
        (NodeType.WALLET, NodeType.POOL),
        (NodeType.WALLET, NodeType.DEX),
        (NodeType.USER, NodeType.POOL),
        (NodeType.USER, NodeType.DEX),
    },
    EdgeType.HOLDS: {(NodeType.WALLET, NodeType.TOKEN), (NodeType.USER, NodeType.TOKEN)},
    EdgeType.DEPLOYED: {
        (NodeType.DEVELOPER, NodeType.SMART_CONTRACT),
        (NodeType.DEVELOPER, NodeType.PROJECT),
    },
    EdgeType.MAINTAINS: {(NodeType.DEVELOPER, NodeType.PROJECT)},
    EdgeType.OWNS_WALLET: {(NodeType.USER, NodeType.WALLET)},
    EdgeType.GOVERNS: {
        (NodeType.GOVERNANCE, NodeType.PROTOCOL),
        (NodeType.GOVERNANCE, NodeType.DEX),
    },
    EdgeType.PROPOSED: {(NodeType.WALLET, NodeType.GOVERNANCE), (NodeType.USER, NodeType.GOVERNANCE)},
    EdgeType.VOTED_ON: {(NodeType.WALLET, NodeType.GOVERNANCE), (NodeType.USER, NodeType.GOVERNANCE)},
    EdgeType.RUNS_CAMPAIGN: {
        (NodeType.PROJECT, NodeType.CAMPAIGN),
        (NodeType.DEX, NodeType.CAMPAIGN),
    },
    EdgeType.TARGETS: {
        (NodeType.CAMPAIGN, NodeType.CHAIN),
        (NodeType.CAMPAIGN, NodeType.POOL),
        (NodeType.CAMPAIGN, NodeType.TOKEN),
    },
    EdgeType.PARTNERED_WITH: {
        (NodeType.DEX, NodeType.PARTNER),
        (NodeType.PROJECT, NodeType.PARTNER),
        (NodeType.PARTNER, NodeType.DEX),
        (NodeType.PARTNER, NodeType.PROJECT),
    },
    EdgeType.INTEGRATES: {
        (NodeType.PROJECT, NodeType.PROTOCOL),
        (NodeType.PROJECT, NodeType.DEX),
        (NodeType.PROJECT, NodeType.SMART_CONTRACT),
    },
    # DOCUMENTS / REFERENCES / SIMILAR_TO are intentionally unconstrained.
}


def edge_is_allowed(edge: EdgeType, src: NodeType, dst: NodeType) -> bool:
    """Return True if ``src -edge-> dst`` is a modelled relationship.

    ``DOCUMENTS``, ``REFERENCES`` and ``SIMILAR_TO`` are always allowed (they link
    arbitrary knowledge/vector neighbors). Everything else must be whitelisted.
    """
    if edge in (EdgeType.DOCUMENTS, EdgeType.REFERENCES, EdgeType.SIMILAR_TO):
        return True
    return (src, dst) in _ALLOWED.get(edge, set())


# --------------------------------------------------------------------------- #
# Core models                                                                 #
# --------------------------------------------------------------------------- #
def make_node_id(node_type: NodeType, key: str) -> str:
    """Deterministic node id from ``(type, key)``.

    Stable across ingestion runs so upserts converge instead of duplicating.
    """
    raw = f"{node_type.value}:{key.strip().lower()}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]  # noqa: S324 (id, not security)
    return f"{node_type.value.lower()}_{digest}"


class Node(BaseModel):
    """A typed entity in the graph."""

    id: str = Field(default="", description="Deterministic id derived from (type, key).")
    type: NodeType
    key: str = Field(..., description="Stable natural id, e.g. '4663:0xabc…' or 'hookswap-dex'.")
    name: str = Field(..., description="Human-readable label.")
    chain_id: Optional[int] = Field(
        default=None, description="For on-chain entities: the HookSwap chainId it lives on."
    )
    properties: dict[str, Any] = Field(default_factory=dict)
    sources: list[str] = Field(
        default_factory=list,
        description="Provenance: source/doc/tx/api ids that asserted this node.",
    )
    # optional embedding pointer — the vector lives in the VectorStore, not here
    embedding_ref: Optional[str] = Field(
        default=None, description="Vector-store id for this node's text embedding, if indexed."
    )
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @field_validator("id", mode="before")
    @classmethod
    def _default_id(cls, v: str, info: Any) -> str:  # noqa: ANN401
        if v:
            return v
        data = info.data
        if "type" in data and "key" in data:
            return make_node_id(NodeType(data["type"]), str(data["key"]))
        return v

    def model_post_init(self, __context: Any) -> None:  # noqa: ANN401, D401
        if not self.id:
            object.__setattr__(self, "id", make_node_id(self.type, self.key))


class Edge(BaseModel):
    """A typed, directed relationship between two nodes (by id)."""

    id: str = Field(default="")
    type: EdgeType
    source_id: str
    target_id: str
    weight: float = Field(default=1.0, description="Traversal cost basis / edge strength.")
    properties: dict[str, Any] = Field(default_factory=dict)
    sources: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    def model_post_init(self, __context: Any) -> None:  # noqa: ANN401
        if not self.id:
            raw = f"{self.source_id}|{self.type.value}|{self.target_id}"
            digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]  # noqa: S324
            object.__setattr__(self, "id", f"e_{digest}")


class Relationship(BaseModel):
    """A resolved edge with its endpoint nodes attached (traversal output)."""

    edge: Edge
    source: Node
    target: Node


# --------------------------------------------------------------------------- #
# Convenience constructors for the common on-chain entity types               #
# --------------------------------------------------------------------------- #
def chain_key(chain_id: int) -> str:
    return f"chain:{chain_id}"


def address_key(chain_id: int, address: str) -> str:
    """Canonical key for any on-chain entity: ``<chainId>:<lowercased address>``."""
    return f"{chain_id}:{address.strip().lower()}"


__all__ = [
    "Edge",
    "EdgeType",
    "Node",
    "NodeType",
    "Relationship",
    "address_key",
    "chain_key",
    "edge_is_allowed",
    "make_node_id",
]
