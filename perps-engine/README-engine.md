# HookSwapPerps — Off-chain Matching Engine

The missing core for real HookSwapPerps trading: accepts signed EIP-712 orders,
maintains a per-market in-memory orderbook, crosses longs vs shorts, and the
authorized matcher submits `settleBatch` on-chain. TypeScript + viem.

- **Live URL:** `https://perps.hookswap.org` (VPS `15.204.8.186`, systemd
  `hookswap-perps-engine.service`, nginx + Let's Encrypt TLS → `127.0.0.1:4100`).
- **Chain:** Sepolia (11155111). **Matcher:** `0x46B7fC4978D74c6Eda6b4573E5bE2C9675846adc`.
- **Markets:** read live from `MarketRegistry` `0xEDE278469694e951676973B7b9e193a98463DAC2`
  (`marketCount()` / `getMarkets(start,count)`) — factory-version-agnostic, never hardcoded.
- **v1 is in-memory (NOT HA):** the orderbook is lost on restart; on-chain
  `PairedPositions` are the source of truth for what actually settled.

## Settlement gating — `LIVE_SETTLE`

- `LIVE_SETTLE=false` (default): every match assembles `settleBatch([pair])`
  calldata and runs a viem `simulateContract` (dry run) — **no broadcast**. This
  proves order intake, signature/nonce/leverage validation, matching, and calldata
  assembly against the real deployed market. With the authorized matcher the
  simulate currently reverts `InsufficientBalance()` (`0xf4d678b8`) — the honest
  liquidity gate: everything upstream (EIP-712 recovery, sequential nonce, leverage
  cap, signed limit price, OracleGuard) passes; only trader deposits are missing.
- `LIVE_SETTLE=true`: the matcher simulates, then `writeContract` + waits for the
  receipt; a mined success emits a `fill`.

**One-liner to go live** (on the VPS):

```bash
sudo sed -i 's/^LIVE_SETTLE=.*/LIVE_SETTLE=true/' ~/hookswap-perps-engine/.env && sudo systemctl restart hookswap-perps-engine
```

(Flip back with `LIVE_SETTLE=false`.) The matcher key lives only in
`~/hookswap-perps-engine/.env` (mode 600), is read once at boot, and is never logged.

## API

Base path `/`. All numeric on-chain values are decimal **strings** (wei/1e18 or
`*1e4` leverage). CORS `*`.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ok, chainId, markets, matcher, liveSettle, marksConfigured}` |
| GET | `/markets` | `[{market, marketId, collateral, tier, status, maxLeverage}]` from the registry |
| GET | `/orderbook?market=<addr>` | `{market, bids:[{price,size,orders}], asks:[...]}` — bids (longs) desc, asks (shorts) asc |
| POST | `/orders` | body `{market, order, signature}` → validate + match. `{orderId, status:'open'\|'matched', txHash?, fills[]}` |
| DELETE | `/orders/:orderId` | cancel an unfilled resting order |
| GET | `/orders?market=<addr>&trader=<addr>` | open orders (trader optional) |
| GET | `/positions?market=<addr>&trader=<addr>` | on-chain `PairedPositions` (`getUserPairIds`+`getPairedPosition`) |
| GET | `/trades?market=<addr>&limit=N` | recent fills (in-memory, capped 500) |
| WS | `/stream?market=<addr>` | pushes `{type:'orderbook'\|'trade'\|'fill', ...}`; orderbook snapshot on connect |

### `POST /orders` body

> **The `market` address is required** in the body (top-level) — order signatures
> are per-market (EIP-712 `verifyingContract` = the market address), so the engine
> must know which market's domain to recover against. `?market=` query is also accepted.

```jsonc
{
  "market": "0xF5AaB45b6C6f83324be68B73159fc41c90Fb002A",
  "order": {
    "trader":   "0x…",          // = the EIP-712 signer
    "token":    "0x…",          // the market's underlying/price token
    "isLong":   true,
    "size":     "1000000000000000000",     // base units (1e18)
    "leverage": "50000",                    // leverage * 1e4  → 5x
    "price":    "2000000000000000000000",   // quote-per-base * 1e18
    "deadline": "1784498972",               // unix seconds (future)
    "nonce":    "0",                        // == on-chain nonces(trader) for this market
    "orderType": 1                          // 0 = MARKET, 1 = LIMIT
  },
  "signature": "0x…"            // EIP-712 over domain {name:"HookSwapPerps",version:"1",chainId,verifyingContract:market}, primaryType "Order"
}
```

Validation (rejects 400 on failure): EIP-712 signer recovers to `order.trader`;
`deadline` in the future; `size>0`; `leverage>0` and `<=` the market cap (and the
absolute `MAX_LEVERAGE`); LIMIT `price>0`; and a best-effort on-chain nonce match
(a mismatch guarantees a settle revert, so it is rejected).

### EIP-712 signing (client)

```ts
const domain = { name: "HookSwapPerps", version: "1", chainId: 11155111, verifyingContract: market };
const types = { Order: [
  { name:"trader",type:"address"},{name:"token",type:"address"},{name:"isLong",type:"bool"},
  { name:"size",type:"uint256"},{name:"leverage",type:"uint256"},{name:"price",type:"uint256"},
  { name:"deadline",type:"uint256"},{name:"nonce",type:"uint256"},{name:"orderType",type:"uint8"},
]};
const signature = await account.signTypedData({ domain, types, primaryType:"Order", message: order });
```

## Matching

- A long and a short cross when `effLong >= effShort`, where a MARKET order crosses
  anything (long→+∞, short→0) and a LIMIT order uses its signed `price`.
- `matchSize = min(remaining sizes)`. `matchPrice` = the **maker (resting)** limit
  price, else the taker's limit price, else the oracle mark — and is re-checked to
  respect both signed limits (LIMIT long fills `≤` its price, LIMIT short `≥` its
  price), matching the on-chain `settleBatch` enforcement.
- Mark price comes from the config-driven oracle registry (`perps-engine/oracle`)
  when a source is configured for the market (see **Oracle config** below);
  otherwise there is no mark and pricing falls back to maker/taker limit prices —
  never a fabricated number. The Sepolia test markets have no oracle pool wired, so
  matches use limit prices (correct + honest).

## Oracle config (optional)

Set `PERPS_ENGINE_MARKETS=/path/to/engine-markets.json` to give markets a mark
price. Entries are `MarketConfig` objects whose `market` field is the **on-chain
market address** (not a symbol), e.g.:

```jsonc
[{ "market":"0xF5AaB4…","assetClass":"crypto",
   "oracle":{"sourceType":"hookswap-v2","chainId":196,"poolAddress":"0x1a95…","quoteToken":"0xe538…"} }]
```

See `oracle/EXTENSIBILITY.md` for every `sourceType` (AMM v2/v3/v4, Chainlink,
Pyth, API, 0x-RFQ).

## Run

Requires Node ≥ 20 (VPS runs v22) — no bun needed; `tsx` runs the TypeScript directly.

```bash
cd perps-engine
npm install
# env (or a perps-engine/.env file, mode 600):
export SEPOLIA_RPC_URL=https://sepolia.drpc.org
export MARKET_REGISTRY=0xEDE278469694e951676973B7b9e193a98463DAC2
export MATCHER_PRIVATE_KEY=0x…      # authorized matcher; never logged
export LIVE_SETTLE=false
export PORT=4100
npm start                           # tsx src/index.ts
npm run typecheck                   # tsc --noEmit (clean)
BASE=http://localhost:4100 npx tsx scripts/smoke.ts   # end-to-end demo (signs + matches)
```

### Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PERPS_CHAIN_ID` | `11155111` | EIP-712 / RPC chain id |
| `SEPOLIA_RPC_URL` | `https://sepolia.drpc.org` | JSON-RPC endpoint |
| `MARKET_REGISTRY` | `0xEDE2…3DAC2` | MarketRegistry address (markets read dynamically) |
| `MATCHER_PRIVATE_KEY` | — | authorized matcher key (settle disabled if unset); never logged |
| `LIVE_SETTLE` | `false` | `true` = broadcast settleBatch; `false` = simulate only |
| `PORT` | `4100` | HTTP/WS listen port |
| `PERPS_ENGINE_MARKETS` | — | optional path to the oracle market map (mark price) |
| `PERPS_MARKET_REFRESH_MS` | `60000` | registry re-poll interval |

## Deploy (VPS) — what was done

1. `rsync` `perps-engine/` → `~/hookswap-perps-engine/` (excludes node_modules/.env).
2. `npm install` (node v22).
3. `.env` (mode 600) with `MATCHER_PRIVATE_KEY` sourced from `~/perps-deploy/.deploykey.json`.
4. systemd unit `/etc/systemd/system/hookswap-perps-engine.service`
   (`ExecStart=node_modules/.bin/tsx src/index.ts`, `EnvironmentFile=.env`,
   `Restart=on-failure`), enabled (survives reboot).
5. nginx `perps.hookswap.org.conf` → `127.0.0.1:4100` (+ WS upgrade), certbot TLS.

Redeploy after a code change: `rsync` the changed files, then
`sudo systemctl restart hookswap-perps-engine` (`tsx` runs TS directly — no build step).
Logs: `~/hookswap-perps-engine/engine.log` (or `journalctl -u hookswap-perps-engine`).

## Files

```
perps-engine/
  src/
    index.ts     bootstrap
    env.ts       env + .env loader; LIVE_SETTLE / matcher-key handling
    abis.ts      PerpMarket + MarketRegistry ABIs + EIP-712 Order types/domain
    types.ts     Order, MatchedPair, StoredOrder, Trade, MarketMeta
    chain.ts     viem public/wallet clients; registry + nonce/balance/position reads
    order.ts     order parse, EIP-712 signer recovery, sanity checks
    mark.ts      bridge to the oracle registry (mark price by market address)
    engine.ts    per-market orderbooks, crossing/matching, events
    settle.ts    settleBatch calldata assembly + simulate/broadcast (LIVE_SETTLE)
    server.ts    HTTP + WebSocket server (the API above)
  scripts/smoke.ts   end-to-end signer→match→simulate demo
  oracle/            pre-existing config-driven mark-price registry (reused)
  README-engine.md   this file
```
