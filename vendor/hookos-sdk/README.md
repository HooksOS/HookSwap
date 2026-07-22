# @hookos/sdk

TypeScript SDK for the **HookOS Protocol** — a programmable market engine live across five chains: Base, MegaETH, HyperEVM, BNB Chain, and Ethereum.

HookOS combines token launches with custom AMM hooks (MEV shields, burns, PvP wagers, AI-tuned fees), a bonding curve DEX, a PvP arena, and a hook marketplace.

## Installation

```bash
npm install @hookos/sdk viem
```

`viem` is a peer dependency (>= 2.0.0).

## Quick Start

### Read-only (no wallet needed)

```ts
import { HookOS } from "@hookos/sdk";

const hookos = new HookOS();

// Get all tokens
const tokens = await hookos.tokens.list();
console.log(`${tokens.length} tokens launched`);

// Get bonding curve price
const price = await hookos.trading.getPrice("0x...");
console.log(`Price: ${price} wei per token`);

// Get buy quote
const quote = await hookos.trading.getBuyQuote("0x...", 100000000000000000n); // 0.1 ETH
console.log(`You would receive: ${quote} tokens`);

// Browse hooks
const hooks = await hookos.hooks.browse({ active: true });
console.log(`${hooks.length} active hooks`);

// Get fee distribution info
const shares = await hookos.fees.getShares();
shares.forEach((s) => console.log(`${s.label}: ${s.shareBps} bps`));
```

### With wallet (for write operations)

```ts
import { HookOS } from "@hookos/sdk";
import { createWalletClient, custom, parseEther } from "viem";
import { base } from "viem/chains";

const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum!),
});

const hookos = new HookOS({ walletClient });

// Create a token
const { tokenAddress, txResult } = await hookos.tokens.create({
  name: "My Token",
  symbol: "MTK",
  initialSupply: 1_000_000_000n * 10n ** 18n,
  metadataURI: "ipfs://...",
});
console.log(`Token deployed at ${tokenAddress}`);

// Buy tokens on bonding curve
const buyTx = await hookos.trading.buy(tokenAddress, parseEther("0.1"));
console.log(`Buy tx: ${buyTx.hash}`);

// Place a wager in the arena
import { Side } from "@hookos/sdk";
const wagerTx = await hookos.arena.wager({
  battleId: 0,
  side: Side.TeamA,
  value: parseEther("0.01"),
});
```

### Custom RPC / chain

```ts
import { HookOS } from "@hookos/sdk";

// Use custom RPC
const hookos = new HookOS({
  rpcUrl: "https://your-rpc.example.com",
});

// Use another chain (4326 MegaETH, 999 HyperEVM, 56 BNB Chain, 1 Ethereum)
const hyperHookos = new HookOS({
  chainId: 999,
});
```

### Bring your own PublicClient

```ts
import { HookOS } from "@hookos/sdk";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://your-rpc.example.com"),
});

const hookos = new HookOS({ publicClient });
```

## API Reference

### `new HookOS(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chainId` | `8453 \| 4326 \| 999 \| 56 \| 1` | `8453` | Target chain (Base, MegaETH, HyperEVM, BNB Chain, Ethereum) |
| `rpcUrl` | `string` | Public RPC | Custom RPC URL |
| `walletClient` | `WalletClient` | — | viem WalletClient for write ops |
| `publicClient` | `PublicClient` | — | Existing viem PublicClient |

### `hookos.tokens`

| Method | Description |
|--------|-------------|
| `getCount()` | Total tokens created |
| `getLaunchFee()` | Current launch fee (wei) |
| `getCreatorCount(creator)` | Tokens by a specific creator |
| `get(address)` | Token info by address |
| `list(limit?)` | List all tokens |
| `isPaused()` | Check if factory is paused |
| `create(params)` | Create a new token (requires wallet) |

### `hookos.trading`

| Method | Description |
|--------|-------------|
| `getCurveCount()` | Total bonding curves |
| `getCurve(token)` | Full curve state |
| `getPrice(token)` | Current price (wei per token) |
| `getBuyQuote(token, ethAmount)` | Tokens out for ETH in |
| `getSellQuote(token, tokenAmount)` | ETH out for tokens in |
| `getProgress(token)` | Graduation progress (0-10000) |
| `getMarketCap(token)` | Market cap in wei |
| `getGraduationThreshold()` | ETH threshold to graduate |
| `getStartMcapUsd()` | v2: start market-cap target (USD, 1e18) |
| `getGraduationUsd()` | v2: graduation market-cap target (USD, 1e18) |
| `getPriceUsd()` | v2: live native/USD price used by the curve |
| `buy(token, ethAmount)` | Buy tokens with ETH (requires wallet) |
| `sell(token, tokenAmount)` | Sell tokens for ETH (requires wallet) |

**v2 USD-pegging:** `hookos.tokens.getEffectiveLaunchFee()` returns the native launch fee derived from a USD target at the live price; `getLaunchFeeUsd()` returns the USD target. `tokens.create()` now pays the effective fee automatically.

### `hookos.hooks`

| Method | Description |
|--------|-------------|
| `getCount()` | Total registered hooks |
| `getRegistrationFee()` | Registration fee (wei, legacy fixed) |
| `getRegistrationFeeUsd()` | v2: registration fee USD target (1e18) |
| `getEffectiveRegistrationFee()` | v2: effective native fee at live price |
| `get(hookId)` | Hook info by ID |
| `browse(filters?)` | Browse hooks with optional filters |
| `listBindings(token)` | Active hooks on a token |
| `hasHook(token, hookId)` | Check if hook is attached |
| `register(params)` | Register a new hook (requires wallet) |
| `attach(params)` | Attach hook to token (requires wallet) |
| `detach(params)` | Detach hook from token (requires wallet) |

### `hookos.arena`

| Method | Description |
|--------|-------------|
| `getCount()` | Total battles |
| `getBattle(battleId)` | Battle info |
| `hasWagered(battleId, player)` | Check if player wagered |
| `getWagerCount(battleId)` | Wager count |
| `getProtocolFeeBps()` | Protocol fee (bps) |
| `create(params)` | Create battle (requires wallet + OPERATOR_ROLE) |
| `wager(params)` | Place wager (requires wallet) |
| `claim(battleId)` | Claim winnings (requires wallet) |

### `hookos.events`

| Method | Description |
|--------|-------------|
| `getCount()` | Total events |
| `getEvent(eventId)` | Event info |
| `getCurrentSeason()` | Current season number |
| `isRegistered(eventId, player)` | Check registration |
| `register(eventId, opts?)` | Register for event (requires wallet) |
| `claimPrize(eventId)` | Claim prize (requires wallet) |

### `hookos.fees`

| Method | Description |
|--------|-------------|
| `getTotalDistributed()` | Total fees distributed (wei) |
| `getRecipientCount()` | Number of recipients |
| `getShares()` | All fee recipients |
| `getEarnings(wallet)` | Earnings for an address |
| `distribute()` | Trigger fee distribution (requires wallet) |

### `hookos.feedBoost`

FeedBoost slot auction (v2) — promoted placement on the Atlas feed, with USD-pegged minimum bids.

| Method | Description |
|--------|-------------|
| `getSlotCount()` | Number of auction slots |
| `getSlot(slotType)` | Live slot state (top token, current bid, expiry) |
| `listSlots()` | Live state of every slot |
| `getSlotConfig(slotType)` | Static config (minBid, minIncrement, duration) |
| `getActiveBoost(slotType)` | Live boost occupying a slot |
| `getEffectiveMinBid(slotType)` | v2: native min bid at the live USD price |
| `getMinNextBid(slotType)` | Min bid to take the slot now |
| `getProtocolFeeBps()` | Protocol fee on winning bids (bps) |
| `placeBid(params)` | Bid on one slot (requires wallet) |
| `placeBidBatch(params)` | A la carte bids across slots in one tx (requires wallet) |
| `withdrawRefund()` | Withdraw outbid refund (requires wallet) |

### `hookos.v3` — HookOS V3 (Robinhood Chain 4663 only)

Direct-to-Uniswap-v3 (and HookSwap) **fair launches** plus the **buyback-and-burn flywheel**. 100% of supply is single-sided-seeded into a fresh v3 pool (zero creator pre-alloc), the LP is permanently custodied, and ~0.10% of volume buys back and burns $HOOK. Instantiate the client with `chainId: 4663` so its RPC points at Robinhood.

| Method | Description |
|--------|-------------|
| `getEffectiveLaunchFee()` | Live native launch fee (wei) from the $8 USD peg; fails open (0) if stale |
| `getLaunchFeeUsd()` | Configured USD launch-fee target (1e18) |
| `getHookSwapLockFee()` | Flat native fee for the optional HookSwap lock upsell |
| `quoteLaunchCost(lock, buyEth)` | Total native a launch needs (fee + locker + dev buy) |
| `getLaunchCount()` | Total HookOS V3 launches |
| `getCreatorShareBps(dex)` | Creator LP-fee share, bps (UniswapV3 = 5000, HookSwap = 7000) |
| `getBuybackShareBps()` | Protocol-side share routed to buyback, bps |
| `getTotalBurned()` | Total $HOOK bought back and burned (wei) |
| `getTotalWethSpent()` | Total WETH committed to buybacks (wei) |
| `getLaunch(id)` / `getLaunchByToken(token)` | A launch record |
| `isHookOSV3Token(token)` | Whether a token was launched via HookOS V3 |
| `mineSalt(p, opts?)` | Mine a CREATE2 salt so the token sorts as token0 (below the pair) |
| `buildLaunchParams(opts)` | Build a ready-to-send `launch()` tuple (mines the salt for you) |
| `launch(params, value?)` | Deploy + seed the pool (requires wallet) |

```ts
import { HookOS, V3Dex } from "@hookos/sdk";
import { createWalletClient, custom } from "viem";

const walletClient = createWalletClient({ transport: custom(window.ethereum!) });
const hookos = new HookOS({ chainId: 4663, walletClient });

// Reads
const fee = await hookos.v3.getEffectiveLaunchFee();
const creatorBps = await hookos.v3.getCreatorShareBps(V3Dex.HookSwap); // 7000
const burned = await hookos.v3.getTotalBurned();

// Launch — the CREATE2 salt (token0 invariant) is mined for you
const { params, predictedToken } = await hookos.v3.buildLaunchParams({
  name: "My Token",
  symbol: "MTK",
  totalSupply: 1_000_000_000n * 10n ** 18n,
  tickLower: -207200,
  tickUpper: -120000,
  creator: myWalletAddress, // must match the sending wallet
  dex: V3Dex.UniswapV3,
});
const res = await hookos.v3.launch(params);
console.log(`Launched ${predictedToken} — pool ${res.pool}, tx ${res.txResult.hash}`);
```

Addresses are exported as `HOOKOS_V3_ADDRESSES` (`launcher` / `feeVault` / `buyback` / `weth` / `hook`), with ABIs `HookOSV3LauncherABI`, `HookOSV3FeeVaultABI`, `HookOSV3BuybackABI`.

## Contract Addresses (Base)

| Contract | Address |
|----------|---------|
| TokenFactory | `0x9B3d636C27AD4CDEBFbE1F182B2b63F66Be7adE5` |
| HookRegistry | `0x467A8Ab4A9B65D8Da151F402021b17A147C058c5` |
| HookManager | `0x96c5E38362f86E52389E15a86247fB7326503c8d` |
| FeeRouter | `0x64E3167b2B4eA1b8e3DdCaFe66a5b435BE7cD75f` |
| Arena | `0x47C839295754307E635DC6bEf89856267932dD38` |
| BondingCurve | `0x3C4b0F2D3d5bBdf4E0B323f0a8Eec7B02Cce6d40` |
| Events | `0x2c34ee38d96FBC890d341D80610375657594EFCc` |
| FeedBoostAuction | `0xaD31291Ff64a26D2eE5346A3c96b07f6cEe4b442` |

## HookOS V3 Addresses (Robinhood Chain 4663)

| Contract | Address |
|----------|---------|
| HookOSV3Launcher | `0x9B8d992704ddf38729535A641502bcc55734e0B8` |
| HookOSV3FeeVault | `0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF` |
| HookOSV3Buyback | `0x01EB2F68C31Ae70655807552fbDf970f1851CA50` |

## Supported Chains

| Chain | ID | Status |
|-------|----|--------|
| Base | 8453 | Live (primary) |
| MegaETH | 4326 | Live |
| HyperEVM | 999 | Live |
| BNB Chain | 56 | Live |
| Ethereum | 1 | Live |

> Full contract coverage (factory, hooks, bonding curve, fees, arena, events) is deployed on all five chains. Growth-layer contracts (NFTs, battle pass, quests, clans, analytics, launch controller, donation router, extension registry) are currently Base + MegaETH only; on other chains those addresses resolve to the zero address.

## Links

- Website: [hookos.fun](https://hookos.fun)
- X: [@hookosfun](https://x.com/hookosfun)
- Telegram: [HookOS Portal](https://t.me/HookOSPortal)
- Documentation: [docs.hookos.fun](https://docs.hookos.fun)

## License

MIT
