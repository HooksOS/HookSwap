#!/usr/bin/env python3
"""Measure the grounding floor for the CURRENT corpus + embedder.

``recommended_min_score`` decides "grounded vs I don't have that in the knowledge
base". Too low and the bot cites irrelevant chunks (and the marketing bot posts
weakly-grounded claims); too high and real questions get refused. The right value
is a property of the embedder AND the corpus, so it is measured, not guessed.

Method: score a set of ON-TOPIC probes (answerable from the HookSwap corpus) and a
set of OFF-TOPIC probes (definitely not in it), then report the separation. A good
floor sits between the two distributions — printed as a suggestion, with the raw
numbers so the choice is auditable.

Run:
    backend/.venv/bin/python backend/scripts/calibrate_floor.py
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.core.config import settings  # noqa: E402
from app.retrieval.store import RetrievalStore, build_embedder, resolve_corpus_path  # noqa: E402

ON_TOPIC = [
    "What chain id is Robinhood Chain?",
    "What is the HookSwap v2 router address?",
    "Which chains is HookSwap deployed on?",
    "What is the interface fee on swaps?",
    "What is HyperEVM's wrapped native token?",
    "Where is the Universal Router deployed on Ink?",
    "What is the HookSwap treasury address?",
    "What is Permit2's address?",
]

OFF_TOPIC = [
    "What is the capital of France?",
    "How do I bake sourdough bread?",
    "Who won the 1998 FIFA World Cup?",
    "What is the boiling point of water in Fahrenheit?",
    "Explain the plot of Hamlet.",
    "How tall is Mount Everest?",
    "What is a good recipe for carbonara?",
    "When was the printing press invented?",
]


def main() -> int:
    path = resolve_corpus_path(settings)
    if not path.exists():
        print(f"No corpus at {path} — run `make ingest` first.", file=sys.stderr)
        return 1

    embedder = build_embedder(settings)
    load_embedder = None if getattr(embedder, "kind", None) == "stable-hash" else embedder
    store = RetrievalStore.load(path, embedder=load_embedder)

    print(f"corpus:   {path}")
    print(f"chunks:   {store.size}")
    print(f"embedder: {store.embedder.kind} (dim={store.embedder.dim})")
    print(f"current recommended_min_score: {getattr(store.embedder, 'recommended_min_score', None)}\n")

    def top_scores(probes: list[str]) -> list[float]:
        out = []
        for q in probes:
            hits = store.search(q, top_k=1)
            out.append(hits[0].score if hits else 0.0)
        return out

    on = top_scores(ON_TOPIC)
    off = top_scores(OFF_TOPIC)

    print("ON-TOPIC (should clear the floor):")
    for q, s in zip(ON_TOPIC, on):
        print(f"  {s:.4f}  {q}")
    print("\nOFF-TOPIC (should fall below the floor):")
    for q, s in zip(OFF_TOPIC, off):
        print(f"  {s:.4f}  {q}")

    lo_on, hi_off = min(on), max(off)
    print(f"\nmin(on-topic)  = {lo_on:.4f}")
    print(f"max(off-topic) = {hi_off:.4f}")

    if lo_on > hi_off:
        suggested = round(hi_off + (lo_on - hi_off) / 2, 3)
        print(f"separation     = {lo_on - hi_off:.4f}  (clean)")
        print(f"\nSUGGESTED recommended_min_score = {suggested}")
    else:
        print("separation     = NONE — the distributions overlap.")
        print("\nNo single floor separates them; a floor here will either admit "
              "off-topic hits or refuse real questions. Prefer a stronger embedder "
              "or better chunking over picking a number.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
