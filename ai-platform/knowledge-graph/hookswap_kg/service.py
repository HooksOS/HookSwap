"""``KnowledgeGraph`` — the service façade over store + vector index.

Responsibilities
----------------
1. **Ingest-time**: idempotent ``upsert_entity`` / ``add_relationship`` with a cheap
   grounding guard (edge type must be modelled; nodes must pre-exist).
2. **Query-time traversal**: ``n_hop`` / ``shortest_path`` / ``neighborhood`` plus
   domain helpers (pools of a token, tokens of a pool, DEX of a pool, etc.).
3. **Graph⨝Vector fusion**: ``graph_augmented_retrieve`` runs a vector search, then
   *expands* each hit through its graph neighborhood, then *re-ranks* the fused
   candidate set. This is what makes answers both semantically relevant (vector) and
   structurally complete (graph) — e.g. a question about a pool also pulls in its
   two tokens, its DEX, and its chain even if those weren't in the top vector hits.

The service returns provenance (``sources``) with every entity so the agent layer can
emit citations and never fabricate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .schema import (
    Edge,
    EdgeType,
    Node,
    NodeType,
    Relationship,
    address_key,
    chain_key,
    edge_is_allowed,
)
from .store import GraphStore
from .vector import VectorHit, VectorIndex


@dataclass(slots=True)
class ScoredNode:
    node: Node
    score: float
    reason: str  # 'vector' | 'graph-expansion' | 'seed'
    hops_from_seed: int = 0


@dataclass(slots=True)
class GraphAugmentedResult:
    """Fused retrieval output handed to the RAG/agent layer."""

    query: str
    vector_hits: list[VectorHit]
    nodes: list[ScoredNode]
    edges: list[Edge]
    # flattened, de-duplicated provenance across every node/hit contributing to the answer
    citations: list[str] = field(default_factory=list)

    def context_block(self, max_nodes: int = 20) -> str:
        """Render a compact, citeable context string for an LLM prompt."""
        lines: list[str] = ["# Graph-augmented context"]
        if self.vector_hits:
            lines.append("\n## Retrieved passages")
            for h in self.vector_hits[:max_nodes]:
                cite = h.metadata.get("source") or h.id
                lines.append(f"- [{cite}] {h.text.strip()[:400]}")
        if self.nodes:
            lines.append("\n## Related graph entities")
            for sn in self.nodes[:max_nodes]:
                n = sn.node
                src = f" (sources: {', '.join(n.sources[:3])})" if n.sources else ""
                lines.append(
                    f"- {n.type.value} **{n.name}** [{n.key}] "
                    f"— via {sn.reason}, {sn.hops_from_seed} hop(s){src}"
                )
        return "\n".join(lines)


class KnowledgeGraph:
    """Graph service that fuses traversal with vector retrieval."""

    def __init__(self, store: GraphStore, vectors: Optional[VectorIndex] = None) -> None:
        self.store = store
        self.vectors = vectors

    # ------------------------------------------------------------------ #
    # Ingest                                                             #
    # ------------------------------------------------------------------ #
    async def upsert_entity(self, node: Node) -> Node:
        """Idempotently create/merge an entity. Provenance is unioned on conflict."""
        return await self.store.upsert_node(node)

    async def add_relationship(
        self,
        source: Node | str,
        edge_type: EdgeType,
        target: Node | str,
        *,
        weight: float = 1.0,
        properties: Optional[dict[str, Any]] = None,
        sources: Optional[list[str]] = None,
    ) -> Edge:
        """Create a typed edge. Rejects edges that aren't part of the schema.

        Endpoints may be ``Node`` instances (upserted first) or existing node ids.
        """
        src_node = await self._ensure_node(source)
        dst_node = await self._ensure_node(target)
        if not edge_is_allowed(edge_type, src_node.type, dst_node.type):
            raise ValueError(
                f"Edge {src_node.type.value} -{edge_type.value}-> {dst_node.type.value} "
                "is not a modelled relationship (grounding guard)."
            )
        edge = Edge(
            type=edge_type,
            source_id=src_node.id,
            target_id=dst_node.id,
            weight=weight,
            properties=properties or {},
            sources=sources or [],
        )
        return await self.store.upsert_edge(edge)

    async def _ensure_node(self, ref: Node | str) -> Node:
        if isinstance(ref, Node):
            return await self.store.upsert_node(ref)
        node = await self.store.get_node(ref)
        if node is None:
            raise KeyError(f"Node id not found: {ref}")
        return node

    # ------------------------------------------------------------------ #
    # Lookups                                                            #
    # ------------------------------------------------------------------ #
    async def get(self, node_id: str) -> Optional[Node]:
        return await self.store.get_node(node_id)

    async def find(
        self,
        *,
        type: Optional[NodeType] = None,
        chain_id: Optional[int] = None,
        name_contains: Optional[str] = None,
        limit: int = 100,
    ) -> list[Node]:
        return await self.store.find_nodes(
            type=type, chain_id=chain_id, name_contains=name_contains, limit=limit
        )

    async def resolve_onchain(self, chain_id: int, address: str, type: NodeType) -> Optional[Node]:
        """Look up an on-chain entity by its canonical ``chainId:address`` key."""
        from .schema import make_node_id

        node_id = make_node_id(type, address_key(chain_id, address))
        return await self.store.get_node(node_id)

    async def resolve_chain(self, chain_id: int) -> Optional[Node]:
        from .schema import make_node_id

        return await self.store.get_node(make_node_id(NodeType.CHAIN, chain_key(chain_id)))

    # ------------------------------------------------------------------ #
    # Traversal                                                          #
    # ------------------------------------------------------------------ #
    async def n_hop(
        self,
        start_id: str,
        *,
        hops: int = 2,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        limit: int = 500,
    ) -> tuple[list[Node], list[Edge]]:
        return await self.store.n_hop(
            start_id, hops=hops, edge_types=edge_types, direction=direction, limit=limit
        )

    async def shortest_path(
        self,
        start_id: str,
        end_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        max_hops: int = 8,
    ) -> Optional[list[Node]]:
        return await self.store.shortest_path(
            start_id, end_id, edge_types=edge_types, direction=direction, max_hops=max_hops
        )

    async def neighborhood(
        self,
        node_id: str,
        *,
        radius: int = 1,
        edge_types: Optional[list[EdgeType]] = None,
        limit: int = 200,
    ) -> tuple[list[Node], list[Edge]]:
        return await self.store.neighborhood(
            node_id, radius=radius, edge_types=edge_types, limit=limit
        )

    async def relationships(
        self,
        node_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
    ) -> list[Relationship]:
        """One-hop relationships as resolved ``Relationship`` records."""
        node = await self.store.get_node(node_id)
        if node is None:
            return []
        out: list[Relationship] = []
        for edge, neigh in await self.store.neighbors(
            node_id, edge_types=edge_types, direction=direction
        ):
            if edge.source_id == node_id:
                out.append(Relationship(edge=edge, source=node, target=neigh))
            else:
                out.append(Relationship(edge=edge, source=neigh, target=node))
        return out

    # -- domain helpers (named traversals the agents call) ----------------
    async def pool_tokens(self, pool_id: str) -> list[Node]:
        _, _ = pool_id, None
        return [
            n for e, n in await self.store.neighbors(
                pool_id, edge_types=[EdgeType.HAS_TOKEN], direction="out"
            )
        ]

    async def token_pools(self, token_id: str) -> list[Node]:
        return [
            n for e, n in await self.store.neighbors(
                token_id, edge_types=[EdgeType.HAS_TOKEN], direction="in"
            )
        ]

    async def chain_entities(self, chain_id: int, type: Optional[NodeType] = None) -> list[Node]:
        return await self.store.find_nodes(type=type, chain_id=chain_id, limit=1000)

    # ------------------------------------------------------------------ #
    # Graph ⨝ Vector fusion                                              #
    # ------------------------------------------------------------------ #
    async def graph_augmented_retrieve(
        self,
        query: str,
        *,
        top_k: int = 8,
        expand_hops: int = 1,
        expand_edge_types: Optional[list[EdgeType]] = None,
        graph_weight: float = 0.4,
        filters: Optional[dict[str, Any]] = None,
        max_nodes: int = 40,
    ) -> GraphAugmentedResult:
        """Fuse vector retrieval with graph expansion.

        Algorithm
        ---------
        1. **Vector search** ``query`` → ``top_k`` chunk hits (semantic recall).
        2. **Anchor** each hit to a graph node when it carries a ``node_id``.
        3. **Graph-expand** every anchor by ``expand_hops`` (structural recall):
           this pulls in the anchor's neighborhood (a pool's tokens/DEX/chain, a
           contract's protocol, a wallet's pools, …) that pure vector search misses.
        4. **Fuse & re-rank**: a node's score = its best vector score (if it was a
           direct hit) blended with a graph-proximity term
           ``graph_weight * decay(hops)`` so tightly-connected, on-topic entities
           surface even without their own embedding.
        5. **Collect provenance** from every contributing node/hit → ``citations``.

        Returns a :class:`GraphAugmentedResult` ready to render into an LLM context.
        """
        vector_hits: list[VectorHit] = []
        if self.vectors is not None:
            vector_hits = await self.vectors.search(query, top_k=top_k, filters=filters)

        scored: dict[str, ScoredNode] = {}
        collected_edges: dict[str, Edge] = {}

        # 1–2: seed nodes from vector hits
        seed_ids: list[str] = []
        for hit in vector_hits:
            if not hit.node_id:
                continue
            node = await self.store.get_node(hit.node_id)
            if node is None:
                continue
            seed_ids.append(node.id)
            prev = scored.get(node.id)
            base = hit.score
            if prev is None or base > prev.score:
                scored[node.id] = ScoredNode(
                    node=node, score=base, reason="vector", hops_from_seed=0
                )

        # If the query names entities but no vector index / no anchors, fall back to
        # a name search so the graph still contributes (grounded, never fabricated).
        if not seed_ids:
            for node in await self.store.find_nodes(name_contains=query.strip()[:40], limit=top_k):
                seed_ids.append(node.id)
                scored.setdefault(
                    node.id,
                    ScoredNode(node=node, score=0.5, reason="seed", hops_from_seed=0),
                )

        # 3–4: expand each seed and blend a graph-proximity score
        for sid in list(seed_ids):
            nodes, edges = await self.store.n_hop(
                sid,
                hops=expand_hops,
                edge_types=expand_edge_types,
                direction="both",
                limit=max_nodes,
            )
            for e in edges:
                collected_edges[e.id] = e
            for n in nodes:
                if n.id == sid:
                    continue
                # 1-hop → decay 0.5, 2-hop → 0.25, …
                hops = 1  # n_hop doesn't return per-node depth; treat expansion as 1 band
                proximity = graph_weight * (0.5 ** hops)
                prev = scored.get(n.id)
                if prev is None:
                    scored[n.id] = ScoredNode(
                        node=n, score=proximity, reason="graph-expansion", hops_from_seed=hops
                    )
                elif prev.reason != "vector":
                    prev.score = max(prev.score, proximity)

        ranked = sorted(scored.values(), key=lambda s: s.score, reverse=True)[:max_nodes]

        # 5: provenance
        citations: list[str] = []
        for h in vector_hits:
            src = h.metadata.get("source") or h.id
            if src not in citations:
                citations.append(src)
        for sn in ranked:
            for s in sn.node.sources:
                if s not in citations:
                    citations.append(s)

        return GraphAugmentedResult(
            query=query,
            vector_hits=vector_hits,
            nodes=ranked,
            edges=list(collected_edges.values()),
            citations=citations,
        )


__all__ = ["GraphAugmentedResult", "KnowledgeGraph", "ScoredNode"]
