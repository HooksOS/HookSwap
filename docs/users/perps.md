# Perpetuals

## What is HookSwapPerps?

**HookSwapPerps** is HookSwap's perpetual-futures venue — trade leveraged **long** or
**short** positions on an asset without an expiry date. It is a **peer-to-peer (P2P)**
design: your order is matched against another trader's opposite order off-chain, and the
resulting position is **settled on-chain**. HookSwap never takes the other side of your
trade — every position is one trader against another.

- **Isolated margin.** Each position has its own collateral. A loss can never exceed the
  collateral you locked into that position, and one position's losses can never touch
  another position or another market.
- **ETH-denominated.** Collateral, size, and PnL are all quoted in ETH (WETH, 18 decimals).
  You deposit WETH (or ETH, which is auto-wrapped) as margin.
- **Long is green, short is red** throughout the interface — the standard convention. Funding
  values render in gold.

> **Status — read this first.** HookSwapPerps is **live on Sepolia testnet** (fully deployed
> and on-chain smoke-tested) and running as a **core pilot on Robinhood Chain** (owner is the
> deployer, 1-of-1). It has **not been through an external audit**, and the matching engine is
> **operator-run** (a HookSwap-authorized relayer matches orders — it is not permissionless).
> Treat it as pilot software. Do not commit funds you can't afford to lose.

## How it works

1. **Deposit collateral.** Send WETH (or ETH, auto-wrapped to WETH) into the market. Your
   deposit becomes your **available balance** — spendable margin that isn't locked in a
   position yet.
2. **Open a position.** Choose a market, pick **Long** or **Short**, enter a size and a
   leverage, and submit. You sign the order in your wallet (an EIP-712 signature — a gasless
   message, not a transaction). The order goes to the matching engine.
3. **Get matched.** When an opposite order exists at a compatible price, the engine pairs the
   two and the settlement contract locks each side's margin on-chain. Your position is now
   **active**. The collateral required is `size ÷ leverage` per side.
4. **Funding accrues** while the position is open (see below).
5. **Close** the position any time to realize your PnL, **or** get **liquidated** if it moves
   too far against you.

## Leverage and margin

- **Leverage** multiplies your exposure: at 10× leverage, a position of size 10 ETH locks
  only 1 ETH of collateral. Higher leverage means a smaller price move wipes out your margin.
- **Maximum leverage** is capped per market. The absolute protocol ceiling is **100×**, but
  each market sets its own on-chain cap (the self-service factory clamps new markets to
  **20×**). The order ticket shows the live cap for the market you're trading.
- **Maintenance margin** is the minimum equity a position must keep to stay open — **0.5% of
  position size**. If your collateral plus unrealized PnL (minus funding owed) falls below
  this floor, the position becomes **liquidatable**.

## Funding

Perpetuals use **funding** to keep the perp price tethered to the underlying. HookSwapPerps
charges a **fixed funding rate of 0.01% of position size every 5 minutes**, deducted from
**both** the long and the short, and paid into the market's **insurance fund**. Funding is
settled when your position is closed or liquidated (and can be batch-settled by the operator
in between). The longer a position stays open, the more funding it pays.

## Liquidation

If a position falls below its maintenance margin, anyone can **liquidate** it:

- A **5% liquidation penalty** is taken from the liquidated side's collateral.
- Half the penalty rewards the liquidator (the incentive to keep the book solvent); the other
  half goes to the market's **insurance fund**.
- Settlement is **zero-sum and capped**: the winning side is paid out of the losing side's
  collateral, but **never more than the counterparty put up**. Because margin is isolated, the
  protocol never tops up a winner from insurance or from other traders' funds.

> **Isolated-margin guarantee.** The most you can lose on a position is the collateral you
> locked into it. The most you can win is capped at the counterparty's collateral. This is by
> design — it's what keeps each market self-contained.

## The oracle price guard

To stop a faulty or hostile price from settling your trade unfairly, value-moving prices
(entry, exit, liquidation mark) are checked against an **oracle price guard** before they
settle. If the matcher-supplied price is **stale** or **deviates too far** from the market's
reference feed (e.g. a Chainlink feed), settlement **reverts** rather than filling at a bad
price. Markets can also be configured **without** a reference feed (a curated market), in
which case the price is matcher-trusted — the interface shows which model a market uses.

For a **LIMIT** order, the guard also enforces your signed price: a limit long only fills at
or below your price, a limit short only at or above. A **MARKET** order fills at the current
mark, protected by the deviation band.

## Trading in the interface

Open **Perps** from the terminal (`/perps`) for the "Pro Desk" layout — watchlist, chart,
order book, and an order ticket with a **Long / Short** toggle, a **Market / Limit** segment,
a size field, and a leverage slider. Every price, mark, funding, and position value is bound
to a live source; until the live feed for a market exists, those surfaces render an honest
`—` rather than a fabricated number.

## Launch your own perp market

HookSwapPerps is **self-service** — anyone can list a new isolated perp market in a single
transaction from **Perps → Launch perp** (`/perps/launch`). Each launch deploys an isolated
market (a minimal-proxy clone of the audited-pattern market contract) and registers it.

What you set:

- **Market label** (e.g. `BTC-PERP`), **collateral token** (WETH by default), and the
  **fee beneficiary** (you — the creator earns a share of every trade's fee).
- **Per-side fee rate**, clamped on-chain to **2–15 bps**.
- **Max leverage**, clamped to the platform cap (**20×**).
- **Tier** — *curated* or *permissionless* (permissionless markets are forced to carry a
  dual-source reference feed).
- **Oracle config** — the reference price feed and deviation/staleness bounds. The venue must
  be allowlisted or the launch reverts. On Sepolia the default is the Chainlink ETH/USD feed.

What it costs:

- A **listing fee** (read live from the contract; may be zero) that goes to the treasury.
- A **creation bond** in native ETH, escrowed and **slashable** if the market misbehaves.
  The bond is **tier-aware** (permissionless requires a larger bond than curated) and is
  **refundable after a 7-day delay** if it isn't slashed.

The interface reads the listing fee and bond on-chain, **simulates** the launch before you
sign (so an un-allowlisted oracle or an underfunded fee shows up as a clear error, not a
wasted transaction), and decodes the new market's address from the on-chain event — never a
guessed value.

> **Creator vs. operator.** As a market creator you **earn fees**, but the platform keeps
> operational control (the matcher, pause, and parameter bounds). This is deliberate: it keeps
> fee capture non-bypassable and lets the platform protect traders.

## Where it's deployed

| Chain | chainId | Model | Status |
|---|---|---|---|
| Sepolia (testnet) | 11155111 | Self-service factory + core P2P | Deployed + on-chain tested |
| Robinhood Chain | 4663 | Core P2P (Settlement) | Live pilot (owner = deployer, unaudited) |

Contract addresses and the integration model are in the developer guide,
[Perpetuals (developers)](../developers/perps.md).

## Next steps

- [Perpetuals — developer & integration guide](../developers/perps.md)
- [Getting started](./getting-started.md) · [Supported chains](./chains.md)
