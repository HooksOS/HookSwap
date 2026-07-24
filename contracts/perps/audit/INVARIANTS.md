# HookSwapPerps — Security Invariants

> The properties the system must uphold, and which test asserts each. Every invariant is tied to a real
> forge test/invariant in `contracts/perps/test/`. This is a pre-audit statement of intent + current
> coverage — an auditor should treat each invariant as a hypothesis to attack, and note where coverage is
> partial (flagged inline).

## Current test status (verified)

`forge test` from `contracts/perps/` — **58 tests passed, 0 failed** (foundry 1.7.1, solc 0.8.28, via_ir):

| Suite | File | Kind | Count |
|---|---|---|---|
| `FundRescueTest` | `test/FundRescue.t.sol` | local | 31 |
| `PerpFuzzTest` | `test/invariant/PerpFuzz.t.sol` | local fuzz | 9 |
| `PerpMarketInvariantTest` | `test/invariant/PerpMarketInvariant.t.sol` | local invariant | 4 |
| `Round4FixesTest` | `test/Round4Fixes.t.sol` | local | 3 |
| `Round4SettlementTest` | `test/Round4Settlement.t.sol` | local | 1 |
| `GuardWiringTest` | `test/GuardWiring.t.sol` | **Sepolia fork** | 5 |
| `SecurityFixesV5Test` | `test/SecurityFixesV5.t.sol` | **Sepolia fork** | 5 |
| **Total** | | | **58** |

Local suites run with no RPC. The two fork suites need `SEPOLIA_RPC_URL` (they read the live Chainlink
ETH/USD feed `0x694AA176…` + canonical WETH `0xfFf99767…`):
`SEPOLIA_RPC_URL=<sepolia-rpc> forge test --match-contract 'GuardWiringTest|SecurityFixesV5Test' --fork-url $SEPOLIA_RPC_URL`.
Verified pass with the public endpoint `https://ethereum-sepolia-rpc.publicnode.com`.

The invariant/fuzz config is inline in `PerpMarketInvariant.t.sol` (`invariant.runs = 64`,
`invariant.depth = 48`, `fail-on-revert = false`).

---

## INV-1 — Solvency: internal liabilities ≤ real token holdings

**Statement.** For any market, the sum of every internal balance (`available + locked`, across all traders,
the FeeRouter, and the InsuranceHub sub-account) never exceeds the ERC-20 tokens the clone actually holds.
The market can never owe more than it has.

- **Asserted by:** `PerpMarketInvariant.t.sol::invariant_A_solvent` —
  `assertLe(_internalSum(marketA), col.balanceOf(marketA))` under the full fuzzed lifecycle
  (deposit/withdraw/open/close-by-trader/close-by-matcher/liquidate/funding/collect-fees).
- **Supporting:** `invariant_A_lockedLeSum` (`totalLockedMargin ≤ internalSum`);
  `PerpFuzz.t.sol::testFuzz_settlePnLZeroSum` (`endSum ≤ col.balanceOf(m)` after a close).
- **Underpinned by:** F-1 (funding always backed), F-2 (no negative-cast over-pay), winner-cap
  (§INV-4). See `FINDINGS-LOG.md` §1.

## INV-2 — Per-market isolation (clones + insurance sub-accounts)

**Statement.** Nothing done to market A can change market B — same collateral token, same trader
addresses. Each clone has its own `balances` storage; each InsuranceHub sub-account is drawable only by
its own market.

- **Asserted by:** `PerpMarketInvariant.t.sol::invariant_B_isolated` — market B (seeded once with real
  positions + loose balances between the *shared* actors, then frozen) is byte-for-byte unchanged (token
  balance + every per-account internal balance) no matter what the handler does to A.
- **Insurance isolation:** `PerpFuzz.t.sol::testFuzz_insuranceIsolation` — covering market A's loss draws
  **only** A's sub-account; B is untouched even though the hub physically holds B's tokens; A cannot draw
  more than its own balance (`InsufficientMarketInsurance`).
- **Rescue isolation:** `FundRescue.t.sol::test_ownerSweep_isolationPreserved`.

## INV-3 — Conservation ledger: every token in/out is accounted for

**Statement.** A market's token balance equals `deposits − withdrawals − collected fees`. Settlement,
liquidation and funding only move value **between** internal accounts, never in or out of the clone.

- **Asserted by:** `PerpMarketInvariant.t.sol::invariant_A_ledgerReconciles` —
  `col.balanceOf(marketA) == ghostDeposited − ghostWithdrawn − ghostFeesCollected`.

## INV-4 — Winner capped at counterparty collateral (no insurance harvest, no mint)

**Statement.** A trade winner's internal gain is bounded by the loser's collateral. Insurance is **never**
drawn by a trade winner; PnL never mints collateral; a delta-neutral self/colluding pair cannot harvest
insurance.

- **Asserted by:** `GuardWiring.t.sol::test_4_WinnerCappedNoInsuranceDraw` (Sepolia fork) — insurance
  sub-account unchanged; no wallet payout from insurance; winner credited exactly own+counterparty
  collateral (`1e15`, not `1.5e15`).
- **Fuzzed:** `PerpFuzz.t.sol::testFuzz_winnerGainBoundedByLoserCollateral`
  (`aAfter ≤ aBefore + collat`); `testFuzz_settlePnLZeroSum` (no mint: `endSum ≤ startSum`).
- **Enforced by:** self-match ban `PerpMarket.sol:708-710`; winner-cap `:952-958`. See `FINDINGS-LOG.md` §1.

## INV-5 — Funding always backed (no unbacked credit, no negative-cast drain)

**Statement.** Funding credited to insurance is capped at each side's realized output (always backed by
tokens actually withheld); zero-sum PnL inputs make the both-negative underflow impossible.

- **Asserted by:** `SecurityFixesV5.t.sol::test_F2_BothNegativePnL_FundingBacked_NoDrain` (Sepolia fork) —
  `insAfter == fundingPerSide*2` (F-1, exact backed amount) and `aAvail + bAvail + insAfter + feePerSide*2
  == dep*2` (F-2, value conserved, symmetric, no drain/mint).
- **Enforced by:** `PerpMarket.sol:933-947` (funding cap) + `:890-931` (zero-sum guard).

## INV-6 — Fee split conserves value and respects the platform floor

**Statement.** platform + creator + insurance == total collected (remainder-based, no dust loss); the
platform slice never drops below the immutable `platformFloorBps`.

- **Asserted by:** `PerpFuzz.t.sol::testFuzz_feeSplitConservation` — `platform + creator + insurance ==
  total`; `platform ≥ total * platformFloorBps / 10_000`; slices match configured bps.
- **Liability tracking:** `FundRescue.t.sol::test_feeRouter_totalClaimableTracksCollectAndClaim`
  (`totalClaimable` exact through collect + both claims).

## INV-7 — Bond / fee / insurance liabilities are bounded and non-rescuable

**Statement.** A rescue can only move **stranded surplus** (raw balance minus tracked liabilities). A live
bond, an escrowed slash, and an unclaimed fee can never be swept. Bond ETH round-trips exactly through
post → withdraw / slash / return / claim.

- **Bond escrow conservation:** `PerpFuzz.t.sol::testFuzz_bondPostAndWithdraw` (exact ETH round-trip),
  `testFuzz_bondSlashToTreasury` (slash pays treasury once, blocks later withdraw).
- **Bounded rescue:** `FundRescue.t.sol::test_rescueETH_cannotSweepLiveBond`,
  `test_rescueETH_sweepsOnlySurplusOverBond`, `test_rescueETH_cannotSweepEscrowedSlash`,
  `test_rescueToken_cannotSweepUnclaimedFee`, `test_rescueToken_sweepsOnlySurplusOverClaimable`,
  `test_ownerSweep_revertsOverdraw`.
- **Counter integrity:** `test_bondCounters_postSlashClaim`, `test_bondCounter_afterWithdraw`,
  `test_bondCounter_afterReturnBond`.
- **Slash cannot be bricked:** `test_slash_rejectingTreasuryEscrowsThenClaim` (pull-fallback escrow).

## INV-8 — Price integrity: guarded within band, LIMIT price honored

**Statement.** Every value-moving price passes the OracleGuard deviation + staleness band when a reference
feed is configured; a LIMIT order can never be filled outside its signed price.

- **Deviation/staleness:** `GuardWiring.t.sol::test_2_H1_DeviationBlocksSettle` (settle + updatePrice at
  1.6x live Chainlink revert); fuzzed `PerpFuzz.t.sol::testFuzz_oracleDeviationBand`,
  `testFuzz_oracleStaleness`, `testFuzz_guardWiredBlocksBadPrice`.
- **LIMIT price:** `GuardWiring.t.sol::test_3_H2_LimitPriceEnforced` (PerpMarket) +
  `Round4Settlement.t.sol::test_MED3_LimitPriceEnforcedInSettlement` (Settlement port).
- **Ref feed mandatory at creation:** `Round4Fixes.t.sol::test_MED1_ZeroRefFeedRejectedAtCreation`.

## INV-9 — No funds stuck without an escape (single-failure liveness)

**Statement.** No single operator failure permanently traps funds: a down matcher, a paused market with a
lost owner (for unlocked balance), a rejecting treasury, and a dead market's sub-account all have an exit.

- **Down matcher:** `Round4Fixes.t.sol::test_MED2_CloseAtRefPriceWhenStoredMarkStaleOutOfBand` (user close
  at fresh ref) + `test_MED2_ForceSettleAfterGraceOnlyWhenStale` (owner escape after grace).
- **Paused + lost owner (unlocked balance):** `PerpMarket.sol:662-674` `emergencyWithdraw` — **no dedicated
  forge test in-repo** (behavioral); flagged for the auditor to add coverage.
- **Rejecting treasury:** `FundRescue.t.sol::test_slash_rejectingTreasuryEscrowsThenClaim`.
- **Dead market sub-account:** `FundRescue.t.sol::test_ownerSweep_recoversSubAccount`.
- **⚠ Known gap (LOW/info N-2, `FINDINGS-LOG.md` §7):** the **compound** owner-lost + feed-dead case can
  strand **locked-in-position** collateral. Single failures are covered; their intersection is not.

---

## Coverage caveats an auditor should note

- **Invariant depth is modest** (`runs=64`, `depth=48`) — adequate for a smoke-level property check, not a
  deep economic search. Recommend increasing depth + adding an economic simulation of the matcher-trust
  surface (see `PRE-MAINNET-CHECKLIST.md`).
- **`emergencyWithdraw` (S-2)** and **`SettlementV2.sol`** (the undeployed Merkle-attestation mode) have **no
  dedicated tests** in this suite.
- **The two fork suites depend on live Sepolia state** (Chainlink feed freshness). A very stale feed round
  at run time could affect the deviation math; they passed against a live public RPC at authoring time.
- **`Settlement.sol`** (the deployed single-instance core, incl. the Robinhood pilot) shares the R4 fixes
  with `PerpMarket` but its coverage is thinner (`Round4Settlement.t.sol` covers MED-3 only); most fund-
  safety assertions run against the `PerpMarket` clone. The auditor should confirm the ports line-by-line.
