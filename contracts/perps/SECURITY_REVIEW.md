# HookSwapPerps Self-Service Factory — Internal Security Review

**Scope.** This is an adversarial, read-only internal review of the HookSwapPerps self-service factory contract stack under `contracts/perps/src/factory/`: `PerpMarket.sol` (clone-friendly Settlement), `PerpMarketFactory.sol`, `FeeRouter.sol`, `MarketRegistry.sol`, `OracleGuard.sol`, `ParamGuard.sol`, `BondManager.sol`, `InsuranceHub.sol`, cross-checked against the deployed wiring in `config/factory-sepolia.json` and the intended invariants in `SELF_SERVICE_SPEC.md`. Every claim below was verified by reading the actual source, not the spec or the deploy notes.

> **⛔ DISCLAIMER — INTERNAL REVIEW, NOT A PROFESSIONAL AUDIT.**
> This document is an internal engineering review conducted to surface issues before external audit. It is **NOT** a professional third-party security audit and **must not** be represented, cited, or relied upon as one. It is time-boxed, single-reviewer, static (no fuzzing, no formal verification, no economic simulation), and almost certainly incomplete. A permissionless perps factory that shares a fee stream is a very high-value target; per `SELF_SERVICE_SPEC.md §11` a **full independent audit is mandatory before mainnet**. Do not deploy to any production chain on the strength of this review alone.

---

## 1. Summary

The isolation architecture is fundamentally sound: each market is an EIP-1167 clone with **its own storage `balances` mapping**, so collateral is isolated by construction — no cross-market drain vector was found in the settlement, fee, bond, or insurance paths. Clone/initializer safety is correct (`_disableInitializers()` on the implementation, atomic `initialize` inside `createMarket`, per-clone EIP-712 domain). Factory ordering is correct: all config (`feeReceiver`, `matcher`, `feeRate`, `marketMaxLeverage`) is set **before** `transferOwnership`, so a creator can never front-run configuration, and the creator receives **no** on-chain control (matches the "creators only earn" invariant).

However, **the on-chain oracle safety layer the design sells (`OracleGuard`) is dormant** — it is deployed and validated at create-time only; its runtime deviation/staleness/liquidity breakers are never invoked by any market on the settle/price/close path. Combined with the fact that **the signed limit price is never enforced on-chain**, the system's price integrity rests entirely on the off-chain matcher and the platform owner being honest. The insurance mechanism is also effectively **disconnected** from where bad debt actually occurs. None of these are "someone steals funds from the contract today," but they materially weaken the safety story versus what the spec and deploy JSON assert, and several are on-chain gaps that should be closed or explicitly documented as off-chain-enforced before mainnet.

No **Critical** (direct, unauthorized, permissionless fund-drain / isolation break / clone re-init) issue was found.

---

## 2. Findings table (severity-sorted)

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| H-1 | High | OracleGuard runtime breaker is dormant — on-chain price is 100% matcher-trusted; stale-price counterparty extraction | `PerpMarket.sol` (whole price path); `OracleGuard.sol:161,182` never called |
| H-2 | High | Signed limit price / orderType never enforced on-chain; matcher sets arbitrary entry & exit prices | `PerpMarket.sol:576-608, 644, 971-982` |
| M-1 | Medium | Insurance is disconnected: factory never wires `insuranceFund`; InsuranceHub funds unreachable by settlement → uncovered bad debt | `PerpMarketFactory.sol:233-254`; `PerpMarket.sol:731-749, 861-871` |
| M-2 | Medium | MarketRegistry kill-switch is cosmetic on-chain — a DELISTED/PAUSED market keeps trading | `MarketRegistry.sol:86`; `PerpMarket.sol:568` |
| M-3 | Medium | Liquidation reward frequently unpayable → no incentive to liquidate underwater positions | `PerpMarket.sol:793-797` |
| M-4 | Medium | Owner can lock a creator's bond indefinitely via registry status without slashing | `BondManager.sol:156-168`; `MarketRegistry.sol:86` |
| L-1 | Low | Post-handoff owner can exceed ParamGuard bounds (fee → 100 bps, leverage → 100x) | `PerpMarket.sol:487-502` |
| L-2 | Low | Orphaned accounting: `pendingLiquidationPenalty` never routed; funding stuck when `insuranceFund==0` | `PerpMarket.sol:796, 861-871` |
| L-3 | Low | Decimals rounding: dust / >18-dec deposits credit 0 while pulling tokens | `PerpMarket.sol:253-260, 953-958` |
| L-4 | Low | `FeeRouter.collect` reverts while the market is paused (fees uncollectable) | `FeeRouter.sol:141`; `PerpMarket.sol:307` |
| I-1 | Info | First-come/bank-run withdrawal: `withdraw` gated only by raw token balance, no pro-rata on insolvency | `PerpMarket.sol:307-316` |
| I-2 | Info | Fee-on-transfer collateral edge in the 3-way split | `FeeRouter.sol:140-160` |
| I-3 | Info | Positive: clone/init/EIP-712 hardening is correct | `PerpMarket.sol:233-247` |
| I-4 | Info | `updatePrice` has no freshness/deviation gate (matcher trust) | `PerpMarket.sol:557-561` |

---

## 3. Findings in detail

### H-1 — OracleGuard runtime circuit breaker is dormant; on-chain price is entirely matcher-trusted

**Location:** `OracleGuard.sol:161` (`checkDeviation`) and `:182` (`checkLiquidity`) — verified to have **zero call sites** in `src/` outside their own definition. `PerpMarket.sol` contains **no reference to OracleGuard at all** (the clone is never wired to it). Prices used at settlement: `PerpMarket.sol:644` (`entryPrice = pair.matchPrice`), `:681` (`closePair` uses `tokenPrices[pos.token]`), `:760/773` (liquidation uses `tokenPrices`), `:557-561` (`updatePrice` sets `tokenPrices` with only a matcher check).

**Scenario.** `SELF_SERVICE_SPEC.md §6` and `config/factory-sepolia.json` present OracleGuard as the on-chain trust layer that bounds the #1 drain vector for permissionless markets ("checkDeviation() — the runtime circuit breaker the matcher/settle path calls"). In the code, that path **does not exist**: OracleGuard's deviation, staleness, and liquidity checks are only reachable as standalone external `view`s that nothing on-chain calls. The market's mark price is whatever an authorized matcher last wrote via `updatePrice`, or whatever `matchPrice`/`exitPrices` the matcher passes into `settleBatch`/`closePairsBatch`/`executeADL`. There is no on-chain staleness or deviation enforcement anywhere.

Concrete exploit that needs **no matcher collusion**: `closePair(pairId)` (`:677`) is callable by either paired trader and settles PnL at the **last matcher-written `tokenPrices[token]`** with no freshness check. A trader watches the real market price versus the stale on-chain `tokenPrices`; when the stale value favors their side, they call `closePair` and realize PnL at the stale price, extracting collateral from the specific counterparty in the pair. The create-time `validateConfig` allowlist does nothing to prevent this because it only runs once, at creation.

**Impact.** The central safety claim of the self-service design (bounded oracle blast radius) is not enforced on-chain. Price integrity depends 100% on the off-chain matcher's honesty and keeper timeliness. High, because it undermines the property the whole permissionless model advertises, and enables user-vs-user extraction via stale prices.

**Fix.** Wire OracleGuard into the clone: store the `oracleGuard` address in `PerpMarket`, and call `OracleGuard.checkDeviation(address(this), price)` in `updatePrice` and against every `matchPrice`/`exitPrice` used in `_settlePair`, `_closePair`, `liquidate`, and the batch close/ADL paths. Enforce a maximum age on `tokenPrices` before it may be used by the user-callable `closePair`. If the decision is to keep enforcement off-chain in the matcher, then **remove the on-chain "circuit breaker the settle path calls" language** from the spec and deploy JSON and document it as off-chain-only.

---

### H-2 — Signed limit price and orderType are never enforced on-chain

**Location:** `PerpMarket.sol:576-608` (`_settlePair`), `:644` (`entryPrice = pair.matchPrice`), `:971-982` (`_validateOrder`). `order.price` and `order.orderType` appear **only** inside the EIP-712 struct hash (`:910`); they are never compared against `pair.matchPrice`.

**Scenario.** A trader signs an `Order` with `orderType = LIMIT` and `price = X`. The signature authorizes that order. But `_settlePair` uses `pair.matchPrice` — supplied entirely by the matcher — as the entry price, and never checks that `matchPrice` respects the signed `price` for a LIMIT order, nor that it sits between the two counterparties' prices. The matcher can therefore fill any signed order at any price it chooses. Because entry price drives collateral lock and later PnL, a compromised or malicious matcher can open/settle pairs at prices that transfer collateral between colluding accounts, bounded only by the collateral present in that one market.

**Impact.** This is the concrete mechanism behind the "trusted matcher" assumption: on-chain, the matcher (and the owner who authorizes it) has unconstrained control over entry/exit/liquidation prices, i.e. over user collateral within a market. It is bounded to a single market by isolation, but within a market it is effectively fund-seizure power. Rated High as an on-chain gap that concentrates trust; see Trust Assumptions.

**Fix.** Enforce the signed limit price on-chain for LIMIT orders (`matchPrice` must be ≤ long's `price` and ≥ short's `price`, or the appropriate directional constraint), and gate `matchPrice` with OracleGuard (H-1). At minimum, document explicitly that signed prices are advisory and the matcher is fully trusted for execution price.

---

### M-1 — Insurance is disconnected from settlement; factory never wires `insuranceFund`

**Location:** `PerpMarketFactory.sol:233-254` (createMarket configures the clone but **never calls `setInsuranceFund`** — verified: no `insuranceFund` reference in the factory). `PerpMarket.sol:731-749` (ADL deficit branch guarded by `insuranceFund != address(0)`), `:861-871` (`transferFundingToInsurance` no-ops when `insuranceFund==0`).

**Scenario.** Two separate, unconnected "insurance" concepts exist:
1. **In-clone** `insuranceFund` (an internal `balances[insuranceFund]` sub-account) — used by `_settleProfit`'s ADL top-up and by `transferFundingToInsurance`.
2. **Shared** `InsuranceHub` sub-accounts, funded by FeeRouter's 10% insurance slice with real tokens.

Factory-created markets **never set `insuranceFund`**, so it is `address(0)` in every self-service market. Consequences:
- In `_settleProfit`, when a winner's profit exceeds the loser's collateral, the deficit branch (`:731`, `:743`) is skipped because `insuranceFund == address(0)`. The winner simply does not receive the shortfall — **silent uncovered bad debt**, and no `ADLTriggered` event is even emitted.
- The 10% insurance fee that FeeRouter pushes into `InsuranceHub.balanceOf[market][token]` is **unreachable** by the clone's settlement logic. `PerpMarket` has no reference to InsuranceHub and never calls `coverLoss`. Even a manual keeper `coverLoss(market, token, deficit, ...)` transfers real tokens out of the hub to `to`, but does **not** credit the winner's internal `balances[...].available`, so it cannot reconcile the on-chain accounting that shorted the winner.

**Impact.** The per-market insurance the design relies on to keep markets solvent does not actually backstop settlement bad debt. Winners can be under-paid with no event and no recourse. Medium (functionality broken / uncovered bad debt, not a direct theft).

**Fix.** Wire the clone to the InsuranceHub (store its address in `PerpMarket`; have `_settleProfit` pull from the hub's per-market sub-account to cover the deficit and credit the winner), or at minimum have the factory `setInsuranceFund` and fund it. Reconcile the two insurance mechanisms into one so the fee slice can actually cover bad debt.

---

### M-2 — MarketRegistry kill-switch is cosmetic on-chain

**Location:** `MarketRegistry.sol:86` (`setStatus`), read by `BondManager` only; `PerpMarket.sol:568` (`settleBatch`) has `whenNotPaused` but **does not read MarketRegistry**.

**Scenario.** The spec (`§3`, `§5`) sells `MarketRegistry` force-pause/delist as the platform kill switch. But the `PerpMarket` clone never reads its registry status. Setting a market to `PAUSED`/`DELISTED` in the registry only affects (a) the frontend/indexer and (b) `BondManager.withdrawBond`'s gate. Trading (`settleBatch`, `closePair`, `liquidate`) continues unaffected. The **real** on-chain kill switch is per-market `emergencyPause()` (owner) or de-authorizing the matcher — both distinct owner actions from `registry.setStatus`.

**Impact.** An operator who "delists" a scam/oracle-failed market in the registry believing they have stopped it has **not** stopped on-chain settlement; that depends on the off-chain matcher voluntarily ceasing. Medium on-chain gap / operational footgun.

**Fix.** Either have `PerpMarket` read the registry status (adds cross-contract coupling), or document clearly that the on-chain kill = `emergencyPause` + matcher de-auth, and that registry status is advisory. Ensure runbooks call `emergencyPause`, not just `setStatus`.

---

### M-3 — Liquidation reward is frequently unpayable

**Location:** `PerpMarket.sol:793-797`.

**Scenario.** In `liquidate`, `_settleProfit` runs first (releasing collateral and applying loss), then the penalty/reward block executes only `if (penalty > 0 && balances[liqTrader].available >= penalty)`. A position is liquidatable when equity < maintenance margin (0.5% of size, `:761`); after settlement, the liquidated trader's residual `available` is small and often **less than** `penalty` (5% of collateral). When so, the entire block is skipped: the liquidator gets **no reward** despite paying gas and closing the position, and no penalty is routed to insurance.

**Impact.** No economic incentive to liquidate the exact positions that most need liquidating (deeply underwater), so bad debt accrues until the platform matcher force-closes via `closePairsBatch`/`executeADL`. Medium (liquidation liveness / griefing of the incentive).

**Fix.** Pay the liquidator from whatever residual exists (partial reward) rather than all-or-nothing, and/or fund the reward from the insurance sub-account when the trader's balance is insufficient. At minimum, do not silently no-op.

---

### M-4 — Owner can lock a creator's bond indefinitely without slashing

**Location:** `BondManager.sol:156-168` (`withdrawBond` requires registry status ACTIVE), `MarketRegistry.sol:86` (owner-only `setStatus`).

**Scenario.** `withdrawBond` reverts `MarketNotActive` unless the market's registry status is `ACTIVE`. The platform owner controls `setStatus` unilaterally. By setting any created market to `PAUSED`/`DELISTED` and never calling `slash`, the owner can indefinitely prevent the creator from reclaiming their bond, without ever triggering the slash path/event — a de-facto seizure with no on-chain "slashed" record. Legitimately paused markets also trap the creator's bond for the duration.

**Impact.** Griefing / opaque de-facto bond seizure by a trusted-but-not-infallible owner; erodes the "reclaimable bond" promise. Medium.

**Fix.** Allow bond withdrawal after the cool-down for any market that is **not slashed**, regardless of ACTIVE/PAUSED (only `DELISTED`-for-abuse or `slashed` should block), or introduce a separate, time-bounded "frozen" state distinct from operational pause. Consider a governance timelock on `setStatus`.

---

### L-1 — Post-handoff owner can exceed ParamGuard bounds

**Location:** `PerpMarket.sol:487-490` (`setFeeRate` allows ≤ 100), `:498-502` (`setMarketMaxLeverage` allows ≤ `MAX_LEVERAGE` = 100x).

**Scenario.** ParamGuard clamps fee to `[2,15]` bps and leverage to `PLATFORM_MAX_LEVERAGE` (20x) **only at creation**. After ownership transfers to `platformAdmin`, the owner can call `setFeeRate(100)` (1% per side, ~6.7x the advertised 15 bps max) and `setMarketMaxLeverage(100 * 1e4)` (100x, 5x the platform cap), bypassing the governance bounds the spec presents as hard limits.

**Impact.** The ParamGuard bounds are not invariants; they are one-time create clamps. Owner power, but worth flagging because it contradicts the "clamped to global bounds" framing. Low.

**Fix.** Have `setFeeRate`/`setMarketMaxLeverage` re-consult ParamGuard, or timelock/renounce these post-handoff.

---

### L-2 — Orphaned accounting counters

**Location:** `PerpMarket.sol:796` (`pendingLiquidationPenalty += insurancePenalty`), `:861-871` (`transferFundingToInsurance`).

**Scenario.** `pendingLiquidationPenalty` is incremented but **no function ever routes it** anywhere. `insuranceFundFromFunding` accumulates but `transferFundingToInsurance` no-ops when `insuranceFund == address(0)` (always true for factory markets, per M-1). The underlying tokens remain in the clone as unassigned surplus (improving solvency, not stealable), but the counters are dead accounting.

**Impact.** Funds are effectively locked as un-withdrawable surplus; no direct loss to an attacker, but the funding/penalty → insurance flow is non-functional. Low.

**Fix.** Route `pendingLiquidationPenalty` and funding into the (wired, per M-1) insurance sub-account, or remove the dead counters.

---

### L-3 — Decimals rounding can credit zero while pulling tokens

**Location:** `PerpMarket.sol:253-260` (`deposit`), `:953-958` (`_toStandardDecimals`).

**Scenario.** For collateral with decimals > 18, `_toStandardDecimals` divides; a small `amount` normalizes to `standardAmount == 0`, but `safeTransferFrom` has already pulled the tokens. `deposit` does not check `standardAmount != 0`. Self-griefing dust only (user harms themselves), and round-trip precision loss for d<18 tokens.

**Impact.** Low; user-only dust loss, no cross-user exploit.

**Fix.** Revert if `standardAmount == 0`. Prefer restricting collateral to 18-decimal (or ≤18) tokens via the venue allowlist / factory checks.

---

### L-4 — `collect` reverts while a market is paused

**Location:** `FeeRouter.sol:141` calls `market.withdraw`, which is `whenNotPaused` (`PerpMarket.sol:307`).

**Scenario.** If a market is `emergencyPause`d (e.g. during an incident), accrued platform/creator/insurance fees cannot be collected until it is unpaused, because the router pulls fees via the paused `withdraw`.

**Impact.** Low; fees are not lost, just temporarily uncollectable, and pausing is an owner action.

**Fix.** Consider a fee-only withdrawal path exempt from `whenNotPaused`, or accept as intended.

---

### I-1 — First-come / bank-run withdrawal on an insolvent market

**Location:** `PerpMarket.sol:307-316`.

`withdraw` only checks `IERC20(token).balanceOf(address(this)) >= tokenAmount`. If a market accrues bad debt (e.g. via M-1 uncovered shortfalls), internal `balances` sum can exceed real tokens; withdrawals are honored first-come until the contract runs dry, with no pro-rata haircut. This is an inherent property of the internal-accounting design; flagged for awareness.

### I-2 — Fee-on-transfer collateral edge

`FeeRouter.collect` credits "what arrived" (`:143`) and computes insurance as the remainder, so platform+creator claimable stays covered for standard FoT tokens. Exotic FoT tokens that charge the sender extra on the `notifyFee` transfer could leave a tiny shortfall. The venue/collateral allowlist should exclude FoT tokens; flagged as an edge only.

### I-3 — Positive: clone / initializer / EIP-712 hardening is correct

The implementation constructor calls `_disableInitializers()` (`:234`); `initialize` is `initializer` and is invoked atomically inside `createMarket` (no front-run window); every field initializer (`feeRate=10`, `nextPairId=1`, `feeReceiver`, `lastFundingTime`) is moved into `initialize` (`:239-247`); and the non-upgradeable `EIP712("HookSwapPerps","1")` base yields a correct per-clone domain (`verifyingContract == clone`, name/version baked as bytecode immutables and read via delegatecall). No re-init or cross-market signature-replay vector was found. This is the strongest part of the stack.

### I-4 — `updatePrice` has no freshness or deviation gate

`updatePrice` (`:557`) lets any authorized matcher set any `tokenPrices[token]` with no bounds — the substrate for H-1/H-2. Listed separately to make the matcher-trust surface explicit.

---

## 4. Trust assumptions / owner powers (this IS a permissioned system)

This stack is intentionally permissioned. The following are **accepted-by-design powers**, not bugs — but they must be disclosed honestly, because "creators only earn, never control" does **not** mean "no one controls user funds."

**Per-market owner (`platformAdmin`, after `transferOwnership`) can:**
- Authorize/deauthorize any matcher (`setAuthorizedMatcher`).
- **Redirect fees** away from FeeRouter (`setFeeReceiver`) — the "non-bypassable" fee floor is non-bypassable against the *creator*, **not** against `platformAdmin`. Platform+creator collusion could route around the floor.
- Pause/unpause the market and raise fee to 100 bps / leverage to 100x post-handoff (L-1).
- **Indirectly seize user collateral**: by authorizing a controlled matcher and settling/closing/liquidating pairs at arbitrary prices (H-1/H-2), the owner+matcher can move collateral between accounts within a market. There is no direct `sweep`/`rescue`, but the matcher price path is equivalent to seizure power, bounded to one market by isolation.

**Platform owner of the shared contracts can:**
- `FeeRouter`: set factory, sinks (treasury/insuranceHub), and shares (bounded by the immutable `platformFloorBps = 4000`, which has no setter — good). Cannot drop below the floor.
- `MarketRegistry`: set any market's status (M-2, M-4).
- `BondManager`: `slash` any market's bond to treasury; set treasury/registry/delay.
- `InsuranceHub`: authorize any coverer (who can then `coverLoss` a market's sub-account to an arbitrary `to`), enable/disable per-market backstop draw, fund/withdraw the shared backstop tranche.

**Matcher (platform-run sequencer) is fully trusted** for execution price, fill integrity, mark price, funding rate, and exit/liquidation prices. On-chain constraints on the matcher are limited to nonces, `filledAmounts` (no over-fill), leverage caps, and `whenNotPaused`. Price is unconstrained (H-1/H-2).

**Net:** users of any market must trust HookSwap (owner + matcher). The system delivers **market-to-market isolation** and **creator containment**, not trustlessness against the platform.

---

## 5. Recommended before mainnet

1. **Commission a full independent professional audit** (mandatory per `SELF_SERVICE_SPEC.md §11`). This internal review does not substitute.
2. **Wire OracleGuard into the settle/price path** (H-1): enforce `checkDeviation` on every price used for open/close/liquidation and add on-chain staleness on the user-callable `closePair`, or remove the "runtime circuit breaker" claim from the spec/deploy JSON.
3. **Enforce the signed limit price on-chain** for LIMIT orders and constrain `matchPrice` (H-2), or explicitly document the matcher as fully trusted for price.
4. **Fix the insurance wiring** (M-1): reconcile the in-clone `insuranceFund` and the shared `InsuranceHub` into one path that can actually cover settlement bad debt and credit the winner; have the factory set it. Remove or route the orphaned counters (L-2).
5. **Make the kill switch real** (M-2): couple `PerpMarket` to registry status, or document `emergencyPause` + matcher-deauth as the true kill and bake it into runbooks.
6. **Fix liquidation reward payability** (M-3) so underwater positions remain economically liquidatable.
7. **Rework bond withdrawal gating** (M-4): don't let a non-slashing pause trap bonds forever; add a governance timelock on `setStatus`/`slash`.
8. **Re-consult ParamGuard on later param changes** or timelock the per-market owner setters (L-1); reject zero-normalized deposits and restrict collateral to ≤18-decimal, non-FoT tokens (L-3, I-2).
9. **Add a Pausable-exempt fee collection path** or accept L-4.
10. **Fuzz + invariant test** collateral conservation per market, fee-split conservation, funding/liquidation math, and cross-market isolation; run economic simulation of the matcher-trust surface. Consider a timelock/multisig for all owner powers enumerated in §4 and publish the trust model to users.
11. Confirm the throwaway Sepolia wiring (`platformAdmin`/`matcher`/`treasury` = deployer, per `config/factory-sepolia.json`) is replaced with a multisig/timelock before any production deploy.
