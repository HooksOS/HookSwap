# Architecture overview

HookSwap is a multi-chain DEX running on **its own deployed contracts**, served by a
**self-hosted** routing backend.

## Request flow

```
HookSwap interface (browser)
   │  POST https://trading.hookswap.org/v1/quote     (Trading API schema)
   ▼
HookSwap Trading API  (self-hosted)
   │   computes routes against HookSwap's on-chain pools via per-chain JSON-RPC
   ▼
HookSwap on-chain contracts:  v2 pools · v3 pools · Universal Router · Permit2
```

- The interface does **not** compute routes itself — it calls a Trading API endpoint.
- HookSwap's Trading API computes routes against HookSwap's deployed pools and returns quotes.
- Quotes/swaps are then executed on-chain through the **Universal Router** (+ Permit2 for
  approvals).

See [routing.md](./routing.md) for the Trading API details, and
[contract addresses](./contract-addresses.md) for the deployed stack per chain.

## What HookSwap deploys

On every chain HookSwap owns a full **v2 + v3 + Universal Router** stack:

- v2 factory + router
- v3 factory + periphery (NonfungiblePositionManager, QuoterV2, tick lens, migrator, multicall)
- SwapRouter02 + Universal Router
- Permit2 (the canonical CREATE2 deployment, identical address everywhere)

**No v4 / no hooks** on any chain — pool creation uses the classic v2 `createPair` and v3
`NonfungiblePositionManager` paths.

## Init-code hashes

The pair/pool **init-code hashes are canonical and identical on every chain**:

| | Init code hash |
|---|---|
| v2 pair | `0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f` |
| v3 pool | `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` |

Consequence: only **factory/manager addresses** differ per chain — the hashes are untouched. You
can compute pool/pair addresses off-chain deterministically with
`getCreate2Address(factory, salt, initCodeHash)`.

## What is and isn't done

- **Done:** contracts deployed on all 6 custom chains (Sepolia reuses the canonical testnet
  stack); the rebranded interface pointed at HookSwap addresses.
- **In progress:** the routing backend, indexing, and on-chain liquidity. Until those land for a
  given chain/pair, quotes return `404 NO_ROUTE_FOUND`.

## Fees

HookSwap's fee stack mirrors Uniswap's, with the treasury/fee-receiver
`0x011d438E3eb3fce848950859591ec037C6529E13` as the protocol beneficiary:

- **LP / pool fee** — v2 pools charge a flat **0.30%** to LPs; v3 pools charge their fee tier
  (0.01% / 0.05% / 0.30% / 1.00%). This accrues to liquidity providers.
- **Interface fee — 0.30%** — taken on the swap's **output** token (via Universal Router
  `PAY_PORTION`) on every swap routed through the HookSwap interface, sent to the treasury.
  (`HOOKSWAP_FEE_BIPS=30` in the trading adapter; raised from 0.2% → 0.3% on 2026-07-24.)
- **v2 protocol-fee switch (`feeTo`)** — **ENABLED (2026-07-24) on 6 of 7 chains** → treasury:
  Robinhood (4663), X Layer (196), MegaETH (4326), Ink (57073), HyperEVM (999), Tempo (4217).
  When `feeTo` is set, ~1/6 of the 0.30% (≈0.05%) is minted as LP tokens to the treasury on
  liquidity events. **Stable (988) is pending** — its v2 factory's `feeToSetter` is the treasury
  Safe itself, so `setFeeTo` must be executed from the Safe (a batch tx is queued). Sepolia is the
  canonical Uniswap deployment (not HookSwap's) and is skipped.
- **v3 protocol fee** — **ENABLED on Robinhood** (2026-07-24) via `feeProtocol(6,6)` (1/6) on all
  four live RH v3 pools. Other chains have no v3 pools yet (their live pools are all v2).
- **Perps** — the `FeeRouter` splits each trade's per-side fee **platform 50% (floor 40%) /
  creator 40% / insurance 10%** (see [perps.md](./perps.md)).

> **Note:** the [DefiLlama adapter](./analytics-indexer.md#defillama--external-analytics) still
> reports `revenueRatio: 0` (100% of the 0.30% pool fee to LPs) — it has not been updated for the
> 2026-07-24 v2 `feeTo` enablement, so DefiLlama shows protocol revenue = 0 at the pool level.

## HookSwap surfaces (subdomains)

| Surface | URL | What it is |
|---|---|---|
| App / Terminal | `https://hookswap.org` | The main swap + LP + perps + launchpad interface |
| Docs | `https://docs.hookswap.org` | This documentation site |
| Bridge | `https://bridge.hookswap.org` | Cross-chain bridge, **Relay-powered** (`api.relay.link`) |
| Admin console | `https://admin.hookswap.org` | Internal ops console — Safe-batch builder, **treasury-Safe gated** (basic-auth), holds no keys |
| Developer portal | `https://developer.hookswap.org` | Developer landing (serves the same web root as docs) |
| Trading API | `https://trading.hookswap.org` | Self-hosted routing/quote backend (see [routing.md](./routing.md)) |
| Data API | `https://data.hookswap.org` | Read-only pool/token/stats REST + locker/farms indexer (see [data-api.md](./data-api.md)) |
