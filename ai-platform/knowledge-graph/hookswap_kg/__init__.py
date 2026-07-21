"""HookSwap Knowledge Graph.

A graph layer that fuses **graph traversal** (n-hop neighborhoods, shortest paths)
with **vector retrieval** to power grounded, citation-backed answers across the
HookSwap multi-chain DEX.

Public surface
--------------
- ``schema``      — typed node/edge model (Pydantic v2) for the DeFi domain.
- ``store``       — ``GraphStore`` abstraction + Postgres / in-memory adapters.
- ``vector``      — ``VectorIndex`` abstraction over the platform ``VectorStore``.
- ``service``     — ``KnowledgeGraph`` façade: upsert, edges, traversal, and
                    ``graph_augmented_retrieve`` (graph ⨝ vector fusion).
- ``seed``        — HookSwap live-chain / DEX seed data.

Everything here is grounded: the graph only ever returns entities and edges that
were explicitly upserted from a real source (chain indexer, data-api, docs
ingestion). Nothing is fabricated at query time.
"""

from __future__ import annotations

from .schema import (
    Edge,
    EdgeType,
    Node,
    NodeType,
    Relationship,
)
from .service import GraphAugmentedResult, KnowledgeGraph
from .store import GraphStore, InMemoryGraphStore, PostgresGraphStore
from .vector import VectorHit, VectorIndex

__all__ = [
    "Edge",
    "EdgeType",
    "GraphAugmentedResult",
    "GraphStore",
    "InMemoryGraphStore",
    "KnowledgeGraph",
    "Node",
    "NodeType",
    "PostgresGraphStore",
    "Relationship",
    "VectorHit",
    "VectorIndex",
]

__version__ = "0.1.0"
