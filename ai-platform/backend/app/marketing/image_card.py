"""Branded announcement image card for HookSwap X posts.

Claude does not generate images, so we render a BRANDED CARD deterministically in
the HookSwap "DAYSIGNAL" system: green ``#0C8A42`` accent, IBM Plex Mono, a hex +
hook logo motif, on the terminal ink background. The card shows the announcement
headline, an optional real stat, and the HookSwap wordmark.

FACTS-ONLY applies to imagery too: a stat is stamped on the card ONLY when it is
found verbatim in the grounding facts. A stat that cannot be grounded is dropped
(with a warning) — the card is never printed with a fabricated number.

Rasterization strategy (spec): the SVG is always produced. It is rasterized to
PNG via ``cairosvg`` if installed, else drawn natively via ``Pillow``; if neither
is available the SVG is returned with a note naming the rasterizer dependency.

NOTE ON AI IMAGERY: this renders a branded *card*, not model-generated art.
Photoreal/generative imagery would require a separate image-model integration
(e.g. an image API + key) — that is intentionally out of scope and flagged here,
not faked.
"""
from __future__ import annotations

import html
from dataclasses import dataclass, field
from typing import Any, Iterable

from .rag_port import GroundingFact

# DAYSIGNAL / Atlas palette
INK = "#0d100c"
PAPER = "#f4f5f1"
ACID_INK = "#0c8a42"  # primary green
ACID_FILL = "#38e07b"
GOLD = "#c79212"
MUTED = "#8a938c"

CARD_W = 1200
CARD_H = 630  # standard social card aspect


@dataclass
class CardResult:
    ok: bool
    format: str  # "png" | "svg"
    data: bytes | str  # PNG bytes, or SVG markup string
    warnings: list[str] = field(default_factory=list)
    rasterizer: str | None = None  # "cairosvg" | "pillow" | None
    stat_used: str | None = None
    note: str | None = None

    def to_meta(self) -> dict[str, Any]:
        """JSON-safe metadata (omits raw bytes)."""
        return {
            "ok": self.ok,
            "format": self.format,
            "bytes": len(self.data) if isinstance(self.data, (bytes, bytearray)) else None,
            "rasterizer": self.rasterizer,
            "stat_used": self.stat_used,
            "warnings": self.warnings,
            "note": self.note,
        }


def _stat_is_grounded(stat: str, facts: Iterable[GroundingFact]) -> bool:
    needle = stat.strip().lower()
    if not needle:
        return False
    return any(needle in f.text.lower() for f in facts)


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines[:4]


def _hook_glyph_svg(cx: float, cy: float, r: float, stroke: str) -> str:
    """A hex outline with an inscribed hook — the HookSwap logo motif."""
    pts = []
    import math

    for k in range(6):
        ang = math.pi / 180 * (60 * k - 30)
        pts.append(f"{cx + r * math.cos(ang):.1f},{cy + r * math.sin(ang):.1f}")
    hexagon = " ".join(pts)
    # hook: vertical stem with a curl at the bottom
    hook = (
        f"M {cx:.1f} {cy - r * 0.5:.1f} "
        f"L {cx:.1f} {cy + r * 0.15:.1f} "
        f"Q {cx:.1f} {cy + r * 0.5:.1f} {cx - r * 0.35:.1f} {cy + r * 0.5:.1f} "
        f"Q {cx - r * 0.62:.1f} {cy + r * 0.5:.1f} {cx - r * 0.62:.1f} {cy + r * 0.22:.1f}"
    )
    return (
        f'<polygon points="{hexagon}" fill="none" stroke="{stroke}" stroke-width="6"/>'
        f'<path d="{hook}" fill="none" stroke="{stroke}" stroke-width="10" '
        f'stroke-linecap="round"/>'
    )


def build_svg(headline: str, *, stat: str | None = None, eyebrow: str = "HOOKSWAP DESK") -> str:
    """Build the branded card as self-contained SVG markup."""
    head_lines = _wrap(headline.strip() or "HookSwap", 22)
    y0 = 210
    line_h = 74
    tspans = "".join(
        f'<text x="80" y="{y0 + i * line_h}" font-family="IBM Plex Mono, JetBrains Mono, monospace" '
        f'font-size="60" font-weight="700" fill="{PAPER}">{html.escape(l)}</text>'
        for i, l in enumerate(head_lines)
    )
    stat_block = ""
    if stat:
        stat_block = (
            f'<rect x="80" y="470" width="14" height="70" fill="{ACID_FILL}"/>'
            f'<text x="112" y="512" font-family="IBM Plex Mono, monospace" font-size="40" '
            f'font-weight="700" fill="{ACID_FILL}">{html.escape(stat)}</text>'
        )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{CARD_W}" height="{CARD_H}" viewBox="0 0 {CARD_W} {CARD_H}">
  <rect width="{CARD_W}" height="{CARD_H}" fill="{INK}"/>
  <rect x="0" y="0" width="{CARD_W}" height="10" fill="{ACID_INK}"/>
  {_hook_glyph_svg(CARD_W - 150, 150, 70, ACID_FILL)}
  <text x="80" y="120" font-family="IBM Plex Mono, monospace" font-size="26" letter-spacing="6" fill="{ACID_FILL}">{html.escape(eyebrow.upper())}</text>
  {tspans}
  {stat_block}
  <text x="80" y="590" font-family="IBM Plex Mono, monospace" font-size="34" font-weight="700" fill="{PAPER}">Hook<tspan fill="{ACID_FILL}">Swap</tspan></text>
  <text x="{CARD_W - 80}" y="590" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="22" fill="{MUTED}">A DEX in terminal form</text>
</svg>"""


def _rasterize_cairosvg(svg: str) -> bytes | None:
    try:
        import cairosvg  # type: ignore
    except Exception:
        return None
    try:
        return cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=CARD_W, output_height=CARD_H)
    except Exception:
        return None


def _rasterize_pillow(headline: str, stat: str | None, eyebrow: str) -> bytes | None:
    """Native Pillow draw of the same card (no SVG engine needed)."""
    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore
    except Exception:
        return None
    import io

    def _hex(c: str) -> tuple[int, int, int]:
        c = c.lstrip("#")
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))

    img = Image.new("RGB", (CARD_W, CARD_H), _hex(INK))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, CARD_W, 10], fill=_hex(ACID_INK))

    def font(size: int):
        for name in ("IBMPlexMono-Bold.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except Exception:
                continue
        return ImageFont.load_default()

    d.text((80, 95), eyebrow.upper(), fill=_hex(ACID_FILL), font=font(26))
    y = 190
    for line in _wrap(headline.strip() or "HookSwap", 22):
        d.text((80, y), line, fill=_hex(PAPER), font=font(58))
        y += 74
    if stat:
        d.rectangle([80, 470, 94, 540], fill=_hex(ACID_FILL))
        d.text((112, 478), stat, fill=_hex(ACID_FILL), font=font(38))
    d.text((80, 560), "HookSwap", fill=_hex(PAPER), font=font(34))
    d.text((CARD_W - 360, 566), "A DEX in terminal form", fill=_hex(MUTED), font=font(22))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_card(
    headline: str,
    *,
    facts: Iterable[GroundingFact] | None = None,
    stat: str | None = None,
    eyebrow: str = "HOOKSWAP DESK",
) -> CardResult:
    """Render a branded card. A stat is stamped only if grounded in ``facts``."""
    facts = list(facts or [])
    warnings: list[str] = []

    grounded_stat: str | None = None
    if stat:
        if _stat_is_grounded(stat, facts):
            grounded_stat = stat
        else:
            warnings.append(
                f"stat '{stat}' not found in grounding facts — omitted from the "
                "card (never stamp an ungrounded number)"
            )

    svg = build_svg(headline, stat=grounded_stat, eyebrow=eyebrow)

    png = _rasterize_cairosvg(svg)
    if png is not None:
        return CardResult(
            ok=True, format="png", data=png, warnings=warnings,
            rasterizer="cairosvg", stat_used=grounded_stat,
        )

    png = _rasterize_pillow(headline, grounded_stat, eyebrow)
    if png is not None:
        return CardResult(
            ok=True, format="png", data=png, warnings=warnings,
            rasterizer="pillow", stat_used=grounded_stat,
        )

    warnings.append(
        "no SVG rasterizer available (install 'cairosvg' or 'Pillow' for PNG) — "
        "returning SVG markup"
    )
    return CardResult(
        ok=True, format="svg", data=svg, warnings=warnings,
        rasterizer=None, stat_used=grounded_stat,
        note="Branded card only. AI-generated imagery would require a separate "
        "image-model integration (image API + key), out of scope here.",
    )
