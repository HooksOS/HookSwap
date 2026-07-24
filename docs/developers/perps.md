# Perpetuals (HookSwapPerps)

**HookSwapPerps** is HookSwap's perpetual-futures stack: **off-chain (P2P) EIP-712 order
matching + on-chain settlement**, isolated margin, ETH-denominated collateral. This page is the
integration reference — the model, the EIP-712 domain and `Order` struct, the deployed
addresses, the self-service market factory, and how to read positions and markets.

> **Status.** HookSwapPerps is **live + on-chain-tested on Sepolia** (the mandatory validation
> chain) and running as a **core pilot on Robinhood Chain** (chainId 4663, owner = deployer,
> 1-of-1). It is **not externally audited**, and the matching engine is **operator-run** (a
> HookSwap-authorized relayer submits matches — it is not permissionless). Build against it as
> pilot software. Do not assume mainnet-grade guarantees.

## Model

There are two on-chain shapes of the same trading/settlement logic:

- **Core P2P (`Settlement`)** — a single operator-run market. Traders deposit collateral, sign
  EIP-712 orders off-chain, an authorized matcher pairs opposite orders and calls `settleBatch`
  to open positions on-chain. This is the model deployed on Robinhood (the pilot) and as the
  base Sepolia deployment.
- **Self-service factory (`PerpMarketFactory` → `PerpMarket`)** — a permissionless factory that
  clones an initializable `PerpMarket` (EIP-1167 minimal proxy) per market. `PerpMarket` is
  **byte-identical trading logic** to `Settlement`; the only differences are the clone
  initialization pattern and the wired safety layer (oracle guard, per-market insurance, bond).

Both share:

- **Isolated margin, ETH-denominated.** All amounts use 1e18 precision (`STANDARD_DECIMALS = 18`).
  Collateral is registered per market via `addSupportedToken`; WETH is the canonical collateral
  and `depositETH()` auto-wraps native ETH.
- **Paired positions.** A settled match creates a `PairedPosition` (one long trader + one short
  trader, same token, same size, one entry price). PnL is zero-sum between the two sides.
- **Constants:** `MAX_LEVERAGE = 100×`, `MAINTENANCE_MARGIN_RATE = 50` (⇒ maintenance margin =
  `size × 50 / 10_000` = 0.5% of size), default `feeRate = 10` (0.10% per side),
  `FIXED_FUNDING_RATE = 0.01%` per `FUNDING_INTERVAL = 5 minutes` (charged to both sides →
  insurance), liquidation penalty `5%` of collateral (split 50/50 liquidator/insurance).

### Request flow

```
Trader (browser wallet)
   │  sign EIP-712 Order  (domain "HookSwapPerps" v1)  — gasless
   ▼
HookSwapPerps matching engine  (operator-run relayer)
   │  pairs opposite orders → MatchedPair[]
   │  calls settleBatch(...)  as an authorized matcher
   ▼
Settlement / PerpMarket (on-chain)
   locks margin · opens PairedPosition · accrues funding · settles PnL on close/liquidate
```

- The interface **signs orders**; it does not call `settleBatch` itself — only an
  **authorized matcher** may (`authorizedMatchers[msg.sender]`).
- Prices consumed for value are checked by the **OracleGuard** circuit breaker before settling.

## EIP-712 domain + `Order` struct (the hard sync point)

The EIP-712 domain is **`("HookSwapPerps", "1")`**. This is a **hard sync point**: it must match
byte-for-byte across the contracts (`Settlement.sol`, `PerpMarket.sol`), the off-chain matching
engine, and the frontend order-signing util, or **every signature fails to recover**. (It was
rebranded from the upstream `MemePerp` — do not reintroduce the old name anywhere.)

```
Domain:  { name: "HookSwapPerps", version: "1", chainId, verifyingContract }
```

`verifyingContract` is the market address itself. For factory clones this is the **clone**
address — each clone is its own EIP-712 verifying contract (the domain separator recomputes per
clone), so an order signed for one market is not valid on another.

The `Order` struct and its type hash:

```solidity
struct Order {
    address trader;
    address token;      // the market's traded asset
    bool    isLong;     // true = long (green), false = short (red)
    uint256 size;       // position size, 1e18
    uint256 leverage;   // LEVERAGE_PRECISION = 1e4  (e.g. 10× = 100000)
    uint256 price;      // signed limit price (enforced for LIMIT orders)
    uint256 deadline;   // unix seconds; order expires after
    uint256 nonce;      // must equal nonces[trader]
    uint8   orderType;  // 0 = MARKET, 1 = LIMIT
}

// keccak256("Order(address trader,address token,bool isLong,uint256 size,uint256 leverage,
//   uint256 price,uint256 deadline,uint256 nonce,uint8 orderType)")
```

Validation on settle (`_validateOrder` / `_settlePair`):

- signature recovers to `order.trader`; `order.nonce == nonces[trader]`; not past `deadline`.
- `0 < leverage <= MAX_LEVERAGE` **and** `<= marketMaxLeverage` (the per-market cap; 0 = unset →
  MAX_LEVERAGE). Exceeding the cap reverts `LeverageTooHigh`.
- self-matching is forbidden (`long.trader != short.trader`); both orders must be the same token.
- **LIMIT price enforcement:** a LIMIT long fills only if `matchPrice <= order.price`; a LIMIT
  short only if `matchPrice >= order.price` (else `LimitPriceViolated`). MARKET orders are
  bounded by the oracle deviation band instead.

The matcher submits `MatchedPair[]` (long order + sig, short order + sig, `matchPrice`,
`matchSize`) to `settleBatch`.

## Oracle / price model

Price is an **off-chain scalar mark** the matching engine maintains and pushes on-chain via
`updatePrice(token, price)` (matcher-only). Because price is off-chain, new markets and new
price venues (AMM TWAP, Chainlink/Pyth, RFQ, RWA/stock feeds) can be added by **config +
admin calls**, with no `Settlement`/`PerpMarket` redeploy.

The **OracleGuard** is the on-chain circuit breaker. `_guardPrice(price)` is called on every
value-moving price (entry in `_settlePair`, exit in `_closePair`, liquidation mark, and at
`updatePrice` write time):

- If the market has a **reference feed** (`marketConfig.refFeed != 0`), `checkDeviation(market,
  price)` reverts when the proposed price is **stale** vs, or **deviates too far** from, the feed
  (`PriceDeviationTooLarge` / stale revert).
- If the market has **no reference feed** (curated tier), the guard is a no-op — price is
  matcher-trusted, preserving the original behavior.
- `refPrice(market)` returns the fresh, normalized (1e18) reference price. `closePair` (the
  user-callable path) settles at this fresh reference price when a feed exists, so a stale or
  down matcher can't trap a user; `forceSettle` (owner) is the escape hatch when the mark has
  gone stale beyond `PRICE_STALE_GRACE` (1 hour).

## Self-service market factory

`PerpMarketFactory.createMarket(...)` deploys an isolated `PerpMarket` clone, wires the shared
platform contracts, and hands ownership to the platform admin. The **creator only earns fees**;
the platform keeps operational control (matcher, pause, params) — fee capture is
non-bypassable because each clone's `feeReceiver` is set to the `FeeRouter` before ownership is
transferred out.

```solidity
function createMarket(
    address collateral,   // e.g. WETH
    uint8   decimals,     // 0 = auto-detect
    address creator,      // fee beneficiary
    uint256 feeRate,      // per-side; clamped to [2, 15] bps
    uint256 maxLeverage,  // value * 1e4; clamped to PLATFORM_MAX_LEVERAGE (20×)
    bytes32 marketId,     // keccak256(utf8Bytes(label)), e.g. "BTC-PERP"
    uint8   tier,         // 0 = CURATED, 1 = PERMISSIONLESS
    OracleGuard.OracleConfig calldata oracleCfg
) external payable returns (address market);   // market = MarketCreated event topic
```

- `msg.value` must cover **`listingFee` + `minBond(tier)`**. The listing fee is forwarded to the
  **treasury**; the remainder is escrowed as the **creation bond** in the **BondManager**.
- `oracleCfg` = `{ bytes32 sourceType, address venue, address refFeed, uint256 maxDeviationBps,
  uint256 maxStaleness, uint256 minLiquidity, bool dualSourceRequired }`. The venue must be
  **allowlisted** in OracleGuard for its `sourceType` or the call reverts. Permissionless markets
  are forced dual-source + reference feed.
- The freshly deployed market address is emitted in `MarketCreated(market, creator, collateral,
  marketId, tier, feeRate, maxLeverage)` — decode it from the log, never fabricate it.

Supporting contracts:

| Contract | Role |
|---|---|
| `PerpMarketFactory` | Permissionless factory; clones `PerpMarket`, wires guards, escrows bond |
| `PerpMarket` (implementation) | Clone target — the initializable settlement/trading logic |
| `FeeRouter` | Splits each trade's per-side fee: **platform 50% (floor 40%) / creator 40% / insurance 10%** |
| `MarketRegistry` | On-chain market directory (`marketCount`, `getMarkets(start, count)`) |
| `OracleGuard` | Venue allowlist + deviation/staleness circuit breaker; per-market oracle config |
| `ParamGuard` | Governance bounds — `clampFee` (2–15 bps), `clampLeverage` |
| `BondManager` | Tier-aware, slashable creation-bond escrow; 7-day withdraw delay |
| `InsuranceHub` | Per-market insurance sub-accounts (`balanceOf[market][token]`) |

**Bond bounds (Sepolia):** `curatedMinBond = 5e13`, `permissionlessMinBond = 1e14`,
`withdrawDelay = 604800s` (7 days). **Fee split:** platform 5000 bps (floor 4000), creator 4000,
insurance 1000. **Fee bounds:** 2–15 bps. **Platform max leverage:** 20×.

## Reading positions and markets

`Settlement` / `PerpMarket` view functions (both models expose these):

```solidity
getUserBalance(address user) returns (uint256 available, uint256 locked)
getPairedPosition(uint256 pairId) returns (PairedPosition)
getUserPairIds(address user) returns (uint256[])
getUnrealizedPnL(uint256 pairId) returns (int256 longPnL, int256 shortPnL)
canLiquidate(uint256 pairId) returns (bool liquidateLong, bool liquidateShort)
getOrderHash(Order) returns (bytes32)          // EIP-712 digest for the order
getRemainingAmount(Order) returns (uint256)    // size - filled
getSupportedTokens() returns (address[])
```

Market directory (factory model, `MarketRegistry`):

```solidity
marketCount() returns (uint256)
getMarkets(uint256 start, uint256 count) returns (MarketInfo[])
// MarketInfo = { address market, address creator, address collateral,
//   bytes32 marketId, uint8 tier, uint8 status, uint256 createdAt }
```

The frontend wiring lives in `apps/web/src/terminal/perps/` (order signing, place-order,
market views) and `apps/web/src/terminal/perps/factory/` (`abis.ts`, `useCreateMarket.ts`,
`useMarkets.ts`); the launch wizard is `screens/CreatePerpMarketScreen.tsx`.

## Deployed addresses

All addresses below are copied verbatim from `contracts/perps/config/*.json`.

### Sepolia — self-service factory suite (chainId 11155111)

The canonical factory address is **`0xa1A8C5A2D5527abfD2E46F4FaCebC6BC00C1a79a`** (its
implementation and bond manager were repointed to the latest versions listed here).

| Contract | Address |
|---|---|
| PerpMarketFactory (canonical) | `0xa1A8C5A2D5527abfD2E46F4FaCebC6BC00C1a79a` |
| PerpMarket implementation | `0x190694b5712C4Fc4D1eeC0d8E78AbFb8c089EB9b` |
| FeeRouter | `0xfA91D73B30b719491109Ae1C3993620c813393A4` |
| MarketRegistry | `0xEDE278469694e951676973B7b9e193a98463DAC2` |
| OracleGuard | `0x3D2ee857AE129688fA43E378dAE85b60803bfFD1` |
| ParamGuard | `0xA9bA33018a1238bf3A59f5cF6f25e7538B9A2d33` |
| BondManager | `0xB3076bd496A3161F6D0596380f35E5ae0ef0A54E` |
| InsuranceHub | `0xEAA01a0b3f31aBde9e72A779F9A79E12072e6048` |
| WETH9 (collateral) | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| Chainlink ETH/USD ref feed | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |

> The frontend (`abis.ts`) is wired to the factory `0xa1A8C5A2…` + registry `0xEDE27846…` on
> Sepolia only; on any other chain the launch wizard renders an honest "not deployed — switch to
> Sepolia" state.

### Sepolia — core P2P (`Settlement`, chainId 11155111)

| Contract | Address |
|---|---|
| Settlement | `0xc07acb918a8f862382bcaac452a12bac34610696` |
| SessionKeyManager | `0xa66f4b4ed776a6b20715dafe952b50b4a16f429f` |
| ContractRegistry | `0x093f085a3ded3ae33e3c9fc32f18dbb011237b0b` |
| InsuranceFund | `0x88415a9e5378fe7fe2e6f5802f67b3f0f3cd3f97` |

### Robinhood Chain — core P2P pilot (chainId 4663)

Live pilot — core P2P (`Settlement`), owner = deployer (1-of-1), no external audit. EIP-712
domain `("HookSwapPerps", "1")`.

| Contract | Address |
|---|---|
| Settlement | `0x7A1f95c9702F78751F305426DeA9F328ed0128FA` |
| ContractRegistry | `0xd032e4d0d44e1e100933d68d9a2723c6669a0693` |
| InsuranceFund | `0xf486e625c892c0739a16a3a49b37fd52374b30cb` |
| SessionKeyManager | `0xa1aa9d69f59b20c0ef2936933d677680d6277351` |
| Collateral (WETH) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Matcher | `0x46B7fC4978D74c6Eda6b4573E5bE2C9675846adc` |
| Fee receiver | `0x011d438E3eb3fce848950859591ec037C6529E13` |

`feeRate = 10` (0.10% per side). Robinhood WETH matches the DEX stack's
[contract addresses](./contract-addresses.md).

## See also

- [Perpetuals — user guide](../users/perps.md)
- [Contract addresses](./contract-addresses.md) · [Deployed contracts](./deployed-contracts.md)
