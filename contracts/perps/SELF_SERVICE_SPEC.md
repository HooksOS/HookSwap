# HookSwapPerps — Self-Service Markets + Platform Fees (Design Spec)

> Goal: let **any project launch its own perp market** (permissionless, config + one tx — no HookSwap admin action, no redeploy), while **HookSwap (the platform) earns a DEX fee on every trade in every market**. Projects also earn a share to incentivize launching + volume.
>
> Status: DESIGN. The current contracts do NOT support this (see Gap Analysis). This is a contract-layer redesign, not a config change. Sepolia-first per the mandatory rule.

---

## 1. Current state — why self-service is blocked today (verified in `Settlement.sol`)

| Gap | Evidence | Why it blocks self-service |
|---|---|---|
| **One global collateral pool per user** | `mapping(address => UserBalance) balances` — `{available, locked}`, NOT per-market, NOT per-token (all deposits credit the same `available`, L227/262) | A single manipulable market could lock/drain a user's entire balance across ALL markets. Self-service REQUIRES per-market isolation. |
| **Everything is `onlyOwner`** | `addSupportedToken`, `setAuthorizedMatcher`, `setContractSpec`, `setFeeRate`… all `onlyOwner` | No path for a project to create a market itself. |
| **No factory / `createMarket`** | grep: none exists | Nothing to permissionlessly instantiate a market. |
| **Single `feeReceiver`** | `balances[feeReceiver].available += perSideFee * 2` (L587) | Can't split fees between platform + market creator. |
| **`MAX_LEVERAGE = 100x` is a `constant`** | L44 | Per-market leverage can't be tuned without a redeploy. |
| **Trusted off-chain matcher** | `authorizedMatchers` gates `settleBatch` | Someone must run matching per market — a trust/scaling decision. |
| **Mark price is a matcher-supplied scalar** | `tokenPrices`, `updatePrice` | No on-chain oracle safety → permissionless markets are oracle-manipulation targets. |

**Takeaway:** the P2P core (EIP-712 match → on-chain settle) is sound and market-agnostic, but collateral, fees, access control, and oracle trust must be re-architected for multi-tenant use.

---

## 2. Recommended architecture — factory + isolated markets + shared platform core

```
                        ┌────────────────────── PlatformCore (HookSwap-owned, shared) ──────────────────────┐
                        │  FeeRouter   MarketRegistry   InsuranceHub   OracleRouter   ParamGuard   Treasury  │
                        └───────▲──────────▲──────────────▲───────────────▲──────────────▲───────────────────┘
                                │          │              │               │              │
   project ── createMarket() ──►│  PerpMarketFactory (EIP-1167 minimal-proxy clones)     │
                                │          │              │               │              │
                     ┌──────────┴──┐  ┌────┴────────┐  ┌──┴──────────┐  (each clone reads shared core)
                     │ PerpMarket A│  │ PerpMarket B│  │ PerpMarket C│   ← ISOLATED collateral + risk per market
                     │ (own vault) │  │ (own vault) │  │ (own vault) │
                     └─────────────┘  └─────────────┘  └─────────────┘
```

- **`PerpMarketFactory.createMarket(cfg)`** — permissionless (subject to tier + bond, §5). Deploys a **minimal-proxy `PerpMarket`** clone (cheap gas, one audited implementation) with the creator's config, registers it in `MarketRegistry`, and returns the market address.
- **`PerpMarket` (per market, ISOLATED)** — holds ONLY that market's collateral + positions; runs the P2P `settleBatch`/liquidation/funding logic from today's `Settlement`, refactored so its `balances` are local to the clone. **A blowup in market B cannot touch market A or C.** This is the single most important change.
- **`PlatformCore` (shared, HookSwap-owned):**
  - **FeeRouter** — every market routes its fees here; splits + forwards (see §4). This is where the **platform DEX fee** is captured, non-bypassably.
  - **MarketRegistry** — enumerable list of markets, their tier, creator, oracle config, status; the frontend + perps-engine read this. Emits `MarketCreated`.
  - **InsuranceHub** — per-market insurance sub-accounts + an optional platform backstop tranche; socialized-loss rules.
  - **OracleRouter** — the existing pluggable `perps-engine/oracle` registry given an on-chain safety wrapper (§6): venue allowlist, min-liquidity, TWAP, deviation breaker.
  - **ParamGuard** — global hard bounds (max leverage ceiling, min maintenance margin, fee floors/ceilings) that every market config is clamped to on creation (§8). Fixes the `100x` constant → per-market value within a global cap.
  - **Treasury** — receives the platform fee stream + creation bonds.

Why clones over one shared contract with market buckets: **true asset isolation** (separate balances by construction, not by accounting discipline), a smaller audit surface (one implementation), and clean per-market pause/kill — the standard safe pattern for permissionless perps.

---

## 3. Market lifecycle

1. **Create** — project calls `factory.createMarket(cfg)` with: underlying/market id, collateral token, oracle source (from allowlist), leverage cap (≤ global), maintenance-margin, funding params, creator-fee bps (≤ cap), tier. Pays the creation bond (§5). Factory clones + registers + emits `MarketCreated`.
2. **List** — perps-engine picks up `MarketCreated`, spins the oracle route + (shared) matcher lane; frontend shows it under the correct tier badge.
3. **Trade** — users deposit collateral **into that market's** vault, trade via EIP-712 match → `settleBatch`. Fees flow to FeeRouter every settlement.
4. **Maintain** — funding accrues, liquidations run, insurance sub-account backstops that market.
5. **Kill switch** — creator can pause deposits/new-positions; **HookSwap (ParamGuard/registry) can force-pause any market** (scam/oracle failure) → positions settle/close-only, collateral withdrawable. Bond slashable for provable abuse.

---

## 4. Fee model — **the recommendation (this is what earns the platform money)**

**Every trade settlement charges a total fee; the FeeRouter splits it on-chain into three streams:**

```
totalFee (per side) = matchSize * marketFeeRateBps / 10_000     // taker-style, as today

 ├── PLATFORM  (HookSwap)   = totalFee * platformShareBps / 10_000   → Treasury      [HARD FLOOR, creators can't zero it]
 ├── CREATOR   (the project)= totalFee * creatorShareBps  / 10_000   → market creator [their incentive to launch/drive volume]
 └── INSURANCE (that market)= totalFee * insuranceShareBps/ 10_000   → market InsuranceHub sub-account
```

**Recommended defaults (tunable via ParamGuard, within bounds):**
- **Market fee rate:** creator picks per market, clamped to **`[MIN_FEE=2bps … MAX_FEE=15bps]`** per side.
- **Platform share:** **50%** of every fee, with a **hard floor of 40%** — enforced in FeeRouter so a creator can never route less than the floor to HookSwap. *This is the platform DEX fee: HookSwap earns on every market, every trade, forever, with zero per-market ops.*
- **Creator share:** **up to 40%.** Gives projects a real reason to launch + market their perp (they earn on their own volume).
- **Insurance share:** **≥10%**, per-market, to make each market self-insuring.

**Second platform revenue stream — creation bond/fee:**
- `createMarket` requires a **bond** (e.g. a fixed amount of a stable, or staked HOOK). For the **permissionless tier** the bond is larger (spam/scam deterrent) and **slashable** on force-pause-for-abuse; for the **curated tier** it can be waived. A portion of the bond can be a non-refundable **listing fee → Treasury** (third revenue line).

**Also route to the platform:** a configurable cut of **liquidation penalties** and **funding imbalance** (today these already flow toward the insurance fund; split a platform bps off the top).

**Net platform revenue = (≥40% of all trading fees across every market) + (listing fees/bonds) + (a cut of liquidation/funding).** All captured in FeeRouter/Treasury — non-bypassable because markets can only settle through the clone, and the clone hard-codes the FeeRouter address from PlatformCore.

**Why a floored split (not "platform takes all" or "creator sets everything"):** a guaranteed platform floor protects HookSwap's revenue; a real creator share is what actually gets projects to launch markets (the flywheel); a mandatory insurance slice keeps each market solvent so platform fees aren't eaten by socialized losses. This mirrors how successful app-chain / launchpad perps (and AMM launchpads) align platform + creator incentives.

---

## 5. Permission tiers (permissionless, but not a free-for-all)

| | **Curated** | **Permissionless** |
|---|---|---|
| Who | HookSwap-reviewed (blue-chip asset, vetted oracle) | Anyone |
| Bond | waivable / small | larger, **slashable** |
| Leverage cap | up to global max (e.g. 50–100×) | conservative (e.g. ≤10–20×) |
| Oracle | any allowlisted incl. AMM/Chainlink | **restricted** to high-liquidity/dual-source only (§6) |
| UI label | verified badge | "community / unaudited — trade at risk" |
| Platform fee floor | same (≥40%) | same (≥40%) |

Permissionless creation is real, but conservative caps + oracle restrictions + a slashable bond + force-pause bound the blast radius.

---

## 6. Oracle safety (the top attack surface for permissionless markets)

A project picking a thin AMM pool as its price source is the classic drain vector. On-chain guards in OracleRouter:
- **Venue allowlist** per source type (which AMMs/feeds are eligible), curated by ParamGuard.
- **Min-liquidity / min-depth** threshold for AMM sources at creation + continuously; below it → market auto-close-only.
- **TWAP windows** (not spot) for AMM prices; **deviation circuit-breaker** — if mark deviates > X% from a reference (e.g. Chainlink) within N blocks, pause settlement.
- **Dual-source requirement for the permissionless tier** (e.g. AMM TWAP *and* a Chainlink/Pyth reference must agree within tolerance).
- RWA/stocks: Chainlink `latestRoundData` with staleness + corporate-action rules already designed in `perps-engine/oracle` (registry). Reuse.

The pluggable off-chain registry stays; this adds the **on-chain trust layer** self-service demands.

---

## 7. Risk isolation & insurance
- **Isolated collateral** by construction (per-clone vault).
- **Per-market insurance sub-account** funded by the insurance fee slice + liquidation penalties; covers that market's bad-debt first.
- **Optional platform backstop tranche** (HookSwap-funded) that curated markets may draw on after their own insurance is exhausted — a curation perk, never auto-exposed to permissionless markets.
- **Socialized loss** (ADL / haircut) is scoped to a single market only.

---

## 8. Parameter bounds — fix the `100x` constant
- Replace `MAX_LEVERAGE` constant with a **per-market `maxLeverage`** in the clone config, **clamped on creation to a global `PLATFORM_MAX_LEVERAGE`** in ParamGuard (adjustable by governance, not by creators).
- Same pattern for maintenance margin (min), funding rate bounds, fee rate `[MIN_FEE,MAX_FEE]`, platform-share floor. All enforced at `createMarket` and on any later param change.

---

## 9. Matcher model (off-chain matching in a multi-tenant world)
- **Recommended: HookSwap runs a shared sequencer/matcher** (one authorized matcher per market lane, keys held by the platform), so users trust HookSwap, not each project. Scales as lanes in the existing `perps-engine`. Keeps fill integrity centralized + auditable.
- Alternative (later): permissionless matchers with bonded fill-integrity + fraud proofs — more decentralized, much more complex. Not for v1.
- Anti-grief: nonces + `filledAmounts` already prevent replay/over-fill; add per-market rate limits.

---

## 10. Off-chain + frontend
- **perps-engine:** watch `MarketCreated`; auto-provision oracle route (from the market's config) + matcher lane + funding/liquidation keeper per market. Registry-driven, no code change per market.
- **Frontend (Terminal):** a **"Launch a perp market" self-service wizard** (asset, collateral, oracle source from allowlist, leverage/fee sliders bounded by ParamGuard, tier, bond) → one `createMarket` tx. Plus a markets directory reading `MarketRegistry` with tier badges. Reuses the Pro-Desk perps UI per market. (Ties into the existing self-service/LaunchPad surface.)

---

## 11. Security & rollout
- **New/changed contracts:** PerpMarketFactory, PerpMarket (refactored isolated Settlement), FeeRouter, MarketRegistry, InsuranceHub (multi-account), OracleRouter (on-chain guards), ParamGuard, Treasury. **Full audit required** before mainnet — permissionless + shared fees = high-value target.
- **Purge** the source repo's committed plaintext relayer key + `SKIP_SIGNATURE_VERIFY` before any reuse.
- **Sepolia-first (mandatory):** deploy the full factory + one curated + one permissionless market on Sepolia; run the §... smoke test (create → deposit → match → fee-split assertions → liquidation → force-pause → bond-slash) before any production chain. The current single-instance Sepolia deploy (`config/sepolia.json`) is the migration baseline.

---

## 12. Open decisions for Reggie
1. **Platform-share floor** — 40%? higher? (revenue vs. creator incentive).
2. **Bond currency** — stable, native, or **staked HOOK** (adds token utility)?
3. **Permissionless leverage cap** — ≤10×? ≤20×?
4. **Platform backstop tranche** — fund it (curation perk) or per-market-insurance-only?
5. **Matcher** — confirm HookSwap-run shared sequencer for v1.
6. **Curation gate** — who approves the curated tier (multisig / governance)?
