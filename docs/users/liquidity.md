# Providing liquidity

HookSwap supports two pool types. As a liquidity provider (LP) you earn the pool's trading
fees on your share of the pool.

## v2 vs v3 — which to use

| | v2 (constant product) | v3 (concentrated liquidity) |
|---|---|---|
| Model | Both sides deposited at the current ratio | Liquidity placed in a chosen **price range** |
| Fee | Flat **0.30%** | Choose a **fee tier**: 0.01% / 0.05% / 0.30% / 1.00% |
| Simplicity | Simplest — deposit and forget | More complex — you pick a range and may need to rebalance |
| Capital efficiency | Lower (spread across all prices) | Higher (concentrated where trading happens) |
| Best for | "Throw both sides in" and passive LPing | LPs who want efficiency and can manage a range |

## Adding v2 liquidity

1. Choose the token pair. On a **new** pair, the ratio you deposit **defines the opening
   price** — deposit both sides at your intended price.
2. Approve the router to spend your tokens.
3. Add liquidity. You receive LP tokens representing your share; fees accrue into the pool
   and are realized when you withdraw.

Keep both sides roughly equal in value at the intended price.

## Adding v3 liquidity

v3 pools are per **(token0, token1, fee tier)**. Instead of covering all prices, you place
liquidity between two prices (a **range**):

1. **Pick the pair and fee tier.** Each fee tier has a matching tick spacing:

   | Fee tier | Tick spacing |
   |---|---|
   | 0.01% | 1 |
   | 0.05% | 10 |
   | 0.30% | 60 |
   | 1.00% | 200 |

2. **Set a price range** (min/max). Your capital only earns fees while the market price is
   inside your range:
   - A **wide/full range** behaves like v2 (fees on all trades, lower efficiency).
   - A **concentrated range** around the current price earns much deeper fees per dollar,
     but stops earning if price leaves the band (and becomes single-sided).
3. **Deposit** both tokens (amounts depend on where the current price sits in your range) and
   confirm. You receive an NFT position representing your liquidity.

> **Out of range:** if price moves outside your v3 range, your position converts fully to one
> side and stops earning fees until price returns or you rebalance.

## Live pools today

Real, on-chain liquidity now exists on **6 of the 7** production chains. Each is a **v2** pair of
the chain's wrapped-native against a **real stablecoin** (no mock/test tokens). These are **small
proof / "dust" pools (~$10–30 of value each)** — enough to prove routing end-to-end
(`getAmountsOut` returns a real quote), **not** deep liquidity. Expect meaningful price impact on
anything but tiny trades until they are seeded further.

| Chain | Pair (v2) | Pair address |
|---|---|---|
| Robinhood (4663) | WETH / USDG (anchor pool) | `0xF7ddC3837eAF447689a365f5f6f6B7C2AcdB72D7` |
| Stable (988) | WgUSDT / USDT0 | `0x7F9023729F92ecb5aCbe9A4d9F9463fCDf5b2B9f` |
| Ink (57073) | WETH / USD₮0 | `0xB738BBaC16121D11B1F59AbC619A359413503d12` |
| MegaETH (4326) | WETH / USDm | `0xAD12931B2ff618C4aFEA9d9BCB7508Ccb51fF674` |
| HyperEVM (999) | WHYPE / USDC | `0x8628AfE800ca8C26F1d4Dc41e2B02C85e0B19Fc3` |
| X Layer (196) | STT / WOKB (existing seed) | — |
| Tempo (4217) | none yet | — |

Source of truth: `contracts/deployments/pools-seeded.json`.

**Tempo has no pool.** Its account-abstraction-native system tokens (`pathUSD` / `USDC.e`) revert
on standard `approve()` / `transfer()`, so a standard v2 pair cannot be formed yet — Tempo needs
its AA-native token flow before it can be seeded.

## Notes per chain

- **Tempo** has no native-gas wrapper — you cannot add liquidity with native gas
  (`addLiquidityETH`). Pair tokens against `pathUSD` or another ERC-20 quote asset instead. (Its
  AA-native tokens also block standard router-approve pairing — see "Live pools today" above.)
- New pools may be thin. Small pools give volatile prices and shallow quotes — check price
  impact before large trades, and prefer deeper pools where available.
