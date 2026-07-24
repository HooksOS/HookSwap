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
| `LOCKER_TVL_HISTORY_FILE` | `./data/tvl-history.json` | daily locker TVL series file |
| `FARMS_TVL_HISTORY_FILE` | `./data/farms-tvl-history.json` | daily farms TVL series file |
| `VESTING_TVL_HISTORY_FILE` | `./data/vesting-tvl-history.json` | daily vesting locked-value series file |
| `LOCKER_APP_BASE_URL` | `https://hookswap.org` | app base the `/lock/.../share` page redirects humans to (`<base>/#/lock/:chainId/:id`) |
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
A single lock (powers shareable lock pages). 404 if not found. `:id` may be the
numeric lock id **or** the locked token address (self-describing shareable URL).
```jsonc
{ "lock": { /* Lock */ } }
```

### `GET /lock/:chainId/:idOrToken/og.png`
The per-lock **social preview card** — a 1200×630 PNG rendered server-side from the
SAME in-memory lock data (no external fetch). Shows the token/pair, locked amount,
USD value (only when priced — an honest "Unpriced" chip otherwise), a lock-term
progress bar, unlock date + countdown, `% of supply`, chain, and HookSwap branding.
404 (JSON) for an unknown lock. `content-type: image/png`, `cache-control: max-age=300`.
Rendered with `@resvg/resvg-js` from a hand-authored SVG; fonts are the bundled TTFs
in `src/assets/fonts/` (Inter + InputMono for numerics — resvg-js doesn't decode woff2).

### `GET /lock/:chainId/:idOrToken/share`
Minimal **crawler HTML** whose `<head>` carries the OpenGraph + Twitter meta
(`og:title` / `og:description` / `og:image` → the `og.png` above /
`twitter:card=summary_large_image`) plus a `<meta http-equiv="refresh">` + JS
redirect to the human, hash-routed in-app lock page. Exists because the app is a
hash-routed SPA whose per-route meta can't be crawled. The redirect target is
`${LOCKER_APP_BASE_URL}/#/lock/:chainId/:idOrToken` (`LOCKER_APP_BASE_URL` defaults
to `https://hookswap.org`); `og:image` is built from the incoming request's
`x-forwarded-proto`/`-host` (or `Host`) so it is absolute behind the reverse proxy.
404 (JSON) for an unknown lock.

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

## Farms module

A second module indexes every **StakingRewards farm** (Synthetix-style single-sided
staking) deployed by each chain's `StakingRewardsFactory`, using the SAME chain
config + pricing as the locker. Enumeration is pure RPC: `allFarms()` on every
configured factory → union the children → read each child's views. A chain may have
**several** factories (a current + a superseded deploy); all are indexed and unioned.

Factories indexed (from `apps/web/src/terminal/farms/addresses.ts` +
`contracts/deployments/<chain>-suite.json`): Robinhood (4663), HyperEVM (999),
XLayer (196), MegaETH (4326), Ink (57073), Tempo (4217), and Sepolia (11155111)
(both its current `0x1443…F376` and superseded `0xb9df…6313` factories). A chain
with no configured factory is simply omitted from the farms surface.

**Same honesty rules.** `tvlUsd` is present only when the **staking token** prices
(USD resolves on Robinhood only today; every other chain → omitted). `aprPct` is
present only when BOTH the staking and reward tokens price AND `totalSupply > 0`
— never a fabricated yield. A chain whose RPC fails retains its last-known farms
flagged `stale`.

```jsonc
// Farm
{
  "chainId": 11155111, "chainName": "Sepolia",
  "factory": "0x…",                 // the StakingRewardsFactory that deployed it
  "farm": "0x…",                    // the StakingRewards child contract
  "stakingToken": { "addr":"0x…","symbol":"STK","decimals":18 },
  "rewardToken":  { "addr":"0x…","symbol":"TST","decimals":18 },
  "tvlStaked": { "raw":"0","formatted":"0" },          // totalSupply() (staked balance)
  "tvlUsd": 1234.5,                 // omitted unless the staking token prices
  "rewardRatePerSec": { "raw":"2777777777777777","formatted":"0.002777…" }, // rewardRate()
  "rewardsDuration": 3600,          // seconds
  "periodFinish": 1784062860,       // unix seconds
  "rewardsRemaining": { "raw":"0","formatted":"0" },   // max(0,periodFinish-now)×rate
  "rewardBudget": { "raw":"9999999999999997200","formatted":"9.9999…" }, // getRewardForDuration()
  "status": "ended",                // "active" while now < periodFinish, else "ended"
  "aprPct": 42.0                    // omitted unless both tokens price AND totalSupply>0
}

// FarmsStats
{ "totalFarms": 2, "activeFarms": 0,
  "totalTvlUsd": 1234.5,            // omitted when nothing priced
  "chains": 7, "reachableChains": 7 }
```

### `GET /farms/stats`
Global farms stats + per-chain breakdown.
```jsonc
{ "generatedAt": 1784605215732,
  "totalFarms": 2, "activeFarms": 0,
  "totalTvlUsd": 1234.5,           // omitted if nothing could be priced
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
A single farm's detail (powers the shareable farm page). `:address` = the
StakingRewards child address. 404 if not found.
```jsonc
{ "farm": { /* Farm */ } }
```

### `GET /farms/tvl-history`
The daily farms-TVL snapshot series (oldest → newest). One point per UTC day,
deduped, accrues from first run. Separate file from the locker series
(`FARMS_TVL_HISTORY_FILE`, default `./data/farms-tvl-history.json`).
```jsonc
{ "points": [
  { "dateISO": "2026-07-21", "updatedAt": 1784605215735,
    "totalTvlUsd": 1234.5, "totalFarms": 2, "activeFarms": 0,
    "perChain": [ { "chainId":11155111,"name":"Sepolia","totalFarms":2,"activeFarms":0,"tvlUsd":1234.5,"reachable":true } ] }
] }
```

## Vesting module

Same service also indexes every **HookSwapVestingManager** vesting schedule across
the chains that have a manager deployed, reusing the locker's chain config +
pricing. Enumeration is pure RPC: `vestingCount()` → ids `0..N-1`, `getScheduleData(id)`
(chunked multicall) → the 10-field schedule tuple, then `releasable()` on each
per-schedule child for live claimable. Managers indexed (from
`apps/web/src/terminal/vesting/addresses.ts` + the verified Sepolia test deploy):
Robinhood/HyperEVM (`0x7f91…8677`), XLayer (`0xb8b8…2a56`), MegaETH (`0x7eff…79d0`),
Ink (`0x250c…20e25`), Tempo (`0xd08e…7a63`), Sepolia (`0x250c…20e25`). A chain with
no configured manager honestly reports zero schedules.

FACTS ONLY: `valueUsd` (the still-locked/unvested principal in USD) is present only
when the token prices (Robinhood-only today), never fabricated. A chain whose RPC
fails retains its last-known schedules and is flagged `stale`.

```jsonc
// VestingSchedule
{ "chainId": 11155111, "chainName": "Sepolia", "id": 0,
  "contractAddress": "0x…",                 // the per-schedule HookSwapVesting child
  "token": { "addr": "0x…", "symbol": "TST", "decimals": 18 },
  "beneficiary": "0x…", "creator": "0x…",
  "start": 1784058996, "cliff": 0, "duration": 3600,
  "cliffTime": 1784058996, "endTime": 1784062596,   // start+cliff / start+duration
  "totalAmount": { "raw": "10000000000000000000", "formatted": "10" },
  "released":    { "raw": "200000000000000000",  "formatted": "0.2" },
  "claimable":   { "raw": "9800000000000000000", "formatted": "9.8" },  // releasable()
  "vested":      { "raw": "10000000000000000000","formatted": "10" },   // released+claimable
  "pctVested": 100, "status": "complete",           // cliff | vesting | complete
  "valueUsd": 12.3 }                                // omitted when unpriceable

// VestingStats
{ "totalSchedules": 1, "activeSchedules": 0,
  "totalLockedUsd": 0,                              // omitted when nothing priced
  "chains": 7, "reachableChains": 7 }
```

### `GET /vesting/stats`
Global vesting stats + per-chain breakdown.
```jsonc
{ "generatedAt": 1784651196681, "totalSchedules": 1, "activeSchedules": 0,
  "chains": 7, "reachableChains": 7,
  "perChain": [ /* VestingChainStatus[] — chainId,name,manager,rpcUrl,reachable,stale,error?,scheduleCount,activeCount,tvlUsd?,lastIndexedAt */ ] }
```

### `GET /vesting?chainId=&sort=tvl|created|ending|pct&limit=&offset=`
All schedules, filterable by `chainId`, sortable, paginated.
- `sort=tvl` (default): locked `valueUsd` desc, then total raw amount desc.
- `sort=created`: newest `start` first · `sort=ending`: soonest `endTime` first · `sort=pct`: `pctVested` desc.
- `limit` default 100 (max 1000), `offset` default 0.
```jsonc
{ "total": 1, "offset": 0, "limit": 100, "schedules": [ /* VestingSchedule[] */ ] }
```

### `GET /vesting/:chainId/:id`
A single schedule's detail (powers the shareable vesting page). 404 if not found.
```jsonc
{ "schedule": { /* VestingSchedule */ } }
```

### `GET /vesting/tvl-history`
The daily vesting locked-value snapshot series (oldest → newest). One point per UTC
day, deduped (`VESTING_TVL_HISTORY_FILE`, default `./data/vesting-tvl-history.json`).
```jsonc
{ "points": [
  { "dateISO": "2026-07-21", "updatedAt": 1784651196681,
    "totalLockedUsd": 0, "totalSchedules": 1, "activeSchedules": 0,
    "perChain": [ { "chainId":11155111,"name":"Sepolia","totalSchedules":1,"activeSchedules":0,"tvlUsd":0,"reachable":true } ] }
] }
```

## LaunchPad module

Same service also indexes every **HookOSV3Launcher** launch on the chains that have
a launcher deployed (Robinhood-only today), reusing the locker's chain config +
pricing. Enumeration is pure RPC: `launchCount()` → ids `0..N-1`, `getLaunch(id)`
(chunked multicall) → the launch struct, then ERC-20 `name`/`symbol`/`decimals`/
`totalSupply` on each token (the struct carries neither name nor symbol) and
`HookOSV3FeeVault.isPermanentlyLocked(token)` for the LP-lock flag. Launcher/FeeVault
from `apps/web/src/terminal/launchpad/addresses.ts` (Robinhood launcher
`0x9B8d…e0B8`, feeVault `0x2974…22EF`). A chain with no configured launcher honestly
reports zero launches.

FACTS ONLY: `marketCapUsd` (= `totalSupply` × price) is present only when the token
prices (Robinhood-only today), never fabricated. A chain whose RPC fails retains its
last-known launches and is flagged `stale`.

```jsonc
// Launch
{ "chainId": 4663, "chainName": "Robinhood", "id": 3,
  "token": { "addr": "0x…", "name": "HookSwap Test Token", "symbol": "HSTT",
             "decimals": 18, "totalSupply": { "raw": "…", "formatted": "1000000000" } },
  "pool": "0x…", "creator": "0x…", "tokenId": "3",
  "feeTier": 10000, "dex": 1, "pair": 0, "pairToken": "0x…",
  "metadataURI": "ipfs://…", "createdAt": 1784107857,
  "lpLocked": false, "lpUnlockTime": 0,             // from FeeVault.isPermanentlyLocked
  "marketCapUsd": 5845.07 }                         // omitted when unpriceable

// LaunchpadStats
{ "totalLaunches": 4, "lpLockedLaunches": 0,
  "totalMarketCapUsd": 8774.99,                     // omitted when nothing priced
  "chains": 1, "reachableChains": 1 }
```

### `GET /launches/stats`
Global launchpad stats + per-chain breakdown.
```jsonc
{ "generatedAt": 1784651198296, "totalLaunches": 4, "lpLockedLaunches": 0,
  "totalMarketCapUsd": 8774.99, "chains": 1, "reachableChains": 1,
  "perChain": [ /* LaunchpadChainStatus[] — chainId,name,launcher,feeVault,rpcUrl,reachable,stale,error?,launchCount,lastIndexedAt */ ] }
```

### `GET /launches?chainId=&sort=mcap|created&limit=&offset=`
All launches, filterable by `chainId`, sortable, paginated.
- `sort=mcap` (default): `marketCapUsd` desc, then `createdAt` desc (unpriced sink below).
- `sort=created`: newest `createdAt` first · `limit` default 100 (max 1000), `offset` default 0.
```jsonc
{ "total": 4, "offset": 0, "limit": 100, "launches": [ /* Launch[] */ ] }
```

### `GET /launch/:chainId/:token`  ·  `GET /launch/:chainId/:id`
A single launch's detail (the shareable launch page) — by **token address** (the
primary shareable key) or by numeric **launch id**. 404 if not found.
```jsonc
{ "launch": { /* Launch */ } }
```

## Notes

- USD pricing is delegated to `src/pricing.ts` (owned separately). This service
  treats a token's price as `undefined` = unpriceable and reports native-only.
- Reads are batched with Multicall3 (`0xcA11…CA11`, deployed on every chain).
- LP token amounts are treated as 18-decimals for the pool aggregate; each LP
  leg is valued from its own token price + decimals.
- The daily series only grows while the service runs; there is no historical
  backfill (on-chain lock state has no per-day TVL history to reconstruct).
