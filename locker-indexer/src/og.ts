// Per-record social preview (OpenGraph) rendering for the three locker products:
// LOCKS, FARMS, and VESTING schedules.
//
// Each product exposes the same two things, both derived ONLY from the real
// indexed record (never fabricated):
//   1. render<Kind>OgPng(record) — a 1200×630 PNG social card, generated fully
//      server-side + self-contained (no network fetch at render time).
//   2. <kind>ShareHtml(...)      — a minimal crawler HTML doc whose <head> carries
//      the OG/Twitter meta tags (image → the PNG route) + a redirect to the in-app,
//      hash-routed page for human visitors.
//
// All three cards reuse ONE shared chrome (background, inset card, brand spine,
// logo/wordmark header, chain pill, divider, footer, progress bar, stat blocks) —
// only the body content differs per record type.
//
// Image pipeline: a hand-authored SVG string (exact fixed layout — the data is
// known, so satori's flexbox layout buys nothing) rasterized to PNG with
// @resvg/resvg-js. Fonts are the repo's TTFs (Inter + a mono for numerics), loaded
// from local files — resvg-js in this build does NOT decode woff2, so the woff2
// assets under apps/web/public/fonts are unusable here; TTF is required.
//
// FACTS ONLY: USD/APR are shown only when the record is priced (honest "Unpriced"
// chip / "—" otherwise); every field mirrors the JSON route. A 404 for an unknown
// record is handled by the caller (server.ts) before this module is reached.

import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";
import type { Lock } from "./indexer.js";
import type { Farm } from "./farms/indexer.js";
import type { VestingSchedule } from "./vesting/indexer.js";

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

// ------------------------------------------------------------- shared geometry
const W = 1200;
const H = 630;
const PAD = 72; // content left margin
const RIGHT = W - PAD; // content right edge (1128)
// Three stat columns (used by the multi-stat cards).
const COL1 = PAD; // 72
const COL2 = 468;
const COL3 = 840;
// Lock's two-column layout keeps its original wide split.
const COL_B2 = 636;
const BAR_X = PAD;
const BAR_W = RIGHT - PAD; // 1056
const BAR_Y = 476;

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

/** Shorten an address to 0x1234…abcd. */
function shortAddr(a: string): string {
  return a.length >= 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
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

/** Coarse humanized duration for a positive remaining span (seconds). */
function humanize(deltaSec: number): string {
  const d = Math.max(0, deltaSec);
  const days = Math.floor(d / 86_400);
  if (days >= 730) return `${(days / 365).toFixed(1)} years`;
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(d / 3_600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(d / 60));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** Coarse humanized remaining time until a target (or "Unlocked" once past). */
function countdown(unlockSec: number, nowSec: number): string {
  const d = unlockSec - nowSec;
  if (d <= 0) return "Unlocked";
  return humanize(d);
}

/** Elapsed fraction of a [start,end] span at `now`, clamped to [0,1]. */
function elapsedFrac(start: number, end: number, nowSec: number): number {
  const span = end - start;
  if (!(span > 0)) return end <= nowSec ? 1 : 0;
  const p = (nowSec - start) / span;
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

/**
 * Open a card: push the shared chrome (background, inset card, brand spine,
 * logo/wordmark header, chain pill, divider) and return the parts array to fill.
 */
function cardOpen(chainNameStr: string): string[] {
  const parts: string[] = [];

  // Background + inset card.
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  parts.push(
    `<rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="28" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>`,
  );
  // Left accent spine (brand green).
  parts.push(`<rect x="32" y="32" width="8" height="${H - 64}" rx="4" fill="${C.green}"/>`);

  // Header: logo + wordmark (left), chain pill (right).
  parts.push(logoGlyph(PAD, 56, 52));
  parts.push(svgText(PAD + 66, 96, "Hook", { size: 36, fill: C.ink, weight: 600 }));
  // width of "Hook" at 36px ≈ 92px → place "Swap" after it.
  parts.push(svgText(PAD + 66 + 92, 96, "Swap", { size: 36, fill: C.green, weight: 600 }));

  const chain = clip(chainNameStr, 16);
  const chainW = Math.max(120, chain.length * 15 + 44);
  parts.push(
    `<rect x="${RIGHT - chainW}" y="58" width="${chainW}" height="46" rx="23" fill="${C.greenBg}" stroke="${C.greenBorder}" stroke-width="1.5"/>`,
  );
  parts.push(
    svgText(RIGHT - chainW / 2, 88, chain, { size: 22, fill: C.greenUp, weight: 600, anchor: "middle" }),
  );

  // Divider.
  parts.push(`<line x1="${PAD}" y1="132" x2="${RIGHT}" y2="132" stroke="${C.line}" stroke-width="2"/>`);
  return parts;
}

/** Close a card: append the footer and wrap the parts in the final SVG document. */
function cardClose(parts: string[], footerRight: string): string {
  parts.push(svgText(PAD, H - 44, "hookswap.org", { size: 24, fill: C.green, weight: 600 }));
  parts.push(svgText(RIGHT, H - 44, footerRight, { size: 22, fill: C.faint, anchor: "end" }));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parts.join("") +
    `</svg>`
  );
}

/** A labelled stat column: faint caps label over a big value (mono by default). */
function stat(
  x: number,
  label: string,
  value: string,
  opts?: { fill?: string; family?: string; size?: number },
): string {
  return (
    svgText(x, 330, label, { size: 22, fill: C.faint, ls: 1.5 }) +
    svgText(x, 384, value, {
      size: opts?.size ?? 40,
      fill: opts?.fill ?? C.ink,
      family: opts?.family ?? MONO,
    })
  );
}

/** A gold "Unpriced" chip at (x, 352) — the honest omission for a missing USD figure. */
function unpricedChip(x: number, width = 188): string {
  return (
    `<rect x="${x}" y="352" width="${width}" height="40" rx="8" fill="${C.goldBg}" stroke="${C.gold}" stroke-width="1.5"/>` +
    svgText(x + width / 2, 379, "Unpriced", { size: 22, fill: C.gold, weight: 600, anchor: "middle" })
  );
}

/** The shared term/progress bar (track + fill). */
function drawBar(parts: string[], frac: number, fillColor: string): void {
  parts.push(
    `<rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="14" rx="7" fill="${C.panel2}" stroke="${C.line}" stroke-width="1"/>`,
  );
  const fillW = Math.max(0, Math.min(BAR_W, Math.round(BAR_W * frac)));
  if (fillW > 0) {
    parts.push(`<rect x="${BAR_X}" y="${BAR_Y}" width="${fillW}" height="14" rx="7" fill="${fillColor}"/>`);
  }
}

// ==================================================================== LOCKS ====

/** The lock's headline title: "SYM0 / SYM1" for LP locks, else the token symbol. */
function lockTitle(lock: Lock): string {
  if (lock.isLpToken && lock.lp) {
    return `${lock.lp.token0.symbol} / ${lock.lp.token1.symbol}`;
  }
  return lock.symbol;
}

/** Build the 1200×630 card SVG for a lock. */
function lockSvg(lock: Lock, nowSec: number): string {
  const priced = typeof lock.valueUsd === "number";
  const unlocked = lock.unlockTime <= nowSec;
  const kind = lock.isLpToken ? "LP LOCK" : "TOKEN LOCK";
  const title = clip(lockTitle(lock), 26);
  const amountStr = `${fmtAmount(lock.amount.formatted)} ${clip(
    lock.isLpToken ? "LP" : lock.symbol,
    14,
  )}`;
  const p = elapsedFrac(lock.createdAt, lock.unlockTime, nowSec);

  const parts = cardOpen(lock.chainName);

  // Eyebrow + title.
  parts.push(
    svgText(PAD, 190, `${kind}  ·  #${lock.id}`, { size: 24, fill: C.gold, family: MONO, ls: 2 }),
  );
  parts.push(svgText(PAD, 268, title, { size: 66, fill: C.ink, weight: 600 }));

  // Two stat blocks: locked amount | USD value.
  parts.push(stat(PAD, "LOCKED AMOUNT", clip(amountStr, 26), { size: 42 }));
  if (priced) {
    parts.push(stat(COL_B2, "USD VALUE", fmtUsd(lock.valueUsd as number), { fill: C.greenUp, size: 42 }));
  } else {
    parts.push(svgText(COL_B2, 330, "USD VALUE", { size: 22, fill: C.faint, ls: 1.5 }));
    parts.push(unpricedChip(COL_B2));
  }

  // Lock-term progress bar.
  const statusColor = unlocked ? C.red : C.greenUp;
  parts.push(svgText(PAD, BAR_Y - 18, `Locked ${fmtDateUtc(lock.createdAt)}`, { size: 22, fill: C.faint, family: MONO }));
  parts.push(
    svgText(RIGHT, BAR_Y - 18, `Unlocks ${fmtDateUtc(lock.unlockTime)}`, {
      size: 22,
      fill: statusColor,
      family: MONO,
      anchor: "end",
    }),
  );
  drawBar(parts, p, unlocked ? C.red : C.green);

  // Status line under the bar.
  const statusText = unlocked
    ? "Unlocked — withdrawable"
    : `Unlocks in ${countdown(lock.unlockTime, nowSec)}`;
  parts.push(`<rect x="${PAD}" y="${BAR_Y + 30}" width="14" height="14" rx="3" fill="${statusColor}"/>`);
  parts.push(svgText(PAD + 24, BAR_Y + 42, statusText, { size: 24, fill: C.ink2, weight: 600 }));
  if (lock.lockedPctOfSupply !== null && !lock.isLpToken) {
    parts.push(
      svgText(RIGHT, BAR_Y + 42, `${lock.lockedPctOfSupply.toFixed(2)}% of supply`, {
        size: 24,
        fill: C.ink2,
        family: MONO,
        anchor: "end",
      }),
    );
  }

  return cardClose(parts, "Proof of Lock · verify on-chain");
}

// ==================================================================== FARMS ====

/** Build the 1200×630 card SVG for a farm. */
function farmSvg(farm: Farm, nowSec: number): string {
  const staking = farm.stakingToken.symbol;
  const reward = farm.rewardToken.symbol;
  const priced = typeof farm.tvlUsd === "number";
  const hasApr = typeof farm.aprPct === "number";
  const ended = farm.periodFinish <= nowSec; // fresh at render time
  const start = farm.periodFinish - farm.rewardsDuration;
  const frac = farm.rewardsDuration > 0 ? elapsedFrac(start, farm.periodFinish, nowSec) : ended ? 1 : 0;

  const title = clip(`${clip(staking, 12)} → ${clip(reward, 12)}`, 26);
  const stakedStr = `${fmtAmount(farm.tvlStaked.formatted)} ${clip(staking, 10)}`;

  const parts = cardOpen(farm.chainName);

  // Eyebrow + title.
  parts.push(
    svgText(PAD, 190, `FARM  ·  ${shortAddr(farm.farm)}`, { size: 24, fill: C.gold, family: MONO, ls: 2 }),
  );
  parts.push(svgText(PAD, 268, title, { size: 66, fill: C.ink, weight: 600 }));

  // Three stat blocks: total staked | TVL (USD) | APR.
  parts.push(stat(COL1, "TOTAL STAKED", clip(stakedStr, 18)));
  if (priced) {
    parts.push(stat(COL2, "TVL (USD)", fmtUsd(farm.tvlUsd as number), { fill: C.greenUp }));
  } else {
    parts.push(svgText(COL2, 330, "TVL (USD)", { size: 22, fill: C.faint, ls: 1.5 }));
    parts.push(unpricedChip(COL2, 168));
  }
  parts.push(
    hasApr
      ? stat(COL3, "APR", `${(farm.aprPct as number).toFixed(2)}%`, { fill: C.greenUp })
      : stat(COL3, "APR", "—", { fill: C.faint }),
  );

  // Reward-period progress bar.
  const statusColor = ended ? C.red : C.greenUp;
  parts.push(
    svgText(PAD, BAR_Y - 18, `Started ${fmtDateUtc(start)}`, { size: 22, fill: C.faint, family: MONO }),
  );
  parts.push(
    svgText(RIGHT, BAR_Y - 18, `Ends ${fmtDateUtc(farm.periodFinish)}`, {
      size: 22,
      fill: statusColor,
      family: MONO,
      anchor: "end",
    }),
  );
  drawBar(parts, frac, ended ? C.red : C.green);

  // Status line under the bar.
  const statusText = ended
    ? "Reward period ended"
    : `Rewards active · ends in ${humanize(farm.periodFinish - nowSec)}`;
  parts.push(`<rect x="${PAD}" y="${BAR_Y + 30}" width="14" height="14" rx="3" fill="${statusColor}"/>`);
  parts.push(svgText(PAD + 24, BAR_Y + 42, statusText, { size: 24, fill: C.ink2, weight: 600 }));
  parts.push(
    svgText(RIGHT, BAR_Y + 42, `${fmtAmount(farm.rewardBudget.formatted)} ${clip(reward, 8)} / period`, {
      size: 24,
      fill: C.ink2,
      family: MONO,
      anchor: "end",
    }),
  );

  return cardClose(parts, "HookSwap Farms · verify on-chain");
}

// ================================================================== VESTING ====

/** Fresh (render-time) vesting status from the schedule's cliff/end and now. */
function vestingStatus(s: VestingSchedule, nowSec: number): "cliff" | "vesting" | "complete" {
  return nowSec < s.cliffTime ? "cliff" : nowSec >= s.endTime ? "complete" : "vesting";
}

/** Build the 1200×630 card SVG for a vesting schedule. */
function vestingSvg(schedule: VestingSchedule, nowSec: number): string {
  const sym = schedule.token.symbol;
  const status = vestingStatus(schedule, nowSec);
  const claimableN = Number(schedule.claimable.formatted);
  const hasClaimable = Number.isFinite(claimableN) && claimableN > 0;
  const frac = Math.max(0, Math.min(1, schedule.pctVested / 100));

  const parts = cardOpen(schedule.chainName);

  // Eyebrow (left) + beneficiary (right) + title.
  parts.push(
    svgText(PAD, 190, `VESTING  ·  #${schedule.id}`, { size: 24, fill: C.gold, family: MONO, ls: 2 }),
  );
  parts.push(
    svgText(RIGHT, 190, `→ ${shortAddr(schedule.beneficiary)}`, {
      size: 22,
      fill: C.ink2,
      family: MONO,
      anchor: "end",
    }),
  );
  parts.push(svgText(PAD, 268, clip(sym, 26), { size: 66, fill: C.ink, weight: 600 }));

  // Three stat blocks: total granted | vested % | claimable.
  parts.push(stat(COL1, "TOTAL GRANTED", clip(`${fmtAmount(schedule.totalAmount.formatted)} ${clip(sym, 10)}`, 18)));
  parts.push(stat(COL2, "VESTED", `${schedule.pctVested.toFixed(1)}%`, { fill: C.greenUp }));
  parts.push(
    stat(COL3, "CLAIMABLE", clip(`${fmtAmount(schedule.claimable.formatted)} ${clip(sym, 8)}`, 16), {
      fill: hasClaimable ? C.greenUp : C.ink,
    }),
  );

  // Vesting progress bar (fill = vested fraction).
  const cliffColor = status === "cliff" ? C.gold : status === "complete" ? C.greenUp : C.greenUp;
  const fillColor = status === "cliff" ? C.gold : C.green;
  const leftLabel =
    schedule.cliff > 0 ? `Cliff ${fmtDateUtc(schedule.cliffTime)}` : `Start ${fmtDateUtc(schedule.start)}`;
  parts.push(svgText(PAD, BAR_Y - 18, leftLabel, { size: 22, fill: C.faint, family: MONO }));
  parts.push(
    svgText(RIGHT, BAR_Y - 18, `Ends ${fmtDateUtc(schedule.endTime)}`, {
      size: 22,
      fill: cliffColor,
      family: MONO,
      anchor: "end",
    }),
  );
  drawBar(parts, frac, fillColor);

  // Status line under the bar.
  const statusText =
    status === "cliff"
      ? `In cliff · vesting starts in ${humanize(schedule.cliffTime - nowSec)}`
      : status === "complete"
        ? "Fully vested"
        : `Vesting · fully vests in ${humanize(schedule.endTime - nowSec)}`;
  parts.push(`<rect x="${PAD}" y="${BAR_Y + 30}" width="14" height="14" rx="3" fill="${cliffColor}"/>`);
  parts.push(svgText(PAD + 24, BAR_Y + 42, statusText, { size: 24, fill: C.ink2, weight: 600 }));
  parts.push(
    svgText(
      RIGHT,
      BAR_Y + 42,
      `${fmtAmount(schedule.vested.formatted)} / ${fmtAmount(schedule.totalAmount.formatted)} ${clip(sym, 8)}`,
      { size: 24, fill: C.ink2, family: MONO, anchor: "end" },
    ),
  );

  return cardClose(parts, "HookSwap Vesting · verify on-chain");
}

// ------------------------------------------------------------------- public API

function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    background: C.bg,
    fitTo: { mode: "width", value: 1200 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: SANS },
  });
  return resvg.render().asPng();
}

/** Render a lock's 1200×630 social card to a PNG buffer (self-contained). */
export function renderLockOgPng(lock: Lock): Buffer {
  return renderPng(lockSvg(lock, Math.floor(Date.now() / 1000)));
}

/** Render a farm's 1200×630 social card to a PNG buffer (self-contained). */
export function renderFarmOgPng(farm: Farm): Buffer {
  return renderPng(farmSvg(farm, Math.floor(Date.now() / 1000)));
}

/** Render a vesting schedule's 1200×630 social card to a PNG buffer (self-contained). */
export function renderVestingOgPng(schedule: VestingSchedule): Buffer {
  return renderPng(vestingSvg(schedule, Math.floor(Date.now() / 1000)));
}

/** Shared crawler HTML: OG/Twitter meta (image → `imageUrl`) + a refresh/JS redirect
 *  to the human, hash-routed in-app page (`appUrl`). Exists because the app is a
 *  hash-routed SPA whose per-route meta can't be crawled. */
function shareHtml(opts: {
  title: string;
  description: string;
  imageUrl: string;
  appUrl: string;
  siteName: string;
  redirectNoun: string;
}): string {
  const t = esc(opts.title);
  const d = esc(opts.description);
  const img = esc(opts.imageUrl);
  const app = esc(opts.appUrl);
  const site = esc(opts.siteName);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<meta name="description" content="${d}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${site}"/>
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
<script>window.location.replace(${JSON.stringify(opts.appUrl)});</script>
</head>
<body style="margin:0;background:${C.bg};color:${C.ink};font-family:system-ui,sans-serif">
<p style="padding:24px">Redirecting to the HookSwap ${esc(opts.redirectNoun)} page… If you are not redirected, <a style="color:${C.green}" href="${app}">open it here</a>.</p>
</body>
</html>`;
}

/** Crawler HTML for a lock (OG/Twitter meta + redirect to the in-app lock page). */
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

  return shareHtml({
    title,
    description,
    imageUrl,
    appUrl: appLockUrl,
    siteName: "HookSwap Locker",
    redirectNoun: "lock",
  });
}

/** Crawler HTML for a farm (OG/Twitter meta + redirect to the in-app farm page). */
export function farmShareHtml(farm: Farm, imageUrl: string, appFarmUrl: string): string {
  const staking = farm.stakingToken.symbol;
  const reward = farm.rewardToken.symbol;
  const nowSec = Math.floor(Date.now() / 1000);
  const ended = farm.periodFinish <= nowSec;
  const title = `${staking} → ${reward} farm · HookSwap`;
  const tvlBit = typeof farm.tvlUsd === "number" ? ` · ${fmtUsd(farm.tvlUsd)} TVL` : "";
  const aprBit = typeof farm.aprPct === "number" ? ` · ${farm.aprPct.toFixed(2)}% APR` : "";
  const statusBit = ended
    ? "rewards ended"
    : `rewards active (ends in ${humanize(farm.periodFinish - nowSec)})`;
  const description = `Stake ${staking}, earn ${reward}. ${fmtAmount(
    farm.tvlStaked.formatted,
  )} ${staking} staked${tvlBit}${aprBit} · ${statusBit} on ${farm.chainName}. Stake & earn on HookSwap.`;

  return shareHtml({
    title,
    description,
    imageUrl,
    appUrl: appFarmUrl,
    siteName: "HookSwap Farms",
    redirectNoun: "farm",
  });
}

/** Crawler HTML for a vesting schedule (OG/Twitter meta + redirect to the in-app page). */
export function vestingShareHtml(
  schedule: VestingSchedule,
  imageUrl: string,
  appVestingUrl: string,
): string {
  const sym = schedule.token.symbol;
  const nowSec = Math.floor(Date.now() / 1000);
  const status = vestingStatus(schedule, nowSec);
  const title = `${sym} vesting schedule · HookSwap`;
  const usdBit = typeof schedule.valueUsd === "number" ? ` (${fmtUsd(schedule.valueUsd)} locked)` : "";
  const statusBit =
    status === "cliff"
      ? `in cliff — starts vesting in ${humanize(schedule.cliffTime - nowSec)}`
      : status === "complete"
        ? "fully vested"
        : `vesting — fully vests in ${humanize(schedule.endTime - nowSec)}`;
  const description = `${fmtAmount(schedule.totalAmount.formatted)} ${sym} vesting${usdBit} · ${schedule.pctVested.toFixed(
    1,
  )}% vested to ${shortAddr(schedule.beneficiary)} · ${statusBit} on ${schedule.chainName}. Verify on-chain on HookSwap.`;

  return shareHtml({
    title,
    description,
    imageUrl,
    appUrl: appVestingUrl,
    siteName: "HookSwap Vesting",
    redirectNoun: "vesting",
  });
}
