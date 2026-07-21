# HookSwap Locker Indexer

Phase-1 data service for the HookSwap locker analytics product (UNCX-style). It
enumerates **every token / LP lock** across the 7 HookSwap chains directly from
each chain's `HookSwapTokenLockerManager` (no subgraph, no DB), aggregates them
per-token / per-pool / globally, records a **daily TVL snapshot** so a TVL-over-time
chart accrues going forward, and serves everything over a read-only JSON API.

**Facts only.** Every value is a real on-chain read. Tokens the pricing module
can't price report their **native amount only** — `valueUsd` is omitted, never
faked. A chain whose RPC fails is reported `reachable: false` (its last-known locks
are retained and flagged `stale`), never fabricated.

## Run

```bash
npm install
npm start          # tsx src/index.ts
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
```

### Config (env, all optional)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4200` | HTTP API port |
| `LOCKER_REFRESH_MS` | `300000` | full cross-chain re-index interval |
| `LOCKER_CHAIN_TIMEOUT_MS` | `45000` | per-chain read timeout (slow chain → stale, others unaffected) |
| `LOCKER_BATCH_SIZE` | `200` | ids per multicall batch |
| `LOCKER_TVL_HISTORY_FILE` | `./data/tvl-history.json` | daily TVL series file |
| `LOCKER_RPC_<chainId>` / per-chain alias | public RPC | RPC override (e.g. `SEPOLIA_RPC_URL`, `ROBINHOOD_RPC_URL`, `HYPEREVM_RPC_URL`, `INK_RPC_URL`, `MEGAETH_RPC_URL`, `XLAYER_RPC_URL`, `TEMPO_RPC_URL`) |

Chains indexed: HyperEVM (999), Ink (57073), MegaETH (4326), XLayer (196),
Robinhood (4663), Tempo (4217), Sepolia (11155111).

## Data shapes

Amounts are `{ raw, formatted }` — `raw` is the base-unit integer as a **string**
(no precision loss), `formatted` is `raw / 10**decimals`. `valueUsd` / `tvlUsd`
are numbers **present only when priceable** (omitted otherwise).

```jsonc
// Lock
{
  "chainId": 11155111, "chainName": "Sepolia", "id": 3,
  "lockerContract": "0x…",          // the per-lock HookSwapTokenLocker child
  "token": "0x…", "symbol": "HOOK", "decimals": 18,
  "isLpToken": false,
  "owner": "0x…", "createdBy": "0x…",
  "createdAt": 1721000000, "unlockTime": 1752536000,   // unix seconds
  "amount": { "raw": "1000000000000000000000", "formatted": "1000" },
  "totalSupply": { "raw": "…", "formatted": "1000000" },
  "lockedPctOfSupply": 0.1,          // null when totalSupply is 0
  "valueUsd": 1234.5,                // omitted when unpriced
  "status": "locked",                // "locked" | "unlockable" (unlockTime <= now)
  "lp": {                            // present only when isLpToken
    "token0": { "token":"0x…","symbol":"WETH","decimals":18,
                "balance": {"raw":"…","formatted":"…"}, "valueUsd": 900.0 },
    "token1": { "token":"0x…","symbol":"USDG","decimals":18,
                "balance": {"raw":"…","formatted":"…"}, "valueUsd": 900.0 }
  }
}

// TokenAgg (non-LP locks grouped per token, per chain)
{ "chainId":11155111,"chainName":"Sepolia","token":"0x…","symbol":"HOOK","decimals":18,
  "totalLockedAmount":{"raw":"…","formatted":"…"},
  "totalSupply":{"raw":"…","formatted":"…"},
  "lockedPctOfSupply":42.0, "tvlUsd":50000.0, "lockCount":7 }

// PoolAgg (LP locks grouped per pair token, per chain)
{ "chainId":11155111,"chainName":"Sepolia","pair":"0x…","symbol":"HOOK-LP",
  "token0":"0x…","token1":"0x…","token0Symbol":"WETH","token1Symbol":"USDG",
  "totalLockedAmount":{"raw":"…","formatted":"…"}, "tvlUsd":80000.0, "lockCount":3 }
```

For aggregates, `tvlUsd` is present **only when every contributing lock priced**
(any unpriced component → `tvlUsd` omitted, honest).

## Endpoints

All responses are JSON with `Access-Control-Allow-Origin: *`. GET only.

### `GET /health`
Liveness + per-chain reachability.
```jsonc
{ "ok": true, "generatedAt": 1721400000000, "refreshMs": 300000,
  "chains": [ { "chainId":11155111,"name":"Sepolia","reachable":true,"stale":false,
                "lockCount":12,"lastIndexedAt":1721399990000,"error":null } ] }
```

### `GET /stats`
Global stats + per-chain breakdown.
```jsonc
{ "generatedAt": 1721400000000,
  "totalLocks": 40,
  "totalTvlUsd": 152340.5,   // omitted if nothing could be priced
  "pricedLocks": 31, "unpricedLocks": 9,   // price-coverage transparency
  "newLocks24h": 4,
  "chains": 7, "reachableChains": 6,
  "perChain": [ /* ChainStatus[] — chainId,name,manager,rpcUrl,reachable,stale,error?,lockCount,tvlUsd?,lastIndexedAt */ ] }
```

### `GET /locks?chainId=&sort=tvl|created&limit=&offset=`
All locks, filterable by `chainId`, sortable, paginated.
- `sort=tvl` (default): `valueUsd` desc, then raw amount desc (unpriced sink below priced).
- `sort=created`: newest `createdAt` first.
- `limit` default 100 (max 1000), `offset` default 0.
```jsonc
{ "total": 40, "offset": 0, "limit": 100, "locks": [ /* Lock[] */ ] }
```

### `GET /tokens`
All token aggregates (non-LP), sorted by `tvlUsd` desc then `lockCount`.
```jsonc
{ "total": 18, "tokens": [ /* TokenAgg[] */ ] }
```

### `GET /pools`
All LP/pool aggregates, sorted by `tvlUsd` desc then `lockCount`.
```jsonc
{ "total": 6, "pools": [ /* PoolAgg[] */ ] }
```

### `GET /token/:chainId/:address`
One token's aggregate + every non-LP lock of it (sorted by TVL). 404 if none.
```jsonc
{ "token": { /* TokenAgg | null */ }, "locks": [ /* Lock[] */ ] }
```

### `GET /pool/:chainId/:address`
One pool's aggregate + every LP lock of it (sorted by TVL). `:address` = the LP
(pair) token address. 404 if none.
```jsonc
{ "pool": { /* PoolAgg | null */ }, "locks": [ /* Lock[] */ ] }
```

### `GET /lock/:chainId/:id`
A single lock (powers shareable lock pages). 404 if not found.
```jsonc
{ "lock": { /* Lock */ } }
```

### `GET /tvl-history`
The daily TVL snapshot series (oldest → newest). One point per UTC day, deduped
(the day's point updates in place until the day rolls over). Accrues from first run.
```jsonc
{ "points": [
  { "dateISO": "2026-07-20", "updatedAt": 1721400000000,
    "totalTvlUsd": 152340.5, "totalLocks": 40,
    "perChain": [ { "chainId":11155111,"name":"Sepolia","totalLocks":12,"tvlUsd":50000.0,"reachable":true } ] }
] }
```

## Notes

- USD pricing is delegated to `src/pricing.ts` (owned separately). This service
  treats a token's price as `undefined` = unpriceable and reports native-only.
- Reads are batched with Multicall3 (`0xcA11…CA11`, deployed on every chain).
- LP token amounts are treated as 18-decimals for the pool aggregate; each LP
  leg is valued from its own token price + decimals.
- The daily series only grows while the service runs; there is no historical
  backfill (on-chain lock state has no per-day TVL history to reconstruct).
