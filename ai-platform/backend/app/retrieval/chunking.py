"""Text chunking for ingestion.

Markdown is split heading-aware (each section under an ATX heading becomes its own
chunk group), then long sections are further split on paragraph boundaries with a soft
character budget. Chunks carry their heading path so citations point at a specific
section, not a whole file.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


@dataclass(slots=True)
class Chunk:
    text: str
    heading_path: str = ""
    ordinal: int = 0
    metadata: dict = field(default_factory=dict)


def chunk_markdown(text: str, *, max_chars: int = 1200, min_chars: int = 120) -> list[Chunk]:
    """Split markdown into heading-scoped, size-bounded chunks."""
    lines = text.splitlines()
    sections: list[tuple[str, list[str]]] = []  # (heading_path, body_lines)
    stack: list[tuple[int, str]] = []  # (level, title)
    current: list[str] = []

    def heading_path() -> str:
        return " > ".join(title for _, title in stack)

    for line in lines:
        m = _HEADING.match(line)
        if m:
            if current:
                sections.append((heading_path(), current))
                current = []
            level = len(m.group(1))
            title = m.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
        else:
            current.append(line)
    if current:
        sections.append((heading_path(), current))

    chunks: list[Chunk] = []
    ordinal = 0
    for hpath, body in sections:
        body_text = "\n".join(body).strip()
        if not body_text and hpath:
            # heading with no body yet — keep the heading itself as a tiny chunk
            body_text = hpath.split(" > ")[-1]
        if not body_text:
            continue
        for piece in _split_to_budget(body_text, max_chars=max_chars, min_chars=min_chars):
            prefix = f"{hpath}\n" if hpath else ""
            chunks.append(Chunk(text=prefix + piece, heading_path=hpath, ordinal=ordinal))
            ordinal += 1
    if not chunks:
        # non-markdown / no headings — fall back to plain budget splitting
        for piece in _split_to_budget(text.strip(), max_chars=max_chars, min_chars=min_chars):
            chunks.append(Chunk(text=piece, heading_path="", ordinal=ordinal))
            ordinal += 1
    return chunks


def chunk_text(text: str, *, max_chars: int = 1200, min_chars: int = 120) -> list[Chunk]:
    chunks: list[Chunk] = []
    for i, piece in enumerate(_split_to_budget(text.strip(), max_chars=max_chars, min_chars=min_chars)):
        chunks.append(Chunk(text=piece, ordinal=i))
    return chunks


def _split_to_budget(text: str, *, max_chars: int, min_chars: int) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    buf = ""
    for para in paras:
        if len(para) > max_chars:
            if buf:
                out.append(buf)
                buf = ""
            out.extend(_hard_wrap(para, max_chars))
            continue
        if not buf:
            buf = para
        elif len(buf) + len(para) + 2 <= max_chars:
            buf = f"{buf}\n\n{para}"
        else:
            out.append(buf)
            buf = para
    if buf:
        out.append(buf)
    # merge trailing tiny fragments into the previous chunk
    merged: list[str] = []
    for piece in out:
        if merged and len(piece) < min_chars:
            merged[-1] = f"{merged[-1]}\n\n{piece}"
        else:
            merged.append(piece)
    return merged or ([text] if text else [])


def _hard_wrap(text: str, max_chars: int) -> list[str]:
    words = text.split()
    out: list[str] = []
    buf = ""
    for w in words:
        if not buf:
            buf = w
        elif len(buf) + 1 + len(w) <= max_chars:
            buf = f"{buf} {w}"
        else:
            out.append(buf)
            buf = w
    if buf:
        out.append(buf)
    return out


__all__ = ["Chunk", "chunk_markdown", "chunk_text"]
