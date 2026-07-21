# Token & LP Locker

The HookSwap Locker lets you **lock** tokens so no one — not even you — can move them until a
chosen unlock time. It's how a project proves its team tokens or liquidity are committed.

You can lock:

- **ERC-20 tokens** — any standard token (team allocations, treasury, etc.).
- **v2 LP tokens** — your Uniswap-v2-style liquidity-pool tokens.
- **v3 position NFTs** — a concentrated-liquidity position. A locked v3 position **keeps earning
  trading fees** while the principal stays locked; you can still collect the fees.

Lockers are live on **all supported HookSwap chains**. Each lock charges a small fixed **0.04
native** fee (ETH / HYPE / OKB depending on chain). On a chain where lockers aren't deployed, the
Locker page shows an honest "not deployed yet" state — never fake data.

## Locking (the pre-flight simulation gate)

Open **Locker** in the app, pick what to lock (token / LP / v3 position), enter the amount and
unlock time, and approve the token if prompted.

Before the **Lock** button turns on, HookSwap runs a **pre-flight simulation** — it asks the
chain whether the exact lock transaction *would succeed*. The button only enables when the
simulated on-chain lock truly passes. This catches non-standard tokens (fee-on-transfer, paused,
blacklisting, etc.) that look fine on the surface but would revert — so **you never waste gas or
the lock fee on a doomed transaction**. If the simulation fails, the app shows a short, honest
reason instead of letting you send a failing tx.

## Ledger — locker analytics

The Locker page opens with **Ledger**, a live analytics view of everything locked across HookSwap:

- **Total value locked** headline with a TVL-over-time chart.
- **Stat tiles** — total locked, locks created, new locks (24h), reachable chains.
- **Tokens** and **Pools** rows — each locked token / LP pool with its chain, locked-percentage,
  and value.

Every number is a **real on-chain read** from the [locker indexer](../developers/analytics-indexer.md).
**USD values only appear where a stablecoin price anchor exists** (Robinhood today); everywhere
else you'll see the honest native amount and a `—` for USD — never a fabricated dollar figure. If
a chain's RPC is temporarily unreachable, its last-known data is shown and flagged stale.

## Shareable proof-of-lock pages

Every lock has a **public, no-wallet page** at:

```
https://hookswap.org/lock/<chainId>/<id>
```

Anyone can open it to verify a lock — token, amount, owner, lock and unlock dates, and (where
priceable) value. It needs **no connected wallet**, so it's the link a project shares as community
proof that its tokens or liquidity are locked. Use the copy-link action on a lock to grab its URL.

> Heads-up: the link preview (social unfurl) is generic today — per-lock preview images are a
> known follow-up. The page itself and the copy-link work for everyone.

## Related

- [Liquidity](./liquidity.md) — creating the LP you might lock.
- [Developers · Analytics & Indexer API](../developers/analytics-indexer.md) — the data behind Ledger.
- Follow HookSwap on X for lock announcements: [@Hook_Swap](https://x.com/Hook_Swap).
