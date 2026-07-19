# perps-engine — HookSwapPerps off-chain support

Off-chain support for the HookSwapPerps P2P model. Currently ships the
**multi-DEX oracle adapter** (`oracle/`); the matching engine itself is rebranded
separately from upstream `backend/` (see the domain sync points in
`contracts/perps/README.md`).

## Oracle adapter (`oracle/`)

Turns any supported **price source** — AMM spot venue OR external price feed —
into a single decimal-normalized **scalar mark price** (`price1e18`,
quote-per-base) that the P2P matching engine consumes. The engine uses it as the
exit / liquidation / funding / matchPrice reference — **no `Settlement.sol`
change**, so pricing is chain-, DEX-, and asset-class-agnostic.

```ts
import { SpotOracleAdapter, loadMarkets } from "./oracle";

const oracle = new SpotOracleAdapter(loadMarkets());       // reads config/markets.json
const { price1e18, ok, reason } = await oracle.getMarkPrice("AAPL-PERP");
if (!ok) hold(reason);                                     // never settle on a fabricated price
```

### Interface
```ts
interface ISpotOracleAdapter { getMarkPrice(market): Promise<{ price1e18: bigint; ok: boolean }> }
```
On any recoverable failure it returns `{ ok:false, reason }` (e.g. `NO_LIQUIDITY`,
`STALE`, `NO_MARKET`, `RPC_ERROR`) instead of throwing — honest, no mock prices.

### Pluggable adapter registry (`oracle/registry.ts`)
Adapters are keyed by **`sourceType`**. The resolver
(`SpotOracleAdapter.getMarkPrice`) is a single `registry.get(sourceType)` lookup
and **never changes** when a venue/feed is added — adding a source is a new
`ISourceAdapter` module + `register()`. `defaultRegistry()` ships:

| `sourceType` | adapter | how it prices | asset classes |
|---|---|---|---|
| `hookswap/uniswap/pancake-v2` | `V2Adapter` | `getReserves()` → quote/base, decimal-normalized | crypto |
| `hookswap/uniswap/pancake-v3` | `V3Adapter` | `observe([window,0])` mean-tick TWAP → `1.0001^tick` (canonical TickMath port); `slot0` spot fallback | crypto |
| `uniswap/pancake-v4` | `V4Adapter` | **stub** — singleton `StateView.getSlot0(poolId)` | crypto |
| `chainlink` | `ChainlinkAdapter` | `latestRoundData()` → 1e18, `updatedAt` staleness check | **stock / rwa / fx** |
| `pyth` | `PythAdapter` | `getPriceNoOlderThan(id, age)` (reverts if stale/unposted) | **stock / rwa / fx** |
| `api` | `ApiAdapter` | allowlisted (optionally signed) HTTP source | **rwa / fx** |
| `zerox-rfq` | `ZeroxRfqAdapter` | **stub** — 0x RFQ spot-reference (cross-check only) | stock |

v4 and 0x-RFQ are deliberately documented stubs (see the module headers); v4
reuses ~all of `math.ts` (same Q64.96 math as v3) when unblocked.

### Market config (`config/markets.json`)
A market is **fully described by config**:
`{ market, assetClass: 'crypto'|'stock'|'rwa'|'fx', oracle: { sourceType, …params },
collateralToken?, maxLeverage? }`. The `oracle` block's params are per-`sourceType`
(AMM: `chainId/poolAddress/quoteToken/twapWindow`; Chainlink: `feed/decimals`;
Pyth: `pythContract/priceId`; API: `url/allowedHost/pricePath`). Copy
`config/markets.example.json` → `markets.json` (crypto v3, Uniswap v3, `AAPL-PERP`
+ `NVDA-PERP` stocks via Chainlink, gold RWA, Pyth, API examples) and fill in real
addresses/feeds. The legacy flat-route file (`config/routes.json`,
`{market,chainId,protocol,poolAddress,quoteToken}`) is still loadable and is
lifted to a crypto market automatically (`loadRoutes`/`routeToMarket`).

### Extensibility guarantee — [EXTENSIBILITY.md](./EXTENSIBILITY.md)
Add a **market** (config + optional admin `addSupportedToken`), a **venue** (new
adapter module — off-chain), or an **RWA/stock** (external-feed adapter + config)
with **NO `Settlement` redeploy**. `EXTENSIBILITY.md` proves it against the exact
on-chain functions (`Settlement.settleBatch`/`Order.token`/`addSupportedToken`,
`ContractRegistry.setContractSpec`) and flags the one hardcoded value that would
force a redeploy (global `MAX_LEVERAGE = 100×`).

### HookSwap pool wiring
`oracle/deployments.ts` reads `contracts/deployments/*.json` (v2/v3 factories,
WETH, init-code hashes) so routes resolve HookSwap chains without hardcoding, incl.
`computeHookSwapV2Pair(chainId, tokenA, tokenB)` (CREATE2) for the custom chains
whose factory isn't in `@uniswap/v2-sdk`.

## Run
```bash
npm install                 # viem
npm run typecheck           # tsc --noEmit (passes)
PERPS_RPC_196=<xlayer-rpc> npm run oracle:demo   # prices every route in the config
```
RPC per chain: env `PERPS_RPC_<chainId>` overrides the public fallback in `oracle/rpc.ts`.

## Validation (real, on-chain)
- `computeHookSwapV2Pair(196, WOKB, STT)` → `0x1A95898916C7872F4712c92A1b665E54414728Bd`,
  matching the on-chain XLayer seeded pair.
- `getMarkPrice("STT-PERP")` against that live pool → `0.00005` WOKB/STT, exactly the
  seeded 0.05 WOKB / 1000 STT ratio.
- v2 (WETH/USDC=2000), v3 (tick 0 → 1.0) unit checks pass; `tsc --noEmit` clean.
