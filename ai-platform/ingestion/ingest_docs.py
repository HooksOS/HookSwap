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
def load_dotenv_if_present() -> None:
    """Load ``backend/.env`` into os.environ without adding a pydantic dependency.

    The server reads its config through pydantic-settings, which loads that file
    automatically; this script deliberately does not import pydantic, so without
    this it would silently ingest with the *default* provider (hash) even though
    ``.env`` selects Voyage — producing a corpus whose vectors don't match what
    the server later queries with. Existing env vars always win.
    """
    env_path = Path(__file__).resolve().parents[1] / "backend" / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        # strip inline comments only for unquoted values, then surrounding quotes
        value = value.strip()
        if value and value[0] not in "\"'":
            value = value.split("#", 1)[0].strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def env_settings() -> SimpleNamespace:
    load_dotenv_if_present()
    return SimpleNamespace(
        embedding_provider=os.getenv("HOOKSWAP_AI_EMBEDDING_PROVIDER", "openai"),
        embedding_model=os.getenv("HOOKSWAP_AI_EMBEDDING_MODEL", "text-embedding-3-large"),
        embedding_dim=int(os.getenv("HOOKSWAP_AI_EMBEDDING_DIM", "3072")),
        openai_api_key=os.getenv("HOOKSWAP_AI_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"),
        voyage_api_key=os.getenv("HOOKSWAP_AI_VOYAGE_API_KEY") or os.getenv("VOYAGE_API_KEY"),
        nomic_api_key=os.getenv("HOOKSWAP_AI_NOMIC_API_KEY"),
        corpus_path=os.getenv("HOOKSWAP_AI_CORPUS_PATH"),
    )


# --------------------------------------------------------------------------- #
# Visibility classification                                                   #
# --------------------------------------------------------------------------- #
# The X marketing bot PUBLISHES. Anything it can retrieve, it can paraphrase into
# a public post, so the corpus has to distinguish material that is safe to publish
# from material that merely happens to be in the repo. CLAUDE.md and the operator
# runbooks contain server addresses, SSH key paths, deployer-wallet details, unreleased
# blockers and security-review status — all legitimate grounding for the INTERNAL
# team assistant (/v1/chat), none of it publishable.
#
# The default is INTERNAL and public trees are allowlisted, so a new doc directory
# is private until someone deliberately marks it publishable. Failing closed is the
# only safe direction for a component whose output is a public post.
PUBLIC_PREFIXES = (
    "docs/users/",
    "docs/developers/",
)


def classify_visibility(source_path: str) -> str:
    """Return "public" or "internal" for a repo-relative source path."""
    p = source_path.replace("\\", "/")
    if p.startswith("contracts/deployments/"):
        # Deployed addresses are on-chain and independently verifiable — publishing
        # them reveals nothing that a block explorer does not already show.
        return "public"
    return "public" if any(p.startswith(prefix) for prefix in PUBLIC_PREFIXES) else "internal"


class ChunkSink:
    """Collects chunks so they can be embedded in ONE batched pass at the end.

    The ingesters used to call ``store.add`` per chunk, which embeds immediately —
    that is one HTTP round-trip per chunk against a keyed provider (thousands of
    requests for this repo). This exposes the same ``add(**kwargs)`` signature, so
    the ingesters are unchanged, but defers embedding to ``store.add_many``.
    """

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def add(self, *, id: str, text: str, source_id: str, metadata: dict[str, Any] | None = None) -> None:
        self.records.append(
            {"id": id, "text": text, "source_id": source_id, "metadata": metadata or {}}
        )


# --------------------------------------------------------------------------- #
# Source ingesters                                                            #
# --------------------------------------------------------------------------- #
def ingest_markdown_file(sink: ChunkSink, path: Path, source_id: str, *, doc_type: str) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_markdown(text)
    for ch in chunks:
        chunk_source = f"{source_id}#{ch.heading_path}" if ch.heading_path else source_id
        sink.add(
            id=f"{source_id}::{ch.ordinal}",
            text=ch.text,
            source_id=chunk_source,
            metadata={"doc_type": doc_type, "path": source_id, "heading": ch.heading_path,
                      "visibility": classify_visibility(source_id)},
        )
    return len(chunks)


def ingest_docs_tree(sink: ChunkSink, repo_root: Path) -> int:
    docs_dir = repo_root / "docs"
    if not docs_dir.is_dir():
        return 0
    n = 0
    for md in sorted(docs_dir.rglob("*.md")):
        rel = md.relative_to(repo_root).as_posix()
        n += ingest_markdown_file(sink, md, rel, doc_type="doc")
    return n


def ingest_claude_md(sink: ChunkSink, repo_root: Path) -> int:
    claude = repo_root / "CLAUDE.md"
    if not claude.is_file():
        return 0
    return ingest_markdown_file(sink, claude, "CLAUDE.md", doc_type="project_facts")


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


def ingest_deployments(sink: ChunkSink, repo_root: Path) -> int:
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
            sink.add(
                id=f"{rel}::{ch.ordinal}",
                text=ch.text,
                source_id=rel,
                metadata={
                    "doc_type": "deployment",
                    "path": rel,
                    "chain": chain,
                    "chain_id": chain_id,
                    "visibility": classify_visibility(rel),
                },
            )
            n += 1
    return n


def ingest_chain_registry(sink: ChunkSink) -> int:
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
        sink.add(
            id=f"hookswap:chains::{ch.ordinal}",
            text=ch.text,
            source_id="hookswap:chain-registry",
            metadata={"doc_type": "chain_registry", "visibility": "public"},
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
    sink = ChunkSink()

    # A keyed provider that was requested but fell back to hashing would silently
    # produce a low-quality corpus, so surface the mismatch loudly instead.
    requested = (getattr(settings, "embedding_provider", "") or "").lower()
    if requested and requested != embedder.kind and embedder.kind == "stable-hash":
        print(
            f"WARNING: provider '{requested}' requested but fell back to "
            f"'{embedder.kind}' (missing API key?) — corpus quality will be degraded.",
            file=sys.stderr,
        )

    print(f"Repo root:   {repo_root}")
    print(f"Embedder:    {embedder.kind} (dim={embedder.dim})")
    print(f"Corpus out:  {out_path}")
    print("Ingesting sources…")

    counts = {
        "docs/**/*.md": ingest_docs_tree(sink, repo_root),
        "CLAUDE.md": ingest_claude_md(sink, repo_root),
        "contracts/deployments/*.json": ingest_deployments(sink, repo_root),
        "chain-registry": ingest_chain_registry(sink),
    }
    for name, c in counts.items():
        print(f"  - {name:32s} {c:4d} chunks")

    # ONE batched embedding pass over everything collected above.
    print(f"Embedding {len(sink.records)} chunks with {embedder.kind}…")
    store.add_many(sink.records)

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
