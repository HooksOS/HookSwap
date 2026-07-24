# HookSwapPerps — Internal Findings Log (pre-audit history)

> **Purpose.** Give the external auditor the honest remediation history so they can (a) verify each fix
> is real and complete, and (b) re-attack the areas that were touched. This is an **internal** log, not
> an audit. Every fix is cited `file:line` and tied to the test that covers it. Two findings remain open
> as LOW/informational notes (§7). Nothing here should be read as "audited" or "safe."

**Verified test status at time of writing:** `forge test` = **58 passed / 0 failed**
(48 local + 10 Sepolia-fork). See `INVARIANTS.md` for the per-file breakdown.

The remediation happened over roughly **five internal rounds**. Round boundaries are reconstructed from
`SECURITY_REVIEW.md`, in-code comments, and the test suite; treat them as approximate.

| Round | Theme | Source of record |
|---|---|---|
| R1 | Factory internal security review (H/M/L catalogue) | `SECURITY_REVIEW.md` §2–4 |
| R2 | Pass 1 — guard/limit/insurance wiring (impl v4) | `SECURITY_REVIEW.md` §6; `config/factory-sepolia.json.guardWiring` |
| R3 | Pass 2 — liquidation/deposit/bond fixes (impl v5, BondManager v2) | `SECURITY_REVIEW.md` §6; `…securityFixesV5` |
| R4 | Adversarial "round-4" audit — fund-safety (F-1/F-2), self-match, MED-1/2/3, winner-cap | in-code `// F-1/F-2/MED-*/HIGH-1/LOW-1` comments; `Round4*.t.sol`, `SecurityFixesV5.t.sol`, `GuardWiring.t.sol` |
| R5 | Fund-rescue + emergency-exit hardening (S-2, bounded rescues) | `FundRescue.t.sol`; `PerpMarket.sol` escape hatches |

---

## 1. Fund-safety issues found + FIXED (the load-bearing ones)

### F-1 — Unbacked funding credit (funding paid out of thin air)

- **Vulnerability.** The pre-fix settlement **pre-credited a funding amount to insurance that was not
  backed by tokens actually withheld from the traders** — it added a funding liability without
  guaranteeing the collateral to cover it, so the internal ledger could owe more than the clone held.
- **Fix.** Funding is settled **inside** `_settleProfit` from `pos.accFunding*`, and each side's funding
  charge is **capped at that side's realized output** so the credit is always backed by tokens actually
  withheld: `PerpMarket.sol:933-947` (`if (fLong > longOut) fLong = longOut; … longOut -= fLong;`),
  documented `PerpMarket.sol:895-896, 1066`; ported to `Settlement.sol:820, 838-840, 870, 979`. Callers
  must **not** pre-subtract funding.
- **Test.** `SecurityFixesV5.t.sol::test_F2_BothNegativePnL_FundingBacked_NoDrain` asserts
  `insAfter == fundingPerSide * 2` — insurance receives **exactly** the backed funding, nothing invented.

### F-2 — Negative-cast insurance drain (both-negative PnL underflow)

- **Vulnerability.** When funding was pre-subtracted, **both** sides' funding-adjusted PnL could go
  negative. The settlement then did `uint256(negativePnL)` on a negative `int256`, casting to ~2^256 →
  a wrong (astronomically large) pay-out to one side and a bogus winner-deficit that **drained the
  insurance fund**. A close with no price move but accrued funding triggered it.
- **Fix.** PnL fed to `_settleProfit` is the **zero-sum price PnL only** (`shortPnL == -longPnL`), so
  `longPnL < 0 ⇒ shortPnL > 0` and the `uint256(shortPnL)` cast can never see a negative:
  `PerpMarket.sol:890-931` (guarded `if (longPnL >= 0) … else …`), documented `:892-894`; ported to
  `Settlement.sol:838-840`.
- **Test.** `SecurityFixesV5.t.sol::test_F2_BothNegativePnL_FundingBacked_NoDrain` — accrues funding over
  3 intervals with **no** price move (both sides negative pre-fix), then asserts value is conserved:
  `aAvail + bAvail + insAfter + feePerSide*2 == dep*2`, symmetric (`aAvail == bAvail`), no drain, no mint.

### Self-match / collusion insurance harvest → winner-cap (HIGH-1 + LOW-1)

- **Vulnerability.** Two mechanisms let a **delta-neutral self/colluding pair harvest insurance at ~zero
  risk**: (a) one wallet on both sides of a match, and (b) the old M-1 design where a winner's profit
  **beyond the loser's collateral was topped up from the shared insurance** (`_coverWinnerDeficit`). A
  colluding pair could manufacture a large winner deficit and drain the per-market insurance.
- **Fix (two parts).**
  1. **Self-match forbidden** (HIGH-1): `if (pair.longOrder.trader == pair.shortOrder.trader) revert
     InvalidMatch();` — `PerpMarket.sol:708-710`; ported `Settlement.sol:646`.
  2. **Winner-cap / isolated margin** (LOW-1): `_coverWinnerDeficit` was **removed**; the winner is
     **capped at the counterparty's collateral** and never topped up from insurance or socialized —
     the uncovered excess is simply not paid (only `emit WinnerCapped`): `PerpMarket.sol:952-958`
     (comment `:1222` records the removal); ported `Settlement.sol:870, 889`. This **supersedes** the
     R2 M-1 "insurance covers the winner deficit" behavior (decision 2026-07-24).
- **Test.** `GuardWiring.t.sol::test_4_WinnerCappedNoInsuranceDraw` seeds the market's InsuranceHub
  sub-account, drives a winner's notional profit **past** the loser's collateral, and asserts the hub
  balance is **unchanged** and the winner is credited exactly own+counterparty collateral (`1e15`, not
  `1.5e15`). Winner-cap arithmetic also fuzzed: `PerpFuzz.t.sol::testFuzz_winnerGainBoundedByLoserCollateral`
  and `testFuzz_settlePnLZeroSum` (no mint: `endSum <= startSum`).

### S-2 — Paused market + lost/abandoned owner freezes user funds forever

- **Vulnerability.** If a market is paused (incident) and the owner key is later lost or the operator
  abandons it, users' collateral is **frozen indefinitely** — `withdraw` is `whenNotPaused`
  (`PerpMarket.sol:378`) and only the owner can unpause. No user-triggerable exit existed.
- **Fix.** An **owner-independent escape hatch**: after the market has been paused past
  `EMERGENCY_WITHDRAW_DELAY`, **any** user may pull their own **unlocked (available)** collateral with
  no owner action — `PerpMarket.sol:662-674` (`emergencyWithdraw()`), comment `:655-660`. (Locked-in-
  position collateral still needs settlement/force-close — see the compound-edge note in §7.)
- **Test.** Not covered by a dedicated forge test in-repo (behavioral: requires warping past the delay
  on a paused clone). Flagged for the auditor to add explicit coverage. The `whenNotPaused` gating and
  the `pausedAt`/delay logic it relies on are exercised indirectly by the pause paths in the fork suites.

---

## 2. Oracle / price-integrity fixes (round-4 MED family)

### MED-1 — Reference feed mandatory for every fund-holding market

- **Vulnerability.** A **curated**-tier market could be created with **no reference feed**, leaving
  `_guardPrice` a no-op → the matcher could settle at an arbitrary price with no on-chain deviation
  check (the "dormant guard" vector). Originally the ref feed was only required for permissionless tier.
- **Fix.** `OracleGuard.validateConfig`/`registerMarket` now reject `refFeed == 0` for **all** tiers:
  `OracleGuard.sol:133-137, 152` (`if (cfg.refFeed == address(0)) revert RefFeedRequired();`).
- **Test.** `Round4Fixes.t.sol::test_MED1_ZeroRefFeedRejectedAtCreation` — a curated `createMarket` with
  `refFeed == 0` reverts `RefFeedRequired`; a real feed succeeds and is wired.

### MED-2 — Liveness lock: a down matcher can trap funds

- **Vulnerability.** Once the matcher stops refreshing the mark, the stored `tokenPrices` can drift
  **outside** the OracleGuard band, which then makes `closePair`/`liquidate` **revert** on `_guardPrice`
  → the position (and its collateral) is trapped, with no way out.
- **Fix (two parts).**
  1. **User close settles at the fresh reference price**, not the stale stored mark, so it is trivially
     in-band and always succeeds when a feed exists — `PerpMarket.sol:822` (comment), `_freshReferencePrice`
     `:1210-1218`; ported `Settlement.sol:764, 789-796`.
  2. **Owner `forceSettle` escape hatch**: after the mark has gone unrefreshed past `PRICE_STALE_GRACE`
     (1 hour, `:229`), the owner closes a position at the fresh reference price —
     `PerpMarket.sol:839-848`; ported `Settlement.sol:778-786`. Tracked via `lastPriceUpdate`
     (`:225, 684`).
- **Test.** `Round4Fixes.t.sol::test_MED2_CloseAtRefPriceWhenStoredMarkStaleOutOfBand` (close succeeds at
  the fresh ref price even when the stored mark is proven out-of-band) and
  `test_MED2_ForceSettleAfterGraceOnlyWhenStale` (reverts `NotStale` before the grace window; owner-only;
  closes at the fresh ref after).

### MED-3 — Signed LIMIT price never enforced on-chain (ported to `Settlement.sol`)

- **Vulnerability.** A signed `Order` carries `orderType`/`price`, but the matcher-supplied `matchPrice`
  was never checked against a LIMIT order's signed price → the matcher could fill any LIMIT order at any
  price. (Fixed in `PerpMarket` as H-2 in R2; the standalone `Settlement.sol` still lacked it.)
- **Fix.** LIMIT long fills only if `matchPrice <= order.price`, LIMIT short only if `>= order.price`,
  else `LimitPriceViolated` — `Settlement.sol:656, 234`; matches `PerpMarket.sol:719-724`. Plus the
  OracleGuard deviation band on every value-moving price via `_guardPrice` (`Settlement.sol:506-514,
  620, 651, 821, 911`).
- **Test.** `Round4Settlement.t.sol::test_MED3_LimitPriceEnforcedInSettlement` (LIMIT long filled above /
  LIMIT short filled below the signed price both revert; a compliant fill settles). `PerpMarket`'s
  equivalent: `GuardWiring.t.sol::test_3_H2_LimitPriceEnforced`.

---

## 3. R2 (Pass 1 / impl v4) — the "dormant guard" fixes

The R1 review found the OracleGuard + insurance were **deployed but not wired** into the settle path.
Pass 1 wired them (impl v4, factory repointed, address unchanged `0xa1A8C5A2…`):

- **H-1 (OracleGuard breaker wired).** `_guardPrice` now calls `OracleGuard.checkDeviation` on every
  price about to move value — at `updatePrice` (`PerpMarket.sol:682`), `_settlePair` entry (`:714`),
  close/ADL exit, and liquidation mark (`:911` in Settlement, mirrored in PerpMarket). Reverts
  `PriceDeviationTooLarge` / `StalePrice`. **Test:** `GuardWiring.t.sol::test_2_H1_DeviationBlocksSettle`
  (settle + updatePrice at 1.6x live Chainlink both revert); fuzzed `PerpFuzz.t.sol::testFuzz_oracleDeviationBand`,
  `testFuzz_oracleStaleness`, `testFuzz_guardWiredBlocksBadPrice`.
- **H-2 (signed LIMIT price).** As MED-3 above but in `PerpMarket` (`:719-724`). **Test:**
  `GuardWiring.t.sol::test_3_H2_LimitPriceEnforced`.
- **M-1 (insurance wired).** The factory now `setInsuranceFund(InsuranceHub)`; winner-shortfall handling
  wired. **Superseded in R4** by the winner-cap decision (insurance is now *never* drawn by a trade
  winner — see §1). **Test:** wiring asserted by `GuardWiring.t.sol::test_0_Wiring_CloneReferencesGuards`;
  the anti-harvest guarantee by `test_4_WinnerCappedNoInsuranceDraw`.

---

## 4. R3 (Pass 2 / impl v5 + BondManager v2) — liquidation, deposit, bond

- **M-3 — liquidation reward frequently unpayable.** Old code paid the liquidator only if the trader's
  residual `available >= penalty` (all-or-nothing), so the **deeply-underwater positions that most need
  closing paid the liquidator 0**. Fixed: pay `min(penalty, residual)/2` (partial reward), remainder to
  insurance. **Test:** `SecurityFixesV5.t.sol::test_1_M3L2_PartialLiquidationRewardAndRouting` (residual
  `< penalty` still pays `residual/2`, where old code paid 0).
- **L-2 — orphaned penalty counter.** The liquidation insurance slice went to a dead
  `pendingLiquidationPenalty` counter. Fixed: credited to `balances[insuranceFund].available` (spendable)
  when an insurance fund is wired — `PerpMarket.sol:945-946`. **Test:** same `test_1…` asserts the hub
  sub-account grows by the slice and `pendingLiquidationPenalty` stays 0.
- **L-3 — zero-normalized dust deposit.** A >18-decimal token amount could normalize to `standardAmount
  == 0` while `safeTransferFrom` already pulled the tokens. Fixed: all deposit paths `revert
  InvalidAmount()` when `standardAmount == 0`. **Test:** `SecurityFixesV5.t.sol::test_2_L3_ZeroNormalizedDepositReverts`
  (a 20-dec token: 99 units reverts, 100 units credits 1).
- **M-4 — bond trapped by a non-slashing pause.** `withdrawBond` required registry status `ACTIVE`, so
  the owner could `PAUSE` a market and trap the creator's bond indefinitely with no `slash` record.
  Fixed: reclaim blocked only if `slashed` **or** `DELISTED`; ordinary `PAUSED` no longer traps it —
  BondManager v2. **Test:** `SecurityFixesV5.t.sol::test_3_M4_PausedBondReclaimable` (PAUSED reclaimed in
  full; DELISTED still reverts `MarketNotActive`).

Design-accepted (not code-fixed) from R1: **M-2** (on-chain kill = `emergencyPause` + matcher-deauth,
registry status advisory), **L-1** (platform owner is trusted within a market; hard 100 bps / 100x
ceilings remain; a timelock/multisig is the real mitigation), **L-4** (`emergencyPause` is an intentional
global freeze; fees recoverable on unpause), **I-1** (first-come withdrawal on an insolvent market — inherent
to internal accounting), **I-2** (fee-on-transfer collateral excluded by allowlist). See `SECURITY_REVIEW.md`
§3/§6 for the full rationale.

---

## 5. R5 — bounded fund-rescue + emergency exits (no funds permanently stuck, no over-rescue)

Owner-guarded rescue paths were added so no funds can be permanently stuck — **bounded to truly-stranded
surplus** (raw balance minus tracked liabilities) so a rescue can never touch a live bond, an escrowed
slash, or an unclaimed fee. All covered by `FundRescue.t.sol` (31 tests, all local, no fork):

- **`BondManager.returnBond`** — owner releases a live bond (even a DELISTED-frozen one) to a chosen
  destination; decrements `totalBondsHeld`; blocks double-release. Tests: `test_returnBond_*`,
  `test_bondCounter_afterReturnBond`.
- **`BondManager.rescueETH`** — sweeps only ETH **above** live-bond + escrowed-slash liabilities
  (`stranded = balance − totalBondsHeld − totalSlashedEscrow`). Tests: `test_rescueETH_cannotSweepLiveBond`,
  `test_rescueETH_sweepsOnlySurplusOverBond`, `test_rescueETH_cannotSweepEscrowedSlash`, `…revertsOverdraw`.
- **`BondManager.slash` pull-fallback** — a treasury that rejects ETH cannot brick `slash`; the amount is
  escrowed to `slashedClaimable` and later pulled (`claimSlashed`). Tests:
  `test_slash_rejectingTreasuryEscrowsThenClaim`, `test_slash_normalTreasuryPushes`, `test_bondCounters_postSlashClaim`.
- **`InsuranceHub.ownerSweep`** — recovers a dead market's sub-account in one call, **preserving cross-
  market isolation** (sweeping A never touches B). Tests: `test_ownerSweep_recoversSubAccount`,
  `test_ownerSweep_isolationPreserved`, `…revertsOverdraw/ZeroAmount/ZeroTo/NonOwner`.
- **`FeeRouter.rescueToken`** — sweeps only tokens **above** `totalClaimable` (outstanding platform+creator
  fees stay put). Tests: `test_rescueToken_cannotSweepUnclaimedFee`, `test_rescueToken_sweepsOnlySurplusOverClaimable`,
  `test_feeRouter_totalClaimableTracksCollectAndClaim`.
- **`PerpMarket.emergencyWithdraw`** — the S-2 owner-independent exit (§1). **`rescueForeignToken`**
  (`PerpMarket.sol:648`) reverts on any *supported* collateral, so a rescue can never move user trading funds.

Every rescue is `onlyOwner` and rejects the attacker (`…revertsNonOwner` in each family).

---

## 6. Positive findings carried from R1 (auditor should still verify)

- **Clone / initializer / EIP-712 hardening is correct** (I-3): `_disableInitializers()` on the impl;
  `initialize` is `initializer` and called atomically inside `createMarket` (no front-run window);
  per-clone EIP-712 domain (`verifyingContract == clone`); no cross-market signature replay found.
  `PerpMarket.sol:233-247` region.
- **Factory ordering** — all config set **before** `transferOwnership` (creator gets no control).
- **Fee floor** — `FeeRouter.platformFloorBps` is immutable with no setter; the platform share can never
  drop below it. Fuzzed: `PerpFuzz.t.sol::testFuzz_feeSplitConservation`.

---

## 7. Remaining open notes (LOW / informational — NOT fixed)

### N-1 (LOW / informational) — inaccurate "storage-append" comment

`PerpMarket.sol:202` and `:224` comment that guard-wiring / liveness storage fields are "APPENDED at the
end of storage (clone-layout safe)." The **append discipline is only clone-safe for markets minted by the
impl version that declared the field** — clones minted by an earlier impl keep the older layout and do not
gain the new storage (consistent with `SECURITY_REVIEW.md` §6 scope note: "impl v5 applies to markets
created *after* the repoint"). The comment can mislead a future maintainer into assuming all live clones
share the current layout. **Residual risk: low** (operational — mint production markets only after the
final impl is wired; already in `PRE-MAINNET-CHECKLIST.md`). No storage-collision was found in the current
single-impl deployment; flagged for the auditor to confirm layout compatibility if any clone is ever
re-pointed to a new impl.

### N-2 (LOW / informational) — compound "owner-lost + feed-dead" unrescuable edge

The escape hatches each cover a *single* failure, but a **compound** failure can strand **locked-in-position**
collateral:

- `emergencyWithdraw` requires the market to be **paused** (`PerpMarket.sol:663`, `if (!paused()) revert`)
  and only covers **available (unlocked)** balance (`:667`). Pausing is an owner action.
- Exiting a **locked** position needs settlement: `closePair` settles at the fresh reference price (needs a
  **live** feed), and `forceSettle` is `onlyOwner`.

So if the **owner key is lost** (market never paused → `emergencyWithdraw` can't trigger; `forceSettle`
unavailable) **and** the **reference feed is dead/stale** (so `closePair`'s `_freshReferencePrice`/`_guardPrice`
reverts), collateral **locked in an open position** has no exit. Each single failure is handled; the
intersection is not. **Residual risk: low-to-medium depending on operational posture** — mitigated in practice
by a persistent multisig owner (never "lost") and a monitored feed. Flagged explicitly for the auditor and the
go-live checklist; a fully owner-independent locked-collateral exit (e.g. permissionless force-close at the ref
price after a long grace) would close it but is **not implemented**.
