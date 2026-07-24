// Per-lock social preview (OpenGraph) rendering.
//
// Two products, both derived ONLY from the real indexed `Lock` (never fabricated):
//   1. renderLockOgPng(lock) — a 1200×630 PNG social card, generated fully
//      server-side + self-contained (no network fetch at render time).
//   2. lockShareHtml(...)    — a minimal crawler HTML doc whose <head> carries the
//      OG/Twitter meta tags (image → the PNG route) + a redirect to the in-app,
//      hash-routed lock page for human visitors.
//
// Image pipeline: a hand-authored SVG string (exact fixed layout — the data is
// known, so satori's flexbox layout buys nothing) rasterized to PNG with
// @resvg/resvg-js. Fonts are the repo's TTFs (Inter + a mono for numerics), loaded
// from local files — resvg-js in this build does NOT decode woff2, so the woff2
// assets under apps/web/public/fonts are unusable here; TTF is required.
//
// FACTS ONLY: USD value is shown only when the lock is priced (honest "Unpriced"
// chip otherwise); every field mirrors the JSON `/lock` route. A 404 for an unknown
// lock is handled by the caller (server.ts) before this module is reached.

import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";
import type { Lock } from "./indexer.js";

// ------------------------------------------------------------------- fonts (TTF)
// Local TTFs shipped with this service. Inter (Regular + SemiBold) for text,
// InputMono for numerics/addresses (brand rule: mono for numbers). All TTF —
// resvg-js in this build does NOT decode woff2, so the woff2 assets under
// apps/web/public/fonts are unusable; TTF is required. Passed to resvg by file
// path (the typed `fontFiles` API); no external fetch at render time.

function fontPath(name: string): string {
  return fileURLToPath(new URL(`./assets/fonts/${name}`, import.meta.url));
}
const FONT_FILES: string[] = [
  fontPath("Inter-Regular.ttf"),
  fontPath("Inter-SemiBold.ttf"),
  fontPath("InputMono-Regular.ttf"),
];

// ------------------------------------------------------------------- palette
// DAYSIGNAL dark tokens (apps/web/src/terminal/theme/tokens.ts terminalColorsDark).
const C = {
  bg: "#0d100c",
  panel: "#14190f",
  panel2: "#171d14",
  line: "#2a3124",
  ink: "#e8ece2",
  ink2: "#adb5a4",
  faint: "#7e8676",
  green: "#33ce79",
  greenUp: "#3fd782",
  greenBg: "#12271a",
  greenBorder: "#2c6b45",
  red: "#ff6b5e",
  redBg: "#2c1310",
  gold: "#e0a93a",
  goldBg: "#2a2110",
} as const;

const SANS = "Inter";
const MONO = "InputMono";

// ------------------------------------------------------------------- formatting

/** XML-escape dynamic text (token symbols are on-chain data — never trusted raw). */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Truncate to a max char count with a trailing ellipsis (keeps the card from overflowing). */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Human-readable token amount from a `formatted` decimal string (compact when large). */
function fmtAmount(formatted: string): string {
  const n = Number(formatted);
  if (!Number.isFinite(n)) return clip(formatted, 18);
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(2)}K`;
  if (abs === 0) return "0";
  if (abs < 0.0001) return n.toExponential(2);
  const dp = abs >= 1 ? 2 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

/** USD value (compact when large). */
function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** UTC calendar date, e.g. "12 Jul 2026". */
function fmtDateUtc(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

/** Coarse humanized remaining time until unlock (or "Unlocked"). */
function countdown(unlockSec: number, nowSec: number): string {
  const d = unlockSec - nowSec;
  if (d <= 0) return "Unlocked";
  const days = Math.floor(d / 86_400);
  if (days >= 730) return `${(days / 365).toFixed(1)} years`;
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(d / 3_600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(d / 60));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** The lock's headline title: "SYM0 / SYM1" for LP locks, else the token symbol. */
function lockTitle(lock: Lock): string {
  if (lock.isLpToken && lock.lp) {
    return `${lock.lp.token0.symbol} / ${lock.lp.token1.symbol}`;
  }
  return lock.symbol;
}

/** Elapsed fraction of the lock term (createdAt → unlockTime), clamped to [0,1]. */
function progress(lock: Lock, nowSec: number): number {
  const span = lock.unlockTime - lock.createdAt;
  if (!(span > 0)) return lock.unlockTime <= nowSec ? 1 : 0;
  const p = (nowSec - lock.createdAt) / span;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

// ------------------------------------------------------------------- SVG builder

function svgText(
  x: number,
  y: number,
  s: string,
  opts: { size: number; fill: string; family?: string; weight?: number; anchor?: string; ls?: number },
): string {
  const family = opts.family ?? SANS;
  const weight = opts.weight ?? 400;
  const anchor = opts.anchor ?? "start";
  const ls = opts.ls !== undefined ? ` letter-spacing="${opts.ls}"` : "";
  return (
    `<text x="${x}" y="${y}" font-family="${family}" font-weight="${weight}" ` +
    `font-size="${opts.size}" fill="${opts.fill}" text-anchor="${anchor}"${ls}>${esc(s)}</text>`
  );
}

/** The HookSwap hex+ring glyph (geometry verbatim from HookLogo.tsx, viewBox 0 0 48 48). */
function logoGlyph(x: number, y: number, size: number): string {
  const scale = size / 48;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    `<path d="M24 3.5 L41.8 13.75 L41.8 34.25 L24 44.5 L6.2 34.25 L6.2 13.75 Z" ` +
    `fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<circle cx="24" cy="25" r="7.2" fill="none" stroke="${C.green}" stroke-width="2.4" ` +
    `stroke-linecap="round" stroke-dasharray="33 13" transform="rotate(118 24 25)"/>` +
    `</g>`
  );
}

/** Build the 1200×630 card SVG for a lock. */
function lockSvg(lock: Lock, nowSec: number): string {
  const W = 1200;
  const H = 630;
  const PAD = 72; // content left margin
  const RIGHT = W - PAD; // content right edge (1128)

  const priced = typeof lock.valueUsd === "number";
  const unlocked = lock.unlockTime <= nowSec;
  const kind = lock.isLpToken ? "LP LOCK" : "TOKEN LOCK";
  const title = clip(lockTitle(lock), 26);
  const amountStr = `${fmtAmount(lock.amount.formatted)} ${clip(
    lock.isLpToken ? "LP" : lock.symbol,
    14,
  )}`;
  const p = progress(lock, nowSec);
  const barX = PAD;
  const barW = RIGHT - PAD; // 1056
  const barY = 476;

  const parts: string[] = [];

  // Background + inset card.
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  parts.push(
    `<rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="28" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>`,
  );
  // Left accent spine (brand green).
  parts.push(`<rect x="32" y="32" width="8" height="${H - 64}" rx="4" fill="${C.green}"/>`);

  // ── Header: logo + wordmark (left), chain pill (right).
  parts.push(logoGlyph(PAD, 56, 52));
  parts.push(svgText(PAD + 66, 96, "Hook", { size: 36, fill: C.ink, weight: 600 }));
  // width of "Hook" at 36px ≈ 92px → place "Swap" after it.
  parts.push(svgText(PAD + 66 + 92, 96, "Swap", { size: 36, fill: C.green, weight: 600 }));

  const chain = clip(lock.chainName, 16);
  const chainW = Math.max(120, chain.length * 15 + 44);
  parts.push(
    `<rect x="${RIGHT - chainW}" y="58" width="${chainW}" height="46" rx="23" fill="${C.greenBg}" stroke="${C.greenBorder}" stroke-width="1.5"/>`,
  );
  parts.push(
    svgText(RIGHT - chainW / 2, 88, chain, { size: 22, fill: C.greenUp, weight: 600, anchor: "middle" }),
  );

  // Divider.
  parts.push(`<line x1="${PAD}" y1="132" x2="${RIGHT}" y2="132" stroke="${C.line}" stroke-width="2"/>`);

  // ── Eyebrow + title.
  parts.push(
    svgText(PAD, 190, `${kind}  ·  #${lock.id}`, {
      size: 24,
      fill: C.gold,
      family: MONO,
      ls: 2,
    }),
  );
  parts.push(svgText(PAD, 268, title, { size: 66, fill: C.ink, weight: 600 }));

  // ── Two stat blocks: locked amount | USD value.
  const colB = 636;
  parts.push(svgText(PAD, 330, "LOCKED AMOUNT", { size: 22, fill: C.faint, ls: 1.5 }));
  parts.push(svgText(PAD, 384, clip(amountStr, 26), { size: 42, fill: C.ink, family: MONO }));

  parts.push(svgText(colB, 330, "USD VALUE", { size: 22, fill: C.faint, ls: 1.5 }));
  if (priced) {
    parts.push(svgText(colB, 384, fmtUsd(lock.valueUsd as number), { size: 42, fill: C.greenUp, family: MONO }));
  } else {
    // Honest omission — no fabricated $ figure.
    parts.push(
      `<rect x="${colB}" y="352" width="188" height="40" rx="8" fill="${C.goldBg}" stroke="${C.gold}" stroke-width="1.5"/>`,
    );
    parts.push(svgText(colB + 94, 379, "Unpriced", { size: 22, fill: C.gold, weight: 600, anchor: "middle" }));
  }

  // ── Lock-term progress bar.
  const statusColor = unlocked ? C.red : C.greenUp;
  parts.push(svgText(PAD, barY - 18, `Locked ${fmtDateUtc(lock.createdAt)}`, { size: 22, fill: C.faint, family: MONO }));
  parts.push(
    svgText(RIGHT, barY - 18, `Unlocks ${fmtDateUtc(lock.unlockTime)}`, {
      size: 22,
      fill: statusColor,
      family: MONO,
      anchor: "end",
    }),
  );
  parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="14" rx="7" fill="${C.panel2}" stroke="${C.line}" stroke-width="1"/>`);
  const fillW = Math.max(0, Math.min(barW, Math.round(barW * p)));
  if (fillW > 0) {
    parts.push(`<rect x="${barX}" y="${barY}" width="${fillW}" height="14" rx="7" fill="${unlocked ? C.red : C.green}"/>`);
  }

  // Status line under the bar.
  const statusText = unlocked
    ? "Unlocked — withdrawable"
    : `Unlocks in ${countdown(lock.unlockTime, nowSec)}`;
  parts.push(
    `<rect x="${PAD}" y="${barY + 30}" width="14" height="14" rx="3" fill="${statusColor}"/>`,
  );
  parts.push(svgText(PAD + 24, barY + 42, statusText, { size: 24, fill: C.ink2, weight: 600 }));
  if (lock.lockedPctOfSupply !== null && !lock.isLpToken) {
    parts.push(
      svgText(RIGHT, barY + 42, `${lock.lockedPctOfSupply.toFixed(2)}% of supply`, {
        size: 24,
        fill: C.ink2,
        family: MONO,
        anchor: "end",
      }),
    );
  }

  // ── Footer.
  parts.push(svgText(PAD, H - 44, "hookswap.org", { size: 24, fill: C.green, weight: 600 }));
  parts.push(
    svgText(RIGHT, H - 44, "Proof of Lock · verify on-chain", {
      size: 22,
      fill: C.faint,
      anchor: "end",
    }),
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parts.join("") +
    `</svg>`
  );
}

// ------------------------------------------------------------------- public API

/** Render a lock's 1200×630 social card to a PNG buffer (self-contained). */
export function renderLockOgPng(lock: Lock): Buffer {
  const nowSec = Math.floor(Date.now() / 1000);
  const svg = lockSvg(lock, nowSec);
  const resvg = new Resvg(svg, {
    background: C.bg,
    fitTo: { mode: "width", value: 1200 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: SANS },
  });
  return resvg.render().asPng();
}

/**
 * Minimal crawler HTML: OG/Twitter meta (image → `imageUrl`) + a refresh/JS redirect
 * to the human, hash-routed in-app lock page (`appLockUrl`). Exists because the app
 * is a hash-routed SPA whose per-route meta can't be crawled.
 */
export function lockShareHtml(lock: Lock, imageUrl: string, appLockUrl: string): string {
  const kind = lock.isLpToken ? "LP lock" : "token lock";
  const title = `${lockTitle(lock)} ${kind} · HookSwap Locker`;
  const nowSec = Math.floor(Date.now() / 1000);
  const amountStr = `${fmtAmount(lock.amount.formatted)} ${lock.isLpToken ? "LP" : lock.symbol}`;
  const usdBit = typeof lock.valueUsd === "number" ? ` · ${fmtUsd(lock.valueUsd)}` : "";
  const unlockBit =
    lock.unlockTime <= nowSec
      ? " · unlocked"
      : ` · unlocks ${fmtDateUtc(lock.unlockTime)} (in ${countdown(lock.unlockTime, nowSec)})`;
  const description = `${amountStr} locked${usdBit}${unlockBit} on ${lock.chainName}. Proof of lock — verify on-chain on HookSwap.`;

  const t = esc(title);
  const d = esc(description);
  const img = esc(imageUrl);
  const app = esc(appLockUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<meta name="description" content="${d}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="HookSwap Locker"/>
<meta property="og:title" content="${t}"/>
<meta property="og:description" content="${d}"/>
<meta property="og:image" content="${img}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${app}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${t}"/>
<meta name="twitter:description" content="${d}"/>
<meta name="twitter:image" content="${img}"/>
<link rel="canonical" href="${app}"/>
<meta http-equiv="refresh" content="0; url=${app}"/>
<script>window.location.replace(${JSON.stringify(appLockUrl)});</script>
</head>
<body style="margin:0;background:${C.bg};color:${C.ink};font-family:system-ui,sans-serif">
<p style="padding:24px">Redirecting to the HookSwap lock page… If you are not redirected, <a style="color:${C.green}" href="${app}">open it here</a>.</p>
</body>
</html>`;
}
