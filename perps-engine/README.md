# perps-engine — HookSwapPerps off-chain support

Off-chain support for the HookSwapPerps P2P model. Currently ships the
**multi-DEX oracle adapter** (`oracle/`); the matching engine itself is rebranded
separately from upstream `backend/` (see the domain sync points in
`contracts/perps/README.md`).

## Oracle adapter (`oracle/`)

Turns any supported spot venue into a single decimal-normalized **scalar mark
price** (`price1e18`, quote-per-base) that the P2P matching engine consumes. The
engine uses it as the exit / liquidation / funding reference — **no
`Settlement.sol` change**, so pricing is chain- and DEX-agnostic.

```ts
import { SpotOracleAdapter, loadRoutes } from "./oracle";

const oracle = new SpotOracleAdapter(loadRoutes());        // reads config/routes.json
const { price1e18, ok, reason } = await oracle.getMarkPrice("ETH-PERP");
if (!ok) hold(reason);                                     // never settle on a fabricated price
```

### Interface
```ts
interface ISpotOracleAdapter { getMarkPrice(market): Promise<{ price1e18: bigint; ok: boolean }> }
```
On any recoverable failure it returns `{ ok:false, reason }` (e.g. `NO_LIQUIDITY`,
`NO_ROUTE`, `RPC_ERROR`) instead of throwing — honest, no mock prices.

### Sub-adapters
| protocol | how it prices | covers |
|---|---|---|
| `*-v2` | `getReserves()` → quote/base, decimal-normalized | hookswap-v2, uniswap-v2, pancake-v2 |
| `*-v3` | `observe([window,0])` mean-tick TWAP → `1.0001^tick` (canonical TickMath port); `slot0` spot fallback | hookswap-v3, uniswap-v3, pancake-v3 |
| `*-v4` | **stub** — singleton `StateView.getSlot0(poolId)`; needs `{stateView,poolId,oracleHook?}` | uniswap-v4, pancake-v4 |

v4 is deliberately a documented stub: HookSwap is `supportsV4:false` today. When
unblocked, v4 reuses ~all of `math.ts` (same Q64.96 concentrated math as v3) — see
`oracle/v4Adapter.ts` header.

### Route config (`config/routes.json`)
Per-market `{ market, chainId, protocol, poolAddress, quoteToken, twapWindow? }`.
`quoteToken` names the numeraire (the OTHER pool token is the base); orientation
vs. token0/token1 is auto-derived — no manual invert flag. Copy
`config/routes.example.json` → `routes.json` and fill in real pool addresses.

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
