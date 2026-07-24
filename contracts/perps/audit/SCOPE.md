# HookSwapPerps — External Audit Scope

> **Status: PRE-AUDIT.** This package is prepared to engage a third-party auditor. Nothing in
> `contracts/perps/` has been through an external professional audit. Every claim below is sourced
> from the actual Solidity, tests, and deploy config in this repo (cited `file:line`). This document
> defines what an auditor is being asked to review, the trust model, dependencies, the threat model,
> and what is explicitly out of scope.

---

## 0. TL;DR for the auditor

HookSwapPerps is an **operator-run P2P perpetuals** system: traders sign EIP-712 orders off-chain, a
**trusted matcher** pairs a long and a short and calls `settleBatch` on-chain; the contract custodies
collateral, charges a fee, and settles PnL / funding / liquidation against a **matcher-supplied scalar
mark price**. There are two on-chain shapes of the same core:

1. **P2P core** — a single-instance `Settlement.sol` (deployed on Sepolia + a Robinhood mainnet pilot).
2. **Self-service factory** — `PerpMarketFactory` mints EIP-1167 **clones** of `PerpMarket.sol` (a
   clone-safe refactor of `Settlement`), so any project can launch an **isolated** market in one tx;
   a shared `FeeRouter` / `MarketRegistry` / `OracleGuard` / `ParamGuard` / `BondManager` / `InsuranceHub`
   form the platform core. Deployed on Sepolia (throwaway keys).

**This is a permissioned system by design** — users must trust HookSwap (the owner + the matcher) for
execution price and fill integrity. It delivers **market-to-market isolation** and **creator
containment**, *not* trustlessness against the platform. See §3.

---

## 1. Contract inventory (audit targets)

LOC = `wc -l` of the source file. "Deployed?" reflects `config/sepolia.json`, `config/robinhood.json`,
`config/factory-sepolia.json`.

### 1a. Self-service factory stack — `src/factory/` (PRIMARY audit target)

| File | Purpose | LOC | Deployed? |
|---|---|---|---|
| `PerpMarket.sol` | The market implementation. Clone-safe (initializable, `_disableInitializers`) refactor of `Settlement`: isolated per-clone `balances`, EIP-712 order settlement, funding, liquidation, per-market leverage, wired OracleGuard/InsuranceHub, owner escape hatches. | 1267 | Sepolia (impl behind factory) |
| `PerpMarketFactory.sol` | Permissionless `createMarket` — EIP-1167 minimal-proxy clone + atomic `initialize` + config (feeReceiver/matcher/leverage) set **before** `transferOwnership`; payable-for-bond. | 278 | Sepolia `0xa1A8C5A2…` |
| `OracleGuard.sol` | On-chain price safety: venue allowlist, Chainlink reference-feed deviation + staleness circuit breaker (`checkDeviation`), create-time `validateConfig` (ref feed mandatory — MED-1). | 218 | Sepolia `0x3D2ee857…` |
| `ParamGuard.sol` | Create-time hard bounds: max leverage ceiling, min maintenance margin, `[MIN_FEE,MAX_FEE]` bps. | 93 | Sepolia `0xA9bA3301…` |
| `BondManager.sol` | Per-market native-ETH creation bonds: `postBond` (factory-only), `slash`→treasury (pull-fallback if treasury rejects ETH), delayed `withdrawBond`, bounded `rescueETH`/`returnBond`, liability counters. | 278 | Sepolia `0xB3076bd4…` (v2) |
| `InsuranceHub.sol` | Per-market insurance sub-accounts (`balanceOf[market][token]`), `notifyFee` (approve+pull), `coverLoss` (own sub-account only), `ownerSweep`, optional backstop. | 197 | Sepolia `0xEAA01a0b…` |
| `FeeRouter.sol` | 3-way fee split (platform / creator / insurance) with an immutable platform floor; `collect`/`claim`; bounded `rescueToken`; `totalClaimable` liability counter. | 217 | Sepolia `0xfA91D73B…` (v2) |
| `MarketRegistry.sol` | Enumerable market directory + per-market `Status` (ACTIVE/PAUSED/DELISTED); read by frontend/indexer + BondManager. | 108 | Sepolia `0xEDE27846…` |

### 1b. P2P core — `src/perpetual/` + `src/common/` (deployed, in scope)

| File | Purpose | LOC | Deployed? |
|---|---|---|---|
| `perpetual/Settlement.sol` | Standalone single-instance P2P settlement (the non-clone original of `PerpMarket`); EIP-712 domain `("HookSwapPerps","1")`; same round-4 fixes (F-1/F-2/winner-cap/self-match/MED-1/2/3) ported. | 1145 | **Sepolia + Robinhood mainnet pilot** |
| `common/ContractRegistry.sol` | Per-market contract specs (min/max order size, active flag) consumed by `Settlement`. | 195 | Sepolia + Robinhood |
| `perpetual/InsuranceFund.sol` | Shortfall backstop for `Settlement` (distinct from the factory `InsuranceHub`). | 430 | Sepolia + Robinhood |
| `common/SessionKeyManager.sol` | Delegated session-key signing (split out of Settlement for bytecode size); EIP-712 `("HookSwapPerps","1")`. | 242 | Sepolia + Robinhood |
| `perpetual/SettlementV2.sol` | Alternate "Mode 2": off-chain execution + Merkle-root attestation + proof-gated withdrawals; EIP-712 `("HookSwapPerpsV2","1")`; USDT-denominated (1e6). | 344 | **Not deployed** |
| `common/PriceFeed.sol`, `common/Vault.sol` | Support types for the fuller engine. | 254 / 523 | Not deployed |

### 1c. Explicitly OUT of scope (see §5)

| File | LOC | Why out of scope |
|---|---|---|
| `perpetual/PerpVault.sol` | 778 | GLP/house-vault model, **undeployed**, carries 3 open criticals (upstream `PERPVAULT_AUDIT_REPORT.md`). Not part of any deploy. |
| `perpetual/PositionManager.sol` | 1344 | On-chain-position engine variant, superseded by the P2P `Settlement` path; not deployed. |
| `perpetual/Liquidation.sol` | 808 | Same on-chain-position variant. Not deployed. |
| `perpetual/RiskManager.sol` | 462 | Same. Not deployed. |
| `perpetual/FundingRate.sol` | 351 | Same. Not deployed. |
| `perpetual/ContractSpec.sol` | 622 | Same. Not deployed. |
| `src/interfaces/*`, `src/libraries/ConstantProductAMMMath.sol` | small | Interfaces + a helper; review only as they are reached from in-scope code. |

---

## 2. Chain deployments (from config JSONs)

### Sepolia (11155111) — canonical validation chain, throwaway keys

- **P2P core** (`config/sepolia.json` → `deployed`, from throwaway deployer `0x46B7fC49…`):
  Settlement `0xc07acb918a8f862382bcaac452a12bac34610696`, SessionKeyManager `0xa66f4b4e…`,
  ContractRegistry `0x093f085a…`, InsuranceFund `0x88415a9e…`. owner+matcher+feeReceiver all
  defaulted to the deployer.
- **Self-service factory** (`config/factory-sepolia.json`, deployer `0x46B7fC49…`):
  canonical `PerpMarketFactory` `0xa1A8C5A2D5527abfD2E46F4FaCebC6BC00C1a79a`
  (impl v5 `0x190694b5…`, BondManager v2 `0xB3076bd4…`), FeeRouter v2 `0xfA91D73B…`,
  InsuranceHub `0xEAA01a0b…`, MarketRegistry `0xEDE27846…`, OracleGuard `0x3D2ee857…`,
  ParamGuard `0xA9bA3301…`, treasury/slash-sink `0x70ccf8FB…`.
  `platformAdmin` / `matcher` / `treasury` = the throwaway deployer.
  Sepolia Chainlink ETH/USD ref feed used in tests: `0x694AA1769357215DE4FAC081bf1f309aDC325306`.

### Robinhood (4663) — LIVE MAINNET PILOT, P2P core only (`config/robinhood.json`)

- Settlement `0x7A1f95c9702F78751F305426DeA9F328ed0128FA`, ContractRegistry `0xd032e4d0…`,
  InsuranceFund `0xf486e625…`, SessionKeyManager `0xa1aa9d69…`. Collateral WETH
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (18 dec). matcher `0x46B7fC49…`, feeReceiver =
  HookSwap treasury `0x011d438E3eb3fce848950859591ec037C6529E13`, deployer/owner `0xc14C897c…`
  (1-of-1 EOA). The JSON itself flags: **"no external audit yet, owner=deployer 1-of-1."**
  This pilot is the strongest reason to treat "not mainnet-ready" as a *live* statement, not a
  future one (see `PRE-MAINNET-CHECKLIST.md`).

**Note:** the factory stack is **not** on Robinhood — only the single-instance P2P core is.

---

## 3. Trust model

HookSwapPerps is intentionally **operator-run**, not trustless. The properties it *does* provide are
isolation and creator containment; the properties it does *not* provide are trustlessness against the
platform owner or the matcher.

- **EIP-712 off-chain matching, on-chain settlement.** A trader signs an `Order`
  (`PerpMarket.sol` struct hash `getOrderHash`); a single **authorized matcher** pairs a long+short and
  calls `settleBatch(MatchedPair[])`. Settlement is gated by `authorizedMatchers[msg.sender]`
  (`PerpMarket.sol:694`). The domain name `"HookSwapPerps"` version `"1"` must match byte-for-byte
  across contract, backend, and frontend or **every signature fails** (README §"Rebrand").
- **Matcher is fully trusted for price and fill.** The mark price is a **scalar the matcher supplies**
  (`updatePrice` / `matchPrice` / exit prices), produced off-chain by the perps-engine oracle adapter.
  On-chain, the matcher is constrained only by: nonces + `filledAmounts` (no over-fill), the per-market
  leverage cap, `whenNotPaused`, the signed **LIMIT** price bound (H-2 / MED-3), and the **OracleGuard
  deviation/staleness band** when a reference feed is configured (H-1 / MED-3). Within that band the
  matcher chooses the execution price.
- **Isolated margin, per market.** Each factory market is an EIP-1167 clone with **its own storage
  `balances` mapping**, so collateral is isolated *by construction* — a blow-up in one market cannot
  reach another's funds. The winner of any pair is **capped at the counterparty's collateral**
  (`PerpMarket.sol:952-958`) — no trade winner is ever topped up from insurance or socialized across
  positions/markets.
- **Clone factory.** One audited implementation; clones set config **before** `transferOwnership` to
  `platformAdmin`, so a creator gets **no** on-chain control ("creators only earn, never control").
  `_disableInitializers()` on the implementation + `initializer`-guarded `initialize` prevent re-init;
  the non-upgradeable `EIP712("HookSwapPerps","1")` base yields a correct per-clone domain
  (`verifyingContract == clone`).

**Roles the auditor should model as trusted-but-not-infallible:**

| Role | On-chain identity | Powers (accepted by design) |
|---|---|---|
| **Platform owner** (`platformAdmin`) | per-market clone owner after handoff | authorize/deauthorize matcher; redirect `feeReceiver`; pause/unpause; `setFeeRate` (≤100 bps) / `setMarketMaxLeverage` (≤100x) post-handoff; `forceSettle`; `rescueForeignToken`. |
| **Shared-core owner** | owner of FeeRouter/Registry/Bond/Hub/Guards | set factory pointers, fee shares (≥ immutable floor), registry status, `slash` bonds, authorize coverers, `ownerSweep`/`rescueToken`/`rescueETH` (bounded to stranded surplus). |
| **Matcher** | `authorizedMatchers` | `settleBatch`, `updatePrice`, `closePairsBatch`, `executeADL`, funding. Price unconstrained beyond the OracleGuard band + LIMIT bound. |
| **Creator** | market creator | **earns** the creator fee slice; can reclaim the bond after cool-down. **No** settlement/price/pause control. |

---

## 4. External dependencies

- **OpenZeppelin Contracts v5.0.2** (`README.md`, `config/factory-sepolia.json._note`) — `Ownable`,
  `ReentrancyGuard` (`utils/`), `Pausable` (`utils/`), `SafeERC20`, `ECDSA`, `EIP712`, `Clones`
  (EIP-1167), `Initializable`. `foundry.toml` remaps `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`.
  `openzeppelin-contracts-upgradeable@v5.0.2` for the initializable clone (`Initializable`, `OwnableUpgradeable`, etc.).
- **Chainlink `AggregatorV3Interface`** — the OracleGuard deviation/staleness reference feed
  (`OracleGuard.sol`). Sepolia ETH/USD `0x694AA176…` is the live feed exercised in the fork tests.
- **Permit2 is NOT a dependency of this stack** (the perps deposit path uses direct ERC-20
  `safeTransferFrom` + an ERC-2612 `depositWithPermit`; Permit2 belongs to the DEX interface, not perps).
- **Canonical WETH9** per chain (Sepolia `0xfFf99767…`, Robinhood `0x0Bd7D308…`) as the ETH-denominated
  collateral + `depositETH()` auto-wrap target.
- **Solidity 0.8.28**, `via_ir = true`, `optimizer_runs = 200`, `evm_version = "cancun"` (`foundry.toml`).

---

## 5. Threat model — what the auditor should try to break

The isolation architecture was designed against these; each is a hypothesis to attack, not a claim of safety.

**A hostile trader (permissionless, no special role) may attempt to:**
- Extract a counterparty's collateral by closing (`closePair`) at a **stale on-chain mark** when the
  matcher stops refreshing — mitigated by settling the user close at the **fresh reference price**
  (MED-2, `PerpMarket.sol:822`) and the deviation guard (`_guardPrice`).
- **Self-match** (one wallet on both sides) to harvest insurance via a bogus winner deficit — blocked
  by the self-match guard (HIGH-1, `PerpMarket.sol:708-710`) and the winner-cap (no insurance draw by
  a trade winner at all, `PerpMarket.sol:952-958`).
- Deposit dust that normalizes to a 0 credit while pulling tokens (L-3), or over-withdraw an insolvent
  market first-come (I-1, accepted design note).
- Grief liquidations so deeply-underwater positions are never closed (M-3).

**A hostile / compromised matcher may attempt to:**
- Fill a signed **LIMIT** order outside its signed price — blocked on-chain (H-2/MED-3,
  `PerpMarket.sol:719-724`; `Settlement.sol` port covered by `Round4Settlement.t.sol`).
- Settle at an off-market price — bounded by the OracleGuard **deviation + staleness** band when a ref
  feed is set (H-1/MED-3). **Within** the band, and for markets with no ref feed, the matcher's price
  is trusted. This is the central residual-trust surface — the auditor should quantify it.
- Move collateral between colluding accounts via chosen entry/exit prices — bounded to **one market**
  by isolation; the auditor should confirm the isolation boundary holds under every settle/close/
  liquidate/ADL path.
- Stop refreshing the mark to trap funds — mitigated by the owner `forceSettle` escape hatch after
  `PRICE_STALE_GRACE` (MED-2) and the owner-independent `emergencyWithdraw` after
  `EMERGENCY_WITHDRAW_DELAY` (S-2, `PerpMarket.sol:662`).

**A hostile / careless platform owner may attempt to (accepted powers — the auditor should confirm the *bounds*):**
- Redirect fees (`setFeeReceiver`), raise fee to 100 bps / leverage to 100x post-handoff (L-1),
  authorize a controlled matcher and move collateral **within a single market** (bounded by isolation).
- Lock a creator's bond — bounded: only `slashed` OR `DELISTED` blocks reclaim; ordinary `PAUSED` does
  not (M-4, BondManager v2).
- The auditor should verify there is **no** direct `sweep`/`rescue` that can move *user trading
  collateral* out of a market (`rescueForeignToken` reverts on any supported collateral,
  `PerpMarket.sol:648-649`; bond/fee/hub rescues are bounded to *stranded surplus* above tracked
  liabilities — `FundRescue.t.sol`).

**Colluding traders + matcher may attempt to:**
- Harvest the shared/per-market insurance via a delta-neutral pair — blocked by the winner-cap
  (insurance is never drawn by a trade winner; `GuardWiring.t.sol::test_4`) and self-match ban.

**Cross-market / clone attacks the auditor should try:**
- Re-initialize a clone; replay a signature from market A into market B (per-clone domain); leak
  market A collateral into market B (shared actor addresses) — the invariant suite
  (`PerpMarketInvariant.t.sol`) targets exactly this.

---

## 6. Out of scope (explicit)

- **The off-chain `perps-engine`** (TypeScript matching engine + multi-DEX oracle adapter). It is where
  the mark price is produced and where the matcher key lives. The contracts trust it; auditing it is a
  separate engagement. The upstream repo shipped a **committed plaintext relayer key + a
  `SKIP_SIGNATURE_VERIFY` bypass** — those live in `backend/` (NOT copied here) and must be
  rotated/disabled before any live matcher run (README §"Security purge").
- **`PerpVault.sol`** (GLP/house model) — undeployed, 3 open criticals, not to be deployed until
  separately hardened + audited.
- **The on-chain-position engine variant** (`PositionManager`/`Liquidation`/`RiskManager`/`FundingRate`/
  `ContractSpec`) — retained as source, superseded by the P2P path, not deployed.
- **Economic / game-theoretic simulation** of the matcher-trust surface and funding design — recommended
  (see checklist) but beyond a code audit; flagged so it is not assumed covered.
- **Front-end (Terminal perps UI)** and **the DEX interface monorepo** — separate codebases.
