# HookSwapPerps — Extensibility Guarantee

> **LOCKED requirement (Reggie, 2026-07-19):** add new perp markets — including
> **RWA + tokenized stocks** — and new price venues (Uniswap, 0x/OKX, …) purely
> by **config + admin calls**, with **NO `Settlement`/contract redeploy or
> upgrade.**

This document proves the guarantee concretely and cites the exact on-chain
functions that make it hold. Everything below is verified against
`contracts/perps/src/perpetual/Settlement.sol`, `.../ContractSpec.sol`, and
`contracts/perps/src/common/{IContractRegistry,ContractRegistry,PriceFeed}.sol`.

---

## Why the contract never needs a redeploy: `Settlement` is market-agnostic

A perp "market" on-chain is **just an address label** carried in the order and
the matched pair — there is no per-market code path, per-market storage, or
per-market deploy.

| What | Where | Why it's market-agnostic |
|---|---|---|
| Market identity | `Settlement.Order.token` (struct, `Settlement.sol:70`) | Any `address`. Two orders match iff `longOrder.token == shortOrder.token` (`_settlePair`, `Settlement.sol:543`). Nothing enumerates or hardcodes the set of markets. |
| Price is off-chain | `MatchedPair.matchPrice` (`Settlement.sol:87`) → `PairedPosition.entryPrice = pair.matchPrice` (`_createPairedPosition`, `Settlement.sol:605`) | The scalar mark price is **supplied by the off-chain matcher**, computed by this oracle. The contract stores it; it never derives or validates a market-specific price on-chain. |
| Settlement math is generic | `_calculatePnL(pos, currentPrice)` (`Settlement.sol:950`) | Pure ratio math on `entryPrice`/`currentPrice`/`size`. Identical for ETH, AAPL, gold — no per-asset branch. |
| Exit / liquidation price | `closePairsBatch(pairIds, exitPrices)` (`Settlement.sol:645`), `executeADL(…)` (`653`), `updatePrice(token, price)` (`518`) | All take an **off-chain price** from an `authorizedMatcher`. Any market, any asset class. |

**Consequence:** to add a market you feed the matcher a new `Order.token` +
an off-chain `matchPrice` from this oracle. `settleBatch` (`Settlement.sol:529`)
settles it with zero contract changes.

### The market underlying does NOT need an on-chain token
`_settlePair` never requires `Order.token` to be in `supportedTokens` — the
`supportedTokens` gate applies **only to collateral** (`deposit`/`withdraw`,
`Settlement.sol:224,241,268,278`). So a **stock/RWA market** (`AAPL-PERP`,
`XAU-PERP`) can use any stable, non-transferable, or purely-synthetic address as
its `Order.token` market id; PnL settles in the trader's deposited **collateral**
(ETH-denominated accounting, `STANDARD_DECIMALS = 18`). The AAPL price comes from
the Chainlink adapter, not from any on-chain AAPL token.

---

## (a) Add a MARKET — config route + (maybe) one admin call

1. **Add one entry** to `perps-engine/config/markets.json`
   (`{ market, assetClass, oracle:{sourceType,…}, collateralToken?, maxLeverage? }`).
2. **If — and only if — the market introduces a NEW collateral token**, make one
   admin call: `Settlement.addSupportedToken(token, decimals)`
   (`Settlement.sol:469`, `onlyOwner`; auto-detects decimals). Markets that reuse
   an existing collateral (WETH/USDC/USDG) need **no** on-chain call at all.
3. **If a `ContractRegistry` is wired** (optional — see caveat below), register
   the market spec: `ContractRegistry.setContractSpec(token, spec)`
   (`ContractRegistry.sol:84`, `onlyOwner`) with `isActive = true`.

**No redeploy. No upgrade.** `settleBatch` already settles the new pair.

## (b) Add a VENUE — a new off-chain adapter module

A venue/feed is a **`sourceType`** in the pluggable registry
(`perps-engine/oracle/registry.ts`). Adding one is purely off-chain:

1. Write a module implementing `ISourceAdapter`
   (`{ readonly sourceType; getMarkPrice(source) }`, `oracle/types.ts`).
2. `registry.register(new MyAdapter())` (or add it to `defaultRegistry()`).
3. Reference it from a market's `oracle.sourceType`.

The core resolver (`SpotOracleAdapter.getMarkPrice`, `oracle/index.ts`) does a
single `registry.get(sourceType)` lookup and **never changes**. No contract is
involved in a venue addition at all.

Shipped `sourceType`s today: `hookswap-v2/v3`, `uniswap-v2/v3`, `pancake-v2/v3`,
`uniswap-v4`/`pancake-v4`/`hook-v4` (singleton, StateView.getSlot0 — live),
`chainlink`, `pyth`, `api`, `zerox-rfq` (0x Swap-API spot-reference — live).

## (c) Add an RWA / STOCK — external-feed adapter + market config

Stocks/RWA are **not AMM-priced**, so they resolve through an **external price
feed** adapter, same `ISpotOracleAdapter.getMarkPrice()` contract:

- **Chainlink** (`oracle/chainlinkAdapter.ts`) — reads `AggregatorV3Interface
  .latestRoundData()`, normalizes `answer` (8-decimals on Robinhood per-stock
  proxies) to 1e18, enforces `updatedAt` staleness. Stale/failed → `{ok:false}`.
- **Pyth** (`oracle/pythAdapter.ts`) — `IPyth.getPriceNoOlderThan(id, age)`; a
  stale/unposted price reverts → `{ok:false}`.
- **API** (`oracle/apiAdapter.ts`) — allowlisted, optionally signed HTTP source.

### Robinhood Chain tokenized stocks (worked example)
Adding e.g. `NVDA-PERP` on Robinhood Chain (4663):

1. Add a `markets.json` entry with
   `oracle: { sourceType: "chainlink", chainId: 4663, feed: "<RH NVDA/USD proxy>",
   decimals: 8 }`. Get the **real proxy address** from
   <https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood>
   (leave it as config — do not hardcode in code).
2. `Settlement.addSupportedToken(USDG, 18)` once, so USDG is a valid collateral
   (skip if USDG is already supported). **This is the only on-chain step, and
   it is an admin call, not a redeploy.**

Robinhood stock tokens are ERC-20 (18 dec) + ERC-8056 "Scaled UI Amount"
(`uiMultiplier()` for splits/dividends); for **pricing** we do **not** apply
`uiMultiplier` — the Chainlink `answer` already reflects the corporate-action
multiplier. Spot venue is **0x RFQ** (NVDA↔USDG) → the optional `zerox-rfq`
source is a cross-check only; the **authoritative mark is the Chainlink feed.**

---

## Exactly what WOULD vs would NOT require a contract change

**Would NOT (config + admin only):**
- New market (crypto/stock/RWA/fx) reusing an existing collateral → `markets.json` entry only.
- New market needing a new collateral → `markets.json` + `addSupportedToken` (admin).
- New venue / price-feed type → off-chain adapter module + `register()`. No contract touched.
- New chain for an existing venue → `markets.json` `chainId` + an RPC in `oracle/rpc.ts`.
- Per-market risk params (min/max size, IM/MM, per-market max leverage) when a
  `ContractRegistry` is used → `setContractSpec` (admin, `ContractRegistry.sol:84`).

**WOULD require a contract change (flagged honestly):**
- **Leverage above the global cap.** `Settlement.MAX_LEVERAGE = 100 * LEVERAGE_PRECISION`
  is a `constant` (`Settlement.sol:44`) enforced in `_validateOrder`
  (`Settlement.sol:938`). A market wanting **>100×** needs a redeploy. `ContractSpec`
  has a per-market `maxLeverage`, but the current `_validateContractSpec`
  (`Settlement.sol:941–948`) does **not** enforce it on-chain (comment line 947:
  "leverage and position limit checks moved to backend") — so per-market leverage
  is an **engine-side** cap under the 100× ceiling. `MarketConfig.maxLeverage`
  encodes it; keep it ≤ 100.
- **A new collateral ACCOUNTING model.** Balances are single-unit, 18-dec,
  ETH-denominated (`UserBalance`, `Settlement.sol:109`; `STANDARD_DECIMALS`,
  `:47`). Multiple ERC-20 collaterals with distinct decimals work today
  (`tokenDecimals` normalization), but a fundamentally different collateral model
  (e.g. cross-margin in a foreign numeraire) would need contract work. Not needed
  for markets/venues/RWA/stocks.

### Caveat on the optional `ContractRegistry`
`_validateContractSpec` early-returns if no registry is set
(`Settlement.sol:942`). If a registry **is** set, a market with **no** spec has a
zero/`isActive:false` struct → `settleBatch` reverts `ContractNotActive`
(`Settlement.sol:944`). This is **not** a redeploy blocker — it just means "add a
market" then includes the `setContractSpec` admin call in step (a).3. There is a
`getDefaultContractSpec()` fallback available if you prefer a shared default
(`ContractRegistry.sol:150`).

**Hardcoding audit result:** the only on-chain value that forces a redeploy to
change is the global `MAX_LEVERAGE` constant. Nothing else enumerates, whitelists,
or special-cases individual markets, venues, or asset classes. `PriceFeed.sol`
exists in the tree but `Settlement` does **not** consume it for mark price
(mark price is the off-chain `matchPrice`/`updatePrice`), so it imposes no
per-market on-chain dependency.

---

## Registry ⇄ config quick reference

```
markets.json entry ──oracle.sourceType──▶ AdapterRegistry ──▶ ISourceAdapter.getMarkPrice(source)
                                             │
   hookswap/uniswap/pancake v2  ─────────────┤ V2Adapter    (getReserves)
   hookswap/uniswap/pancake v3  ─────────────┤ V3Adapter    (observe TWAP / slot0)
   uniswap/pancake/hook v4      ─────────────┤ V4Adapter    (StateView.getSlot0(poolId))
   chainlink                    ─────────────┤ ChainlinkAdapter (latestRoundData)
   pyth                         ─────────────┤ PythAdapter  (getPriceNoOlderThan)
   api                          ─────────────┤ ApiAdapter   (allowlisted HTTP)
   zerox-rfq                    ─────────────┘ ZeroxRfqAdapter (0x Swap-API price)
```

Every adapter returns `{ price1e18, ok }` — on any failure `{ ok:false, reason }`,
**never a fabricated price.** The matching engine holds/falls back on `ok:false`.

---

## Multi-chain: match + settle across chains — add a chain by CONFIG, no code change

The engine matches AND settles perp markets on **several chains at once** (Robinhood
4663 mainnet pilot + Sepolia 11155111 canonical, extensible to the other HookSwap
chains). The oracle/mark layer was already per-market + multi-chain (`oracle.chainId`
+ `oracle/rpc.ts clientFor(chainId)`); the matching/settlement side is now per-chain too.

### Per-chain registry (`src/chain.ts`)
Instead of module-level singletons bound to one RPC, every chain in the config gets a
`ChainCtx { chainId, publicClient, walletClient, matcherAccount, marketRegistry,
oracleGuard, gasMode }`. `getChainCtx(chainId)` resolves it. **A market's chainId comes
from which registry it lives in** — `fetchAllMarkets()` enumerates *every* configured
chain's `MarketRegistry` and tags each `MarketMeta` with its `chainId`. Every read/settle
helper (`onchainNonce`, `userBalance`, `isAuthorizedMatcher`, `fetchPositions`,
`fetchMarketRefFeed`, `fetchOpenInterest`, `orderHashOnchain`, `settlePair`) takes a
`chainId`/`ChainCtx` and uses THAT chain's client.

### `config/chains.json` schema
```jsonc
{ "chains": [ {
  "chainId": 4663,                 // required
  "network": "robinhood",          // optional label (logs)
  "rpcUrl": "https://…",           // literal default
  "rpcUrlEnv": "RH_RPC_URL",       // optional env override (wins over rpcUrl)
  "rpcFallback": "https://…",      // optional (keeper read fallback)
  "marketRegistry": "0x…",         // required — the chain's MarketRegistry
  "oracleGuard": "0x…",            // required — the chain's OracleGuard
  "matcherKeyEnv": "RH_MATCHER_PRIVATE_KEY", // ENV VAR NAME holding the matcher key
  "keeperKeyEnv":  "RH_KEEPER_PRIVATE_KEY",  // ENV VAR NAME holding the keeper key
  "gasMode": "eip1559"             // 'eip1559' (RH + default) | 'legacy'
} ] }
```
Loaded from `PERPS_CHAINS_CONFIG=<path>` or `config/chains.json`. `config/markets.json`
(mark sources, keyed by on-chain market **address** with `oracle.chainId`) is optional —
each market's mark also auto-resolves from its on-chain `OracleGuard.refFeed`.

### Secret handling (unchanged pattern)
Keys are **never** in `chains.json` — only the env-var NAME (`matcherKeyEnv`/`keeperKeyEnv`).
The engine/keeper read the key **once** from that env var, normalize it, and never log it
(`/health` and boot logs print only the public matcher address). On Robinhood the pilot
matcher is the deployer `0xc14C`, whose key lives in `contracts/.env DEPLOYER_PRIVATE_KEY`
— set `RH_MATCHER_PRIVATE_KEY` to that value in the engine env; do **not** hardcode it.

### Per-chain gas (the RH bug fix)
`settlePair` (and the keeper's `send`) pick fee fields from `gasMode`:
- **eip1559** (RH + default) → `maxFeePerGas`/`maxPriorityFeePerGas` from
  `estimateFeesPerGas()`. Robinhood is EIP-1559 (~0.12 gwei); a legacy `gasPrice` below
  block base fee reverts *"max fee per gas less than block base fee"* — so RH MUST be eip1559.
- **legacy** → `gasPrice` (only for chains that require it).

Nonces: live settle broadcasts are serialized **per chain** (independent chains send in
parallel; a chain's own nonces never collide).

### EIP-712 per chain
`domainFor(market, chainId)` sets `verifyingContract = market` **and** `chainId = the
market's own chain`, so an order signed for a market on chain A can never be replayed
against chain B (the domain differs). `/orders`, `/positions`, cancel-auth, and the ticker
all thread the market's `chainId`; `/markets` and `/health` aggregate across all chains.

### Backward compatibility
If **no** chains config is present, the engine synthesizes ONE chain from the legacy
single-chain env vars (`PERPS_CHAIN_ID` / `SEPOLIA_RPC_URL` / `MARKET_REGISTRY` /
`ORACLE_GUARD` / `MATCHER_PRIVATE_KEY`, `gasMode` from `PERPS_GAS_MODE` default `eip1559`).
Existing single-chain deploys keep working unchanged. The keeper mirrors this (legacy
fallback defaults `gasMode` to `legacy`, preserving its historical Sepolia behavior).

### Add a chain
1. Add a `config/chains.json` entry (registry, oracleGuard, RPC, gasMode).
2. Set the two key env vars it names (`matcherKeyEnv`, `keeperKeyEnv`).
That's it — **no code change.** (A market on the new chain is then just a
`markets.json` entry / auto-resolves via its `OracleGuard.refFeed`.)

Validate locally with `bun scripts/dryRunMultichain.ts` (LIVE_SETTLE forced false):
it loads every registry, enumerates markets per chain, and simulates a `settleBatch`
on one market per chain (no broadcast).
