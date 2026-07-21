"""Graph persistence layer.

``GraphStore`` is the storage abstraction. Two adapters ship:

- ``InMemoryGraphStore`` — adjacency-list store with pure-Python BFS/Dijkstra. Zero
  infra; used for dev, tests, and as the reference semantics for traversal.
- ``PostgresGraphStore`` — backs the graph on the platform's existing PostgreSQL
  (``nodes`` / ``edges`` tables) and does n-hop / shortest-path traversal with
  **recursive CTEs**. Chosen as the default (see knowledge-graph/README.md): the
  platform already runs Postgres + pgvector, so co-locating the graph and the vectors
  in one store makes graph⨝vector fusion a single transaction and avoids a second
  operational system. A ``Neo4jGraphStore`` can implement the same ABC if native
  graph performance is later required.

All adapters share identical method semantics so the ``KnowledgeGraph`` service is
storage-agnostic.
"""

from __future__ import annotations

import heapq
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from typing import Any, Iterable, Optional

from .schema import Edge, EdgeType, Node, NodeType


# --------------------------------------------------------------------------- #
# Abstract store                                                              #
# --------------------------------------------------------------------------- #
class GraphStore(ABC):
    """Storage + traversal contract. Adapters must preserve these semantics."""

    # -- writes --
    @abstractmethod
    async def upsert_node(self, node: Node) -> Node: ...

    @abstractmethod
    async def upsert_edge(self, edge: Edge) -> Edge: ...

    # -- point reads --
    @abstractmethod
    async def get_node(self, node_id: str) -> Optional[Node]: ...

    @abstractmethod
    async def get_nodes(self, node_ids: Iterable[str]) -> dict[str, Node]: ...

    @abstractmethod
    async def find_nodes(
        self,
        *,
        type: Optional[NodeType] = None,
        chain_id: Optional[int] = None,
        name_contains: Optional[str] = None,
        limit: int = 100,
    ) -> list[Node]: ...

    # -- adjacency --
    @abstractmethod
    async def neighbors(
        self,
        node_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",  # 'out' | 'in' | 'both'
    ) -> list[tuple[Edge, Node]]:
        """Return ``(edge, neighbor_node)`` pairs incident to ``node_id``."""
        ...

    # -- traversal --
    @abstractmethod
    async def n_hop(
        self,
        start_id: str,
        *,
        hops: int,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        limit: int = 500,
    ) -> tuple[list[Node], list[Edge]]:
        """Breadth-first expansion up to ``hops`` from ``start_id``."""
        ...

    @abstractmethod
    async def shortest_path(
        self,
        start_id: str,
        end_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        max_hops: int = 8,
    ) -> Optional[list[Node]]:
        """Lowest-cost path (by edge weight) from ``start_id`` to ``end_id`` or ``None``."""
        ...

    async def neighborhood(
        self,
        node_id: str,
        *,
        radius: int = 1,
        edge_types: Optional[list[EdgeType]] = None,
        limit: int = 200,
    ) -> tuple[list[Node], list[Edge]]:
        """Undirected subgraph within ``radius`` hops (default one-hop neighborhood)."""
        return await self.n_hop(
            node_id, hops=radius, edge_types=edge_types, direction="both", limit=limit
        )


# --------------------------------------------------------------------------- #
# In-memory adapter                                                           #
# --------------------------------------------------------------------------- #
class InMemoryGraphStore(GraphStore):
    """Adjacency-list graph in process memory. Reference traversal implementation."""

    def __init__(self) -> None:
        self._nodes: dict[str, Node] = {}
        self._edges: dict[str, Edge] = {}
        self._out: dict[str, list[str]] = defaultdict(list)  # node_id -> edge_ids
        self._in: dict[str, list[str]] = defaultdict(list)

    async def upsert_node(self, node: Node) -> Node:
        existing = self._nodes.get(node.id)
        if existing:
            # merge properties + provenance; keep earliest created_at
            merged_props = {**existing.properties, **node.properties}
            merged_sources = list(dict.fromkeys([*existing.sources, *node.sources]))
            node = existing.model_copy(
                update={
                    "name": node.name or existing.name,
                    "chain_id": node.chain_id if node.chain_id is not None else existing.chain_id,
                    "properties": merged_props,
                    "sources": merged_sources,
                    "embedding_ref": node.embedding_ref or existing.embedding_ref,
                    "updated_at": node.updated_at,
                }
            )
        self._nodes[node.id] = node
        return node

    async def upsert_edge(self, edge: Edge) -> Edge:
        existing = self._edges.get(edge.id)
        if existing:
            edge = existing.model_copy(
                update={
                    "weight": edge.weight,
                    "properties": {**existing.properties, **edge.properties},
                    "sources": list(dict.fromkeys([*existing.sources, *edge.sources])),
                    "updated_at": edge.updated_at,
                }
            )
        self._edges[edge.id] = edge
        if edge.id not in self._out[edge.source_id]:
            self._out[edge.source_id].append(edge.id)
        if edge.id not in self._in[edge.target_id]:
            self._in[edge.target_id].append(edge.id)
        return edge

    async def get_node(self, node_id: str) -> Optional[Node]:
        return self._nodes.get(node_id)

    async def get_nodes(self, node_ids: Iterable[str]) -> dict[str, Node]:
        return {nid: self._nodes[nid] for nid in node_ids if nid in self._nodes}

    async def find_nodes(
        self,
        *,
        type: Optional[NodeType] = None,
        chain_id: Optional[int] = None,
        name_contains: Optional[str] = None,
        limit: int = 100,
    ) -> list[Node]:
        out: list[Node] = []
        needle = name_contains.lower() if name_contains else None
        for n in self._nodes.values():
            if type is not None and n.type != type:
                continue
            if chain_id is not None and n.chain_id != chain_id:
                continue
            if needle is not None and needle not in n.name.lower() and needle not in n.key.lower():
                continue
            out.append(n)
            if len(out) >= limit:
                break
        return out

    def _incident_edge_ids(self, node_id: str, direction: str) -> list[str]:
        if direction == "out":
            return list(self._out[node_id])
        if direction == "in":
            return list(self._in[node_id])
        return list(self._out[node_id]) + list(self._in[node_id])

    async def neighbors(
        self,
        node_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
    ) -> list[tuple[Edge, Node]]:
        allowed = set(edge_types) if edge_types else None
        out: list[tuple[Edge, Node]] = []
        for eid in self._incident_edge_ids(node_id, direction):
            edge = self._edges[eid]
            if allowed and edge.type not in allowed:
                continue
            other_id = edge.target_id if edge.source_id == node_id else edge.source_id
            other = self._nodes.get(other_id)
            if other:
                out.append((edge, other))
        return out

    async def n_hop(
        self,
        start_id: str,
        *,
        hops: int,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        limit: int = 500,
    ) -> tuple[list[Node], list[Edge]]:
        if start_id not in self._nodes:
            return [], []
        seen_nodes: dict[str, Node] = {start_id: self._nodes[start_id]}
        seen_edges: dict[str, Edge] = {}
        frontier: deque[tuple[str, int]] = deque([(start_id, 0)])
        while frontier:
            nid, depth = frontier.popleft()
            if depth >= hops:
                continue
            for edge, neigh in await self.neighbors(
                nid, edge_types=edge_types, direction=direction
            ):
                seen_edges[edge.id] = edge
                if neigh.id not in seen_nodes:
                    seen_nodes[neigh.id] = neigh
                    frontier.append((neigh.id, depth + 1))
                    if len(seen_nodes) >= limit:
                        frontier.clear()
                        break
        return list(seen_nodes.values()), list(seen_edges.values())

    async def shortest_path(
        self,
        start_id: str,
        end_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        max_hops: int = 8,
    ) -> Optional[list[Node]]:
        if start_id not in self._nodes or end_id not in self._nodes:
            return None
        # Dijkstra over edge.weight; hop-bounded.
        dist: dict[str, float] = {start_id: 0.0}
        prev: dict[str, str] = {}
        depth: dict[str, int] = {start_id: 0}
        pq: list[tuple[float, str]] = [(0.0, start_id)]
        while pq:
            d, nid = heapq.heappop(pq)
            if nid == end_id:
                break
            if d > dist.get(nid, float("inf")):
                continue
            if depth[nid] >= max_hops:
                continue
            for edge, neigh in await self.neighbors(
                nid, edge_types=edge_types, direction=direction
            ):
                nd = d + max(edge.weight, 0.0001)
                if nd < dist.get(neigh.id, float("inf")):
                    dist[neigh.id] = nd
                    prev[neigh.id] = nid
                    depth[neigh.id] = depth[nid] + 1
                    heapq.heappush(pq, (nd, neigh.id))
        if end_id not in prev and start_id != end_id:
            return None
        # reconstruct
        path_ids: list[str] = [end_id]
        while path_ids[-1] != start_id:
            path_ids.append(prev[path_ids[-1]])
        path_ids.reverse()
        return [self._nodes[i] for i in path_ids]


# --------------------------------------------------------------------------- #
# Postgres adapter (recursive-CTE traversal)                                  #
# --------------------------------------------------------------------------- #
class PostgresGraphStore(GraphStore):
    """Postgres-backed graph. Traversal via recursive CTEs.

    Expects a SQLAlchemy async engine and these tables (see ``DDL`` below / the
    ``schema.sql`` sibling)::

        kg_nodes(id PK, type, key UNIQUE-ish(type,key), name, chain_id, properties JSONB,
                 sources JSONB, embedding_ref, created_at, updated_at)
        kg_edges(id PK, type, source_id FK, target_id FK, weight, properties JSONB,
                 sources JSONB, created_at, updated_at)

    Notes
    -----
    - JSON columns are merged application-side on upsert to preserve provenance.
    - This adapter is written against ``sqlalchemy.ext.asyncio``. The SQL text is
      kept explicit (no ORM) so it maps 1:1 to the DDL and is easy to audit.
    """

    DDL = """
    CREATE TABLE IF NOT EXISTS kg_nodes (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        key          TEXT NOT NULL,
        name         TEXT NOT NULL,
        chain_id     BIGINT,
        properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
        sources      JSONB NOT NULL DEFAULT '[]'::jsonb,
        embedding_ref TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (type, key)
    );
    CREATE INDEX IF NOT EXISTS kg_nodes_type_idx      ON kg_nodes(type);
    CREATE INDEX IF NOT EXISTS kg_nodes_chain_idx     ON kg_nodes(chain_id);
    CREATE INDEX IF NOT EXISTS kg_nodes_name_trgm_idx ON kg_nodes USING gin (name gin_trgm_ops);

    CREATE TABLE IF NOT EXISTS kg_edges (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        source_id  TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
        target_id  TEXT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
        weight     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb,
        sources    JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS kg_edges_src_idx  ON kg_edges(source_id, type);
    CREATE INDEX IF NOT EXISTS kg_edges_dst_idx  ON kg_edges(target_id, type);
    """

    def __init__(self, engine: Any) -> None:  # noqa: ANN401 (AsyncEngine, kept loose to avoid hard dep)
        self._engine = engine

    async def init_schema(self) -> None:
        from sqlalchemy import text

        async with self._engine.begin() as conn:
            # pg_trgm powers name_contains search; harmless if already present.
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
            for stmt in filter(None, (s.strip() for s in self.DDL.split(";"))):
                await conn.execute(text(stmt))

    # -- writes -----------------------------------------------------------
    async def upsert_node(self, node: Node) -> Node:
        from sqlalchemy import text

        sql = text(
            """
            INSERT INTO kg_nodes (id, type, key, name, chain_id, properties, sources,
                                  embedding_ref, created_at, updated_at)
            VALUES (:id, :type, :key, :name, :chain_id,
                    CAST(:properties AS jsonb), CAST(:sources AS jsonb),
                    :embedding_ref, :created_at, :updated_at)
            ON CONFLICT (id) DO UPDATE SET
                name          = EXCLUDED.name,
                chain_id      = COALESCE(EXCLUDED.chain_id, kg_nodes.chain_id),
                properties    = kg_nodes.properties || EXCLUDED.properties,
                sources       = (
                    SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(
                        kg_nodes.sources || EXCLUDED.sources)))),
                embedding_ref = COALESCE(EXCLUDED.embedding_ref, kg_nodes.embedding_ref),
                updated_at    = EXCLUDED.updated_at;
            """
        )
        import orjson

        async with self._engine.begin() as conn:
            await conn.execute(
                sql,
                {
                    "id": node.id,
                    "type": node.type.value,
                    "key": node.key,
                    "name": node.name,
                    "chain_id": node.chain_id,
                    "properties": orjson.dumps(node.properties).decode(),
                    "sources": orjson.dumps(node.sources).decode(),
                    "embedding_ref": node.embedding_ref,
                    "created_at": node.created_at,
                    "updated_at": node.updated_at,
                },
            )
        return node

    async def upsert_edge(self, edge: Edge) -> Edge:
        from sqlalchemy import text
        import orjson

        sql = text(
            """
            INSERT INTO kg_edges (id, type, source_id, target_id, weight, properties,
                                  sources, created_at, updated_at)
            VALUES (:id, :type, :source_id, :target_id, :weight,
                    CAST(:properties AS jsonb), CAST(:sources AS jsonb),
                    :created_at, :updated_at)
            ON CONFLICT (id) DO UPDATE SET
                weight     = EXCLUDED.weight,
                properties = kg_edges.properties || EXCLUDED.properties,
                sources    = (
                    SELECT to_jsonb(array(SELECT DISTINCT jsonb_array_elements_text(
                        kg_edges.sources || EXCLUDED.sources)))),
                updated_at = EXCLUDED.updated_at;
            """
        )
        async with self._engine.begin() as conn:
            await conn.execute(
                sql,
                {
                    "id": edge.id,
                    "type": edge.type.value,
                    "source_id": edge.source_id,
                    "target_id": edge.target_id,
                    "weight": edge.weight,
                    "properties": orjson.dumps(edge.properties).decode(),
                    "sources": orjson.dumps(edge.sources).decode(),
                    "created_at": edge.created_at,
                    "updated_at": edge.updated_at,
                },
            )
        return edge

    # -- reads ------------------------------------------------------------
    @staticmethod
    def _row_to_node(row: Any) -> Node:  # noqa: ANN401
        m = row._mapping
        return Node(
            id=m["id"],
            type=NodeType(m["type"]),
            key=m["key"],
            name=m["name"],
            chain_id=m["chain_id"],
            properties=m["properties"] or {},
            sources=m["sources"] or [],
            embedding_ref=m["embedding_ref"],
            created_at=m["created_at"],
            updated_at=m["updated_at"],
        )

    @staticmethod
    def _row_to_edge(row: Any) -> Edge:  # noqa: ANN401
        m = row._mapping
        return Edge(
            id=m["id"],
            type=EdgeType(m["type"]),
            source_id=m["source_id"],
            target_id=m["target_id"],
            weight=m["weight"],
            properties=m["properties"] or {},
            sources=m["sources"] or [],
            created_at=m["created_at"],
            updated_at=m["updated_at"],
        )

    async def get_node(self, node_id: str) -> Optional[Node]:
        from sqlalchemy import text

        async with self._engine.connect() as conn:
            res = await conn.execute(
                text("SELECT * FROM kg_nodes WHERE id = :id"), {"id": node_id}
            )
            row = res.first()
        return self._row_to_node(row) if row else None

    async def get_nodes(self, node_ids: Iterable[str]) -> dict[str, Node]:
        from sqlalchemy import text

        ids = list(node_ids)
        if not ids:
            return {}
        async with self._engine.connect() as conn:
            res = await conn.execute(
                text("SELECT * FROM kg_nodes WHERE id = ANY(:ids)"), {"ids": ids}
            )
            rows = res.fetchall()
        return {r._mapping["id"]: self._row_to_node(r) for r in rows}

    async def find_nodes(
        self,
        *,
        type: Optional[NodeType] = None,
        chain_id: Optional[int] = None,
        name_contains: Optional[str] = None,
        limit: int = 100,
    ) -> list[Node]:
        from sqlalchemy import text

        clauses: list[str] = []
        params: dict[str, Any] = {"limit": limit}
        if type is not None:
            clauses.append("type = :type")
            params["type"] = type.value
        if chain_id is not None:
            clauses.append("chain_id = :chain_id")
            params["chain_id"] = chain_id
        if name_contains:
            clauses.append("(name ILIKE :needle OR key ILIKE :needle)")
            params["needle"] = f"%{name_contains}%"
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with self._engine.connect() as conn:
            res = await conn.execute(
                text(f"SELECT * FROM kg_nodes {where} ORDER BY updated_at DESC LIMIT :limit"),
                params,
            )
            rows = res.fetchall()
        return [self._row_to_node(r) for r in rows]

    async def neighbors(
        self,
        node_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
    ) -> list[tuple[Edge, Node]]:
        from sqlalchemy import text

        type_filter = ""
        params: dict[str, Any] = {"id": node_id}
        if edge_types:
            type_filter = "AND e.type = ANY(:etypes)"
            params["etypes"] = [t.value for t in edge_types]

        dir_clause = {
            "out": "e.source_id = :id",
            "in": "e.target_id = :id",
            "both": "(e.source_id = :id OR e.target_id = :id)",
        }[direction]

        sql = text(
            f"""
            SELECT e.*,
                   n.id AS n_id, n.type AS n_type, n.key AS n_key, n.name AS n_name,
                   n.chain_id AS n_chain_id, n.properties AS n_properties,
                   n.sources AS n_sources, n.embedding_ref AS n_embedding_ref,
                   n.created_at AS n_created_at, n.updated_at AS n_updated_at
            FROM kg_edges e
            JOIN kg_nodes n
              ON n.id = CASE WHEN e.source_id = :id THEN e.target_id ELSE e.source_id END
            WHERE {dir_clause} {type_filter}
            """
        )
        out: list[tuple[Edge, Node]] = []
        async with self._engine.connect() as conn:
            res = await conn.execute(sql, params)
            for row in res.fetchall():
                m = row._mapping
                edge = Edge(
                    id=m["id"], type=EdgeType(m["type"]), source_id=m["source_id"],
                    target_id=m["target_id"], weight=m["weight"],
                    properties=m["properties"] or {}, sources=m["sources"] or [],
                    created_at=m["created_at"], updated_at=m["updated_at"],
                )
                node = Node(
                    id=m["n_id"], type=NodeType(m["n_type"]), key=m["n_key"], name=m["n_name"],
                    chain_id=m["n_chain_id"], properties=m["n_properties"] or {},
                    sources=m["n_sources"] or [], embedding_ref=m["n_embedding_ref"],
                    created_at=m["n_created_at"], updated_at=m["n_updated_at"],
                )
                out.append((edge, node))
        return out

    async def n_hop(
        self,
        start_id: str,
        *,
        hops: int,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        limit: int = 500,
    ) -> tuple[list[Node], list[Edge]]:
        """Recursive-CTE BFS. Returns the reachable node + edge sets within ``hops``."""
        from sqlalchemy import text

        params: dict[str, Any] = {"start": start_id, "hops": hops, "limit": limit}
        etype_filter = ""
        if edge_types:
            etype_filter = "AND e.type = ANY(:etypes)"
            params["etypes"] = [t.value for t in edge_types]

        # direction controls which endpoint columns we traverse across.
        if direction == "out":
            join = "e.source_id = f.node_id"
            next_expr = "e.target_id"
        elif direction == "in":
            join = "e.target_id = f.node_id"
            next_expr = "e.source_id"
        else:
            join = "(e.source_id = f.node_id OR e.target_id = f.node_id)"
            next_expr = "CASE WHEN e.source_id = f.node_id THEN e.target_id ELSE e.source_id END"

        sql = text(
            f"""
            WITH RECURSIVE frontier(node_id, depth, edge_id) AS (
                SELECT :start, 0, NULL::text
                UNION
                SELECT {next_expr}, f.depth + 1, e.id
                FROM frontier f
                JOIN kg_edges e ON {join} {etype_filter}
                WHERE f.depth < :hops
            )
            SELECT DISTINCT node_id, edge_id FROM frontier LIMIT :limit
            """
        )
        node_ids: set[str] = set()
        edge_ids: set[str] = set()
        async with self._engine.connect() as conn:
            res = await conn.execute(sql, params)
            for row in res.fetchall():
                m = row._mapping
                if m["node_id"]:
                    node_ids.add(m["node_id"])
                if m["edge_id"]:
                    edge_ids.add(m["edge_id"])
            nodes_map = await self.get_nodes(node_ids)
            edges: list[Edge] = []
            if edge_ids:
                eres = await conn.execute(
                    text("SELECT * FROM kg_edges WHERE id = ANY(:ids)"),
                    {"ids": list(edge_ids)},
                )
                edges = [self._row_to_edge(r) for r in eres.fetchall()]
        return list(nodes_map.values()), edges

    async def shortest_path(
        self,
        start_id: str,
        end_id: str,
        *,
        edge_types: Optional[list[EdgeType]] = None,
        direction: str = "both",
        max_hops: int = 8,
    ) -> Optional[list[Node]]:
        """Hop-bounded shortest path via a recursive CTE that carries the path array.

        Weight-optimality falls back to hop-count here (CTE returns the first path
        found at the minimum depth); for weight-optimal paths on large graphs prefer
        the in-memory Dijkstra or a Neo4j adapter. Adequate for the modest fan-out of
        the DeFi entity graph.
        """
        from sqlalchemy import text

        params: dict[str, Any] = {"start": start_id, "end": end_id, "max_hops": max_hops}
        etype_filter = ""
        if edge_types:
            etype_filter = "AND e.type = ANY(:etypes)"
            params["etypes"] = [t.value for t in edge_types]

        if direction == "out":
            join = "e.source_id = p.node_id"
            next_expr = "e.target_id"
        elif direction == "in":
            join = "e.target_id = p.node_id"
            next_expr = "e.source_id"
        else:
            join = "(e.source_id = p.node_id OR e.target_id = p.node_id)"
            next_expr = "CASE WHEN e.source_id = p.node_id THEN e.target_id ELSE e.source_id END"

        sql = text(
            f"""
            WITH RECURSIVE paths(node_id, depth, path) AS (
                SELECT :start, 0, ARRAY[:start]::text[]
                UNION ALL
                SELECT {next_expr}, p.depth + 1, p.path || {next_expr}
                FROM paths p
                JOIN kg_edges e ON {join} {etype_filter}
                WHERE p.depth < :max_hops
                  AND NOT ({next_expr} = ANY(p.path))
            )
            SELECT path FROM paths
            WHERE node_id = :end
            ORDER BY depth ASC
            LIMIT 1
            """
        )
        async with self._engine.connect() as conn:
            res = await conn.execute(sql, params)
            row = res.first()
        if not row:
            return None
        path_ids: list[str] = list(row._mapping["path"])
        nodes_map = await self.get_nodes(path_ids)
        return [nodes_map[i] for i in path_ids if i in nodes_map]


__all__ = ["GraphStore", "InMemoryGraphStore", "PostgresGraphStore"]
