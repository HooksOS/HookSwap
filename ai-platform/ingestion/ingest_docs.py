#!/usr/bin/env python3
"""Ingest the STATIC HookSwap knowledge into the RAG retrieval corpus.

This is what grounds the RAG engine on REAL HookSwap facts. Sources ingested:

  1. ``docs/**/*.md``                    — operator/user/developer docs + specs
  2. ``CLAUDE.md``                       — project working doc: decisions, facts, status
  3. ``contracts/deployments/*.json``    — real on-chain addresses per chain
  4. the live chain registry             — ``backend/app/core/chains.py`` (chain ids/slugs)

Each source is chunked (heading-aware for markdown, fact-per-line for deployment JSON),
embedded with the same embedder the server uses, and written to the shared corpus file.

Idempotent: the corpus is rebuilt from scratch on every run and atomically written, so
re-running is safe and deterministic (with the offline stable-hash embedder).

Run:
    python ingestion/ingest_docs.py            # ingest into the default corpus path
    python ingestion/ingest_docs.py --out /path/to/corpus.json
    HOOKSWAP_AI_EMBEDDING_PROVIDER=openai OPENAI_API_KEY=... python ingestion/ingest_docs.py

No pydantic / FastAPI needed — this script depends only on the retrieval store + stdlib.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

# Make the backend package importable (app.retrieval.*, app.core.chains) without installing it.
_THIS = Path(__file__).resolve()
_AI_PLATFORM = _THIS.parents[1]
_BACKEND = _AI_PLATFORM / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.retrieval.chunking import chunk_markdown, chunk_text  # noqa: E402
from app.retrieval.store import (  # noqa: E402
    RetrievalStore,
    build_embedder,
    resolve_corpus_path,
)


# --------------------------------------------------------------------------- #
# Repo discovery                                                              #
# --------------------------------------------------------------------------- #
def find_repo_root() -> Path:
    """Walk up until we find the HookSwap repo root (has CLAUDE.md + contracts/)."""
    for parent in [_AI_PLATFORM, *_AI_PLATFORM.parents]:
        if (parent / "CLAUDE.md").is_file() and (parent / "contracts").is_dir():
            return parent
    # fallback: ai-platform's parent
    return _AI_PLATFORM.parent


# --------------------------------------------------------------------------- #
# Embedder / settings shim (env-driven, no pydantic dependency)               #
# --------------------------------------------------------------------------- #
def env_settings() -> SimpleNamespace:
    return SimpleNamespace(
        embedding_provider=os.getenv("HOOKSWAP_AI_EMBEDDING_PROVIDER", "openai"),
        embedding_model=os.getenv("HOOKSWAP_AI_EMBEDDING_MODEL", "text-embedding-3-large"),
        embedding_dim=int(os.getenv("HOOKSWAP_AI_EMBEDDING_DIM", "3072")),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        corpus_path=os.getenv("HOOKSWAP_AI_CORPUS_PATH"),
    )


# --------------------------------------------------------------------------- #
# Source ingesters                                                            #
# --------------------------------------------------------------------------- #
def ingest_markdown_file(store: RetrievalStore, path: Path, source_id: str, *, doc_type: str) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_markdown(text)
    for ch in chunks:
        chunk_source = f"{source_id}#{ch.heading_path}" if ch.heading_path else source_id
        store.add(
            id=f"{source_id}::{ch.ordinal}",
            text=ch.text,
            source_id=chunk_source,
            metadata={"doc_type": doc_type, "path": source_id, "heading": ch.heading_path},
        )
    return len(chunks)


def ingest_docs_tree(store: RetrievalStore, repo_root: Path) -> int:
    docs_dir = repo_root / "docs"
    if not docs_dir.is_dir():
        return 0
    n = 0
    for md in sorted(docs_dir.rglob("*.md")):
        rel = md.relative_to(repo_root).as_posix()
        n += ingest_markdown_file(store, md, rel, doc_type="doc")
    return n


def ingest_claude_md(store: RetrievalStore, repo_root: Path) -> int:
    claude = repo_root / "CLAUDE.md"
    if not claude.is_file():
        return 0
    return ingest_markdown_file(store, claude, "CLAUDE.md", doc_type="project_facts")


_ADDRESS_HINT = ("address", "factory", "router", "quoter", "manager", "permit", "weth", "hash",
                 "multicall", "vault", "settlement", "registry", "fund", "guard", "impl", "hub",
                 "deployer", "owner", "receiver", "npm", "token", "pool", "pair")


def _flatten_deployment(obj: Any, prefix: str = "") -> list[str]:
    """Turn a deployment JSON into readable 'name: value' fact lines (addresses preserved verbatim)."""
    lines: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, (dict, list)):
                lines.extend(_flatten_deployment(v, key))
            else:
                lines.append(f"{key}: {v}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            lines.extend(_flatten_deployment(v, f"{prefix}[{i}]"))
    else:
        lines.append(f"{prefix}: {obj}")
    return lines


def ingest_deployments(store: RetrievalStore, repo_root: Path) -> int:
    dep_dir = repo_root / "contracts" / "deployments"
    if not dep_dir.is_dir():
        return 0
    n = 0
    for jf in sorted(dep_dir.glob("*.json")):
        rel = jf.relative_to(repo_root).as_posix()
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        chain = data.get("chain") if isinstance(data, dict) else None
        chain_id = data.get("chainId") if isinstance(data, dict) else None
        header = f"HookSwap on-chain deployment addresses ({jf.stem})"
        if chain or chain_id:
            header += f" — chain={chain} chainId={chain_id}"
        body = header + "\n" + "\n".join(_flatten_deployment(data))
        # deployment files are flat fact-lists; keep each file as a bounded set of chunks
        for ch in chunk_text(body, max_chars=1500):
            store.add(
                id=f"{rel}::{ch.ordinal}",
                text=ch.text,
                source_id=rel,
                metadata={
                    "doc_type": "deployment",
                    "path": rel,
                    "chain": chain,
                    "chain_id": chain_id,
                },
            )
            n += 1
    return n


def ingest_chain_registry(store: RetrievalStore) -> int:
    """Ingest the live HookSwap chain list from the backend registry."""
    try:
        from app.core.chains import CHAINS  # local import: keeps failure isolated
    except Exception as exc:  # pragma: no cover
        print(f"  ! chain registry import failed: {exc}", file=sys.stderr)
        return 0
    lines = ["HookSwap live chain registry (chains the platform is deployed on):"]
    for info in CHAINS.values():
        parts = [
            f"{info.name} (slug: {info.slug}) chainId={int(info.chain_id)}",
            f"native symbol {info.native_symbol}",
        ]
        if info.gas_token:
            parts.append(f"gas paid in {info.gas_token}")
        if info.is_testnet:
            parts.append("testnet")
        if info.is_validation_chain:
            parts.append("canonical validation chain")
        if info.aliases:
            parts.append(f"aliases: {', '.join(info.aliases)}")
        lines.append("- " + ", ".join(parts))
    text = "\n".join(lines)
    n = 0
    for ch in chunk_text(text, max_chars=1500):
        store.add(
            id=f"hookswap:chains::{ch.ordinal}",
            text=ch.text,
            source_id="hookswap:chain-registry",
            metadata={"doc_type": "chain_registry"},
        )
        n += 1
    return n


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def main() -> int:
    settings = env_settings()
    parser = argparse.ArgumentParser(description="Ingest HookSwap static knowledge into the RAG corpus.")
    parser.add_argument(
        "--out",
        default=None,
        help="Corpus output path (default: env HOOKSWAP_AI_CORPUS_PATH or <ai-platform>/data/corpus.json).",
    )
    args = parser.parse_args()

    repo_root = find_repo_root()
    out_path = Path(args.out).expanduser().resolve() if args.out else resolve_corpus_path(settings)

    embedder = build_embedder(settings)
    store = RetrievalStore(embedder=embedder)

    print(f"Repo root:   {repo_root}")
    print(f"Embedder:    {embedder.kind} (dim={embedder.dim})")
    print(f"Corpus out:  {out_path}")
    print("Ingesting sources…")

    counts = {
        "docs/**/*.md": ingest_docs_tree(store, repo_root),
        "CLAUDE.md": ingest_claude_md(store, repo_root),
        "contracts/deployments/*.json": ingest_deployments(store, repo_root),
        "chain-registry": ingest_chain_registry(store),
    }
    for name, c in counts.items():
        print(f"  - {name:32s} {c:4d} chunks")

    store.save(out_path)
    print(
        f"Done. {store.size} chunks from {len(store.sources())} sources -> {out_path}"
    )
    if store.size == 0:
        print("WARNING: no chunks ingested — check repo layout.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
