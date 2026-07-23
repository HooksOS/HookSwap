# Analytics & Indexer API (locker indexer)

The **locker indexer** is a read-only data service powering HookSwap's locker & farms analytics
("Ledger"). It enumerates **every token / LP lock** and **every staking farm** across the 7
HookSwap chains **directly from the chain** (no subgraph, no DB), aggregates them per-token /
per-pool / per-farm / globally, records a **daily TVL snapshot**, and serves everything over a
read-only JSON API.

- **Base URL:** `https://data.hookswap.org/locker` (the `LOCKER_API_URL` the app reads;
  overridable in the app via env `LOCKER_API_URL` / `VITE_LOCKER_API_URL`).
- **Methods:** `GET` only. All responses are `application/json`.
- **CORS:** open (`Access-Control-Allow-Origin: *`), no credentials.
- **Data source:** real on-chain reads, batched via Multicall3 (`0xcA11…CA11`). No subgraph, no DB.
- **Chains indexed:** HyperEVM (999), Ink (57073), MegaETH (4326), XLayer (196),
  Robinhood (4663), Tempo (4217), Sepolia (11155111).
- **Source of truth:** `locker-indexer/README.md` in the repo (this page mirrors it).

> The app config point is `apps/web/src/terminal/lockers/analytics/client.ts` — it resolves
> `LOCKER_API_URL` from env, defaulting to `https://data.hookswap.org/locker`.

## USD-honesty rule (facts-only)

Every value is a real on-chain read. **USD values appear only where a stablecoin price anchor
exists** — today that is **Robinhood (4663)** via the WETH/USDG anchor pool. Everywhere else,
tokens report their **native amount only**:

- `valueUsd` / `tvlUsd` are **numbers present only when priceable** — **omitted** (never `0`,
  never fabricated) otherwise. The app renders an honest `—` for an omitted USD field.
- For an aggregate, `tvlUsd` is present **only when every contributing lock priced**; any unpriced
  component → `tvlUsd` omitted.
- For a farm, `tvlUsd` needs the **staking token** to price; `aprPct` needs **both** the staking
  and reward tokens to price **and** `totalSupply > 0` — otherwise both are omitted (never a
  fabricated yield).
- A chain whose RPC fails is reported `reachable: false`; its last-known data is retained and
  flagged `stale`, never dropped and never faked.

## Data shapes

Amounts are `{ raw, formatted }` — `raw` is the base-unit integer as a **string** (no precision
loss); `formatted` is `raw / 10**decimals`.

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

// Farm
{
  "chainId": 11155111, "chainName": "Sepolia",
  "factory": "0x…",                 // the StakingRewardsFactory that deployed it
  "farm": "0x…",                    // the StakingRewards child contract
  "stakingToken": { "addr":"0x…","symbol":"STK","decimals":18 },
  "rewardToken":  { "addr":"0x…","symbol":"TST","decimals":18 },
  "tvlStaked": { "raw":"0","formatted":"0" },          // totalSupply() (staked balance)
  "tvlUsd": 1234.5,                 // omitted unless the staking token prices
  "rewardRatePerSec": { "raw":"…","formatted":"…" },   // rewardRate()
  "rewardsDuration": 3600,          // seconds
  "periodFinish": 1784062860,       // unix seconds
  "rewardsRemaining": { "raw":"0","formatted":"0" },
  "rewardBudget": { "raw":"…","formatted":"…" },       // getRewardForDuration()
  "status": "ended",                // "active" while now < periodFinish, else "ended"
  "aprPct": 42.0                    // omitted unless both tokens price AND totalSupply>0
}
```

---

## Locker endpoints

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
  "totalTvlUsd": 152340.5,          // omitted if nothing could be priced
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
One token's aggregate + every non-LP lock of it (sorted by TVL). `404` if none.
```jsonc
{ "token": { /* TokenAgg | null */ }, "locks": [ /* Lock[] */ ] }
```

### `GET /pool/:chainId/:address`
One pool's aggregate + every LP lock of it (sorted by TVL). `:address` = the LP (pair) token
address. `404` if none.
```jsonc
{ "pool": { /* PoolAgg | null */ }, "locks": [ /* Lock[] */ ] }
```

### `GET /lock/:chainId/:id`
A single lock — **this powers the shareable public proof-of-lock pages** (`/lock/:chainId/:id` in
the app). `404` if not found. No wallet required.
```jsonc
{ "lock": { /* Lock */ } }
```

### `GET /tvl-history`
The daily TVL snapshot series (oldest → newest). One point per UTC day, deduped (the day's point
updates in place until the day rolls over). Accrues from first run — no historical backfill.
```jsonc
{ "points": [
  { "dateISO": "2026-07-20", "updatedAt": 1721400000000,
    "totalTvlUsd": 152340.5, "totalLocks": 40,
    "perChain": [ { "chainId":11155111,"name":"Sepolia","totalLocks":12,"tvlUsd":50000.0,"reachable":true } ] }
] }
```

## Farms endpoints

A second module indexes every **StakingRewards farm** (Synthetix-style single-sided staking)
deployed by each chain's `StakingRewardsFactory` — pure RPC (`allFarms()` → union children → read
each child's views). A chain may have several factories (current + superseded); all are indexed
and unioned. Same honesty rules as above.

### `GET /farms/stats`
Global farms stats + per-chain breakdown.
```jsonc
{ "generatedAt": 1784605215732,
  "totalFarms": 2, "activeFarms": 0,
  "totalTvlUsd": 1234.5,            // omitted if nothing could be priced
  "chains": 7, "reachableChains": 7,
  "perChain": [ /* FarmChainStatus[] — chainId,name,factories[],rpcUrl,reachable,stale,error?,farmCount,activeFarmCount,tvlUsd?,lastIndexedAt */ ] }
```

### `GET /farms?chainId=&sort=tvl|apr&limit=&offset=`
All farms, filterable by `chainId`, sortable, paginated.
- `sort=tvl` (default): `tvlUsd` desc, then staked raw amount desc (unpriced sink below priced).
- `sort=apr`: `aprPct` desc (farms without an APR sink to the bottom).
- `limit` default 100 (max 1000), `offset` default 0.
```jsonc
{ "total": 2, "offset": 0, "limit": 100, "farms": [ /* Farm[] */ ] }
```

### `GET /farm/:chainId/:address`
A single farm's detail (powers the shareable farm page). `:address` = the StakingRewards child
address. `404` if not found.
```jsonc
{ "farm": { /* Farm */ } }
```

### `GET /farms/tvl-history`
The daily farms-TVL snapshot series (oldest → newest). One point per UTC day, deduped, accrues
from first run. Stored separately from the locker series.
```jsonc
{ "points": [
  { "dateISO": "2026-07-21", "updatedAt": 1784605215735,
    "totalTvlUsd": 1234.5, "totalFarms": 2, "activeFarms": 0,
    "perChain": [ { "chainId":11155111,"name":"Sepolia","totalFarms":2,"activeFarms":0,"tvlUsd":1234.5,"reachable":true } ] }
] }
```

## Also indexable the same way (planned Ledger surfaces)

The same pure-RPC pattern (`count()` + `getById()` enumeration, no subgraph) applies to the rest
of the self-service suite, so future Ledger pages are available as data whenever wired:

- **Vesting** — enumerate `HookSwapVestingManager` schedules per chain.
- **LaunchPad** — enumerate `HookOSV3Launcher` launches (Robinhood).
- **Airdrops** — enumerate `MerkleDistributorFactory` distributions.

These are noted as **planned / available data**, not yet served endpoints.

## Config (indexer env, all optional)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4200` | HTTP API port (the public base is fronted at `https://data.hookswap.org/locker`) |
| `LOCKER_REFRESH_MS` | `300000` | full cross-chain re-index interval |
| `LOCKER_CHAIN_TIMEOUT_MS` | `45000` | per-chain read timeout (slow chain → stale, others unaffected) |
| `LOCKER_BATCH_SIZE` | `200` | ids per multicall batch |
| `LOCKER_TVL_HISTORY_FILE` | `./data/tvl-history.json` | daily locker TVL series file |
| `FARMS_TVL_HISTORY_FILE` | `./data/farms-tvl-history.json` | daily farms TVL series file |
| `LOCKER_RPC_<chainId>` / per-chain alias | public RPC | RPC override (e.g. `SEPOLIA_RPC_URL`, `ROBINHOOD_RPC_URL`, `HYPEREVM_RPC_URL`, `INK_RPC_URL`, `MEGAETH_RPC_URL`, `XLAYER_RPC_URL`, `TEMPO_RPC_URL`) |

---

## DefiLlama / external analytics

Beyond the self-hosted indexer above, HookSwap ships **DefiLlama adapters** so its DEX TVL, volume
and fees appear on DefiLlama's public dashboards. These are on-chain-read adapters (idiomatic
DefiLlama path — no subgraph, no HookSwap data-api dependency). Source + full evidence:
[`defillama-adapters/README.md`](../../defillama-adapters/README.md).

| Adapter | File (in repo) | DefiLlama repo target | Produces |
|---|---|---|---|
| TVL | `defillama-adapters/hookswap/index.js` | `DefiLlama-Adapters/projects/hookswap/index.js` | TVL (sums v2 pair reserves) |
| Volume + Fees | `defillama-adapters/dexs/hookswap/index.ts` | `dimension-adapters/dexs/hookswap/index.ts` | Volume + Fees (v2 `Swap` events) |
| MegaETH chain registration | `defillama-adapters/chainlist/chainid-4326.js` | `DefiLlama/chainlist/constants/additionalChainRegistry/chainid-4326.js` | unblocks MegaETH |

- **TVL + Fees enabled** on **Robinhood (4663), Ink (57073), XLayer (196), HyperEVM (999, sdk key
  `hyperliquid`), Stable (988)** — the 5 chains that both have a real v2 pool **and** are already
  registered in `@defillama/sdk` providers.json.
- **MegaETH (4326) is pending** a DefiLlama-side chain registration: it has a real WETH/USDm pool but
  chainId 4326 is absent from providers.json, so the harness can't resolve an RPC. The ready-to-submit
  `chainid-4326.js` unblocks it; the `megaeth` line in each adapter is commented out until it merges.
- **v3 is off** on every chain (v3 factories deployed but no confirmed v3 liquidity → a `PoolCreated`
  scan returns nothing). **Tempo (4217) is off** (no v2 pool — AA-native tokens can't pair).
- Fee model: HookSwap v2 charges **0.30%**, all to LPs (`revenueRatio: 0` — protocol `feeTo` unset →
  `dailyRevenue = 0`, `dailySupplySideRevenue = 100%`).
