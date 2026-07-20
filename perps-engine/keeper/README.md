# HookSwapPerps Keeper

Off-chain services that keep every HookSwapPerps market self-sustaining:

- **Liquidation keeper** — every ~25s, scans each market's ACTIVE positions and
  `liquidate(pairId)`s any side that is underwater (`canLiquidate`). Liquidation is
  **permissionless** and pays the keeper a reward.
- **Funding keeper** — every ~60s, `settleFundingBatch([...])`s ACTIVE positions
  whose `lastFundingSettled` is older than `FUNDING_INTERVAL` (5 min), so funding
  accrual stays current between trades.

Lives in its own module (`keeper/`), decoupled from the engine `src/*` tree. Runs
as `hookswap-perps-keeper.service` (systemd), sharing the engine's `node_modules`.

## Auth model (verified against `contracts/perps/src/factory/PerpMarket.sol`)

| call | gate | keeper needs |
|---|---|---|
| `liquidate(pairId)` | **permissionless** (reward to caller) | nothing (any funded wallet) |
| `settleFundingBatch(pairIds)` | `onlyAuthorizedMatcher` | keeper authorized as matcher |
| `updatePrice(token, price)` | `onlyAuthorizedMatcher` | keeper authorized as matcher |

The keeper uses a **dedicated key** (separate from the engine matcher / bot so nonces
never collide). Authorize it **once** from the market owner:

```
cast send <MARKET> "setAuthorizedMatcher(address,bool)" <KEEPER> true \
  --private-key <OWNER_KEY> --rpc-url <RPC> --legacy --gas-price 2000000000
```

Liquidation works without authorization; only funding + mark-refresh need it.

## Mark handling

Both the liquidation decision (`canLiquidate`) and `liquidate()` read the on-chain
stored mark `tokenPrices[token]`, which the H-1 OracleGuard validates against the
market's Chainlink reference (±`maxDeviationBps`). The keeper therefore ensures a
valid, in-band mark exists: it pushes a fresh Chainlink-derived mark (`answer * 1e10`,
identical to the OracleGuard reference → 0 deviation) via `updatePrice` **only** when
the stored mark is 0 or has drifted beyond `KEEPER_MARK_REFRESH_BPS` (kept inside the
band). It never fabricates a price — a stale/failed feed is logged and skipped.

## Run

```
cp keeper/.env.example keeper/.env   # fill KEEPER_PRIVATE_KEY, chmod 600
node_modules/.bin/tsx keeper/keeperMain.ts
# or: systemctl enable --now hookswap-perps-keeper.service
```

## Files

- `keeperMain.ts` — entrypoint; runs both loops + market refresh.
- `liquidationKeeper.ts` — mark-ensure + `canLiquidate` scan + `liquidate`.
- `fundingKeeper.ts` — due-position scan + `settleFundingBatch` batches.
- `keeperMarkets.ts` — registry enumeration, refFeed resolution, mark, position scan.
- `keeperChain.ts` — config, viem clients, serialized nonce-safe sender, RPC retry.
- `keeperAbi.ts` — self-contained minimal ABIs (source of truth: the contracts).
- `scripts/forceLiquidation.ts` — one-off proof helper: opens a high-lev pair and
  pushes an in-band adverse mark so the keeper can prove `liquidate()` on Sepolia.
- `hookswap-perps-keeper.service` — systemd unit.

## Liquidation proof on Sepolia

The live market caps leverage at 10x; inside the 5% OracleGuard band a 10x position
can't be pushed underwater (needs ~9.5% move). To prove a **real** liquidation,
temporarily raise the cap, open a 100x pair, push an in-band adverse mark, let the
keeper liquidate, then restore:

```
# 1. raise cap (owner)
cast send <MARKET> "setMarketMaxLeverage(uint256)" 1000000 --private-key <OWNER> --rpc-url <RPC> --legacy --gas-price 2000000000
# 2. open a liquidatable 100x pair + push in-band adverse mark
MARKET=<MARKET> COLLATERAL=<WETH> DEPLOYER_KEY_FILE=... T1_KEY_FILE=... T2_KEY_FILE=... \
  node_modules/.bin/tsx keeper/scripts/forceLiquidation.ts
# 3. keeper service liquidates within ~25s (permissionless)
# 4. restore
cast send <MARKET> "setMarketMaxLeverage(uint256)" 100000 --private-key <OWNER> --rpc-url <RPC> --legacy --gas-price 2000000000
cast send <MARKET> "updatePrice(address,uint256)" <WETH> <REAL_MARK> --private-key <OWNER> --rpc-url <RPC> --legacy --gas-price 2000000000
```
