# @hookswap/sdk

Official TypeScript SDK for the **HookSwap** stack. One client wraps the whole surface so you
integrate against HookSwap directly:

- **`data`** — the HookSwap indexer / data-api (locks, farms, vesting schedules, launches). Pure HTTP, no wallet.
- **`swap`** — the HookSwap Trading adapter (`trading.hookswap.org`): real classic v2/v3 quotes + executable Universal Router calldata.
- **`launch`** — token creation + fair launches (TokenFactory, v3 launcher, quick launch, stock-reward launches).
- **`fees`** — creator-share + referral earnings from the FeeRouter (on-chain reads).
- **`locker` / `farms` / `vesting`** — write ops (the read side lives in `data`).

> **Facts-only:** every method hits a real endpoint or contract. Nothing is mocked. USD fields are
> omitted by the indexer when a value can't be priced (render an honest `—`, never `$0`). Swap quotes
> return an honest `404 NO_ROUTE_FOUND` until on-chain liquidity exists.

**Chains:** Robinhood Chain (4663, primary), HyperEVM (999), MegaETH (4326), Ink (57073), XLayer (196),
Tempo (4217), Sepolia (11155111).

## Module status (v0.1.0)

| Module | Status | Wraps |
| --- | --- | --- |
| `data` | ✅ fully wired | indexer `data.hookswap.org/locker` (locker/farms/vesting/launchpad endpoints) |
| `swap` | ✅ fully wired | trading adapter `trading.hookswap.org` (`/v1/quote`, `/v1/swap`, `/v1/check_approval`, …) |
| `launch` | ✅ fully wired | `@hookos/sdk` on-chain launch modules (Base/Robinhood/MegaETH/HyperEVM/BNB/Ethereum) |
| `fees` | ✅ fully wired | FeeRouter on-chain reads via `@hookos/sdk` |
| `locker` / `farms` / `vesting` **writes** | 🔨 honest stubs | deployed addresses + ABIs exposed; write methods throw `NotImplementedError` |

## Install

```bash
npm install @hookswap/sdk viem
# viem is a peer dependency
```

## Quick start

### 1. Read the indexer (no wallet)

```ts
import { HookSwap } from '@hookswap/sdk'

const hookswap = new HookSwap({ chainId: 4663 }) // Robinhood

// Top locks by TVL:
const { locks } = await hookswap.data.locks({ sort: 'tvl', limit: 20 })

// Farms on a chain:
const { farms } = await hookswap.data.farms({ chainId: 4663 })

// Vesting + launches:
const { schedules } = await hookswap.data.vesting({ sort: 'ending' })
const { launches } = await hookswap.data.launches({ sort: 'mcap' })

// All four domains' stats in one call:
const stats = await hookswap.data.stats() // { locker, farms, vesting, launches }
```

### 2. Quote a swap (no wallet)

```ts
import { HookSwap, TradeType, HttpApiError } from '@hookswap/sdk'

const hookswap = new HookSwap({ chainId: 4663 })

try {
  const { quote } = await hookswap.swap.quote({
    type: TradeType.EXACT_INPUT,
    amount: '1000000000000000', // 0.001 in base units
    tokenIn: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', // WETH on Robinhood
    tokenOut: '0x...token',
    tokenInChainId: 4663,
    tokenOutChainId: 4663,
    swapper: '0xYourWallet',
    slippageTolerance: 0.5,
  })
  console.log('out:', quote.output?.amount, 'route:', quote.routeString)

  // Build the executable transaction (echo the quote back):
  const built = await hookswap.swap.buildSwap({ quote })
  // built.swap = { to, from, data, value, chainId } — send via your walletClient.
} catch (e) {
  if (e instanceof HttpApiError && e.status === 404) {
    // NO_ROUTE_FOUND — expected until on-chain liquidity exists. Never a fabricated price.
  }
}
```

### 3. Launch a token (needs a walletClient)

```ts
import { createWalletClient, custom } from 'viem'
import { HookSwap } from '@hookswap/sdk'

const walletClient = createWalletClient({ transport: custom(window.ethereum) })
const hookswap = new HookSwap({ chainId: 4663, walletClient })

// Create an ERC-20 via the TokenFactory:
const created = await hookswap.launch.token.create({
  name: 'Foo',
  symbol: 'FOO',
  initialSupply: 1_000_000n,
  metadataURI: 'ipfs://...',
})
console.log('token:', created.tokenAddress)

// Direct-to-v3 fair launch, quick launch, and stock-reward launch:
await hookswap.launch.v3     // V3LaunchModule
await hookswap.launch.quick  // QuickLaunchModule (Robinhood only)
await hookswap.launch.stock  // StockRewardModule (Robinhood only)
```

### 4. Creator fees (on-chain read)

```ts
const hookswap = new HookSwap({ chainId: 4663 })
const earnings = await hookswap.fees.getEarnings('0xCreatorWallet') // wei
const shares = await hookswap.fees.getShares() // [{ wallet, shareBps, label }]
```

### Locker / farms / vesting writes (v0.1.0)

Reads are available today via `data`. Write methods are honest stubs — they throw
`NotImplementedError`, but expose the deployed address + ABI so you can wire viem directly now:

```ts
hookswap.locker.deployed              // boolean — is the locker deployed on this chain?
hookswap.locker.addresses             // { tokenLockerManager, v3PositionLocker }
hookswap.locker.tokenLockerAbi        // ABI fragment for HookSwapTokenLockerManager.lock(...)
hookswap.farms.factory                // StakingRewardsFactory address
hookswap.vesting.manager              // HookSwapVestingManager address
```

## Config overrides

```ts
new HookSwap({
  chainId: 4663,
  rpcUrl: 'https://my-node',                       // public-client RPC
  dataBaseUrl: 'https://data.hookswap.org/locker', // indexer base
  tradingBaseUrl: 'https://trading.hookswap.org',  // trading adapter base
  walletClient,                                    // for writes
  publicClient,                                    // reuse an existing viem client
})
```

## Build

```bash
npm install
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm run typecheck   # tsc --noEmit
```

## License

MIT
