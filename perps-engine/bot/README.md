# HookSwapPerps counterparty bot

A standing market-maker bot for one HookSwapPerps market on Sepolia. It rests a
**bid + ask** around the live Chainlink ETH/USD mark and refreshes them on an
interval. A solo user trading from the UI crosses one side → the matching engine
settles the pair on-chain (real `PairedPosition`). No mock prices: the mark is the
live Chainlink feed and quotes stay inside the OracleGuard H-1 band (±5%).

## How it works
- Reads `latestRoundData()` from Chainlink ETH/USD → `mark1e18 = answer * 1e10`.
- Posts, each loop: a **BID** (isLong=true) at `mark * (1 + spreadBps)` and an
  **ASK** (isLong=false) at `mark * (1 - spreadBps)`, both LIMIT, size `BOT_SIZE`,
  leverage `BOT_LEVERAGE_X`.
- Signs EIP-712 over domain `{name:"HookSwapPerps", version:"1", chainId:11155111,
  verifyingContract: MARKET}` (reuses `../src/abis.ts`), nonce = `market.nonces(bot)`.
- Cancels its prior orders and reposts every loop so prices/nonces stay fresh.
- Collateral: `depositETH()` on boot (`BOT_DEPOSIT_ETH`), tops up once if the
  available balance drops below `BOT_MIN_AVAILABLE`.
- Both quotes share the current on-chain nonce (the contract's nonce advances only
  on a settled fill), so one user order fills one side; the next loop reposts at
  nonce+1. This is exactly the intended solo-fill demo.

## Why the user's order crosses
The frontend (`usePlaceOrder.ts`) signs orders with `token = market collateral`,
LIMIT/MARKET, `leverage = x*1e4`, `price = usd*1e18` — identical schema. A user
MARKET (or marketable-LIMIT) order is the taker; the bot's resting LIMIT is the
maker, so `matchPrice = the bot's price` (inside the guard band). Settlement checks
pass (`longOrder.token == shortOrder.token`, H-1 band, H-2 signed-limit).

## Run (systemd, on the VPS)
```
# bot/.env holds BOT_PRIVATE_KEY (mode 600) — never committed.
sudo cp bot/hookswap-perps-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hookswap-perps-bot
journalctl -u hookswap-perps-bot -f   # or tail bot/bot.log
```

## Verify
```
curl -s "https://perps.hookswap.org/orderbook?market=$MARKET"   # bids + asks resting
curl -s "https://perps.hookswap.org/orders?market=$MARKET&trader=$BOT_ADDR"
```

Requires the engine to have `LIVE_SETTLE=true` and a configured mark/oracle for the
market for real on-chain settlement.
