# Supported chains

HookSwap is deployed on 7 production chains, plus **Sepolia** for testing. Values below come from
the in-app chain configs and the deployment records (`contracts/deployments/*.json`).

| Chain | chainId | Native token | Wrapped native | Layer | Explorer | Default public RPC |
|---|---|---|---|---|---|---|
| **HyperEVM** | 999 (`0x3E7`) | HYPE | WHYPE `0x5555…5555` | L1 | https://hyperevmscan.io/ | `https://rpc.hyperliquid.xyz/evm` |
| **MegaETH** | 4326 | ETH | WETH `0x4200…0006` | L2 | https://megaeth.blockscout.com/ | `https://mainnet.megaeth.com/rpc` |
| **Robinhood Chain** | 4663 (`0x1237`) | ETH | WETH `0x0Bd7…AD73` | L2 | https://robinscan.io/ | `https://rpc.mainnet.chain.robinhood.com` |
| **Ink** | 57073 | ETH | WETH `0x4200…0006` | L2 | https://explorer.inkonchain.com/ | `https://rpc-gel.inkonchain.com` |
| **X Layer** | 196 | OKB | WOKB `0xe538…9b2b` | L2 | https://web3.okx.com/explorer/x-layer/ | `https://xlayer.drpc.org` |
| **Tempo** | 4217 | USD (pathUSD)¹ | WETH9 arg only¹ | L1 | https://explore.tempo.xyz/ | `https://rpc.tempo.xyz` |
| **Stable** | 988 (`0x3DC`) | USDT0² | WgUSDT `0x8179…f9de`² | L1 | https://stablescan.xyz/ | `https://stable-mainnet.rpc.sentio.xyz`³ |
| **Sepolia** (testnet) | 11155111 | ETH | WETH `0xfFf9…6B14` | testnet | Etherscan (Sepolia) | Infura (`https://sepolia.infura.io/v3/<key>`) |

¹ **Tempo** pays gas in `pathUSD` (an ERC-20), not a native coin. It has **no native-gas
wrapper** — the WETH9 address in the deployment is only a router/periphery constructor
argument. In the app, Tempo's `wrappedNativeCurrency` is intentionally left unset. Trade and
LP token/token pairs (against pathUSD or another ERC-20), never native-gas flows.

² **Stable** pays gas in **USDT0** — an 18-dec native gas token (a separate 6-dec `USDT0`
ERC-20 also exists at `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, used for balances/routing).
Its canonical wrapped-native is **WgUSDT** (`0x817997ca8394e26cce3de3a076a4889b27dbf9de`, 18-dec) —
the real ecosystem WETH9-style wrapper with live v2 DEX pairs. The HookSwap DEX is deployed against
WgUSDT as the WETH9 constructor arg, and the app's `wrappedNativeCurrency` is set to WgUSDT. This
supersedes an earlier throwaway own-WETH9 stack (`0xD1Cf66…6B45`), now abandoned. Permit2 +
Multicall3 are the canonical reused addresses. The HookSwap DEX is **live and on-chain-verified** —
a real swap has been executed.

³ **Stable RPC** uses an ordered auto-fallback in the app config (`stable.ts`): primary
`https://stable-mainnet.rpc.sentio.xyz`, then `https://rpc.stable.xyz` (the official endpoint,
but flaky — intermittent 503s/timeouts), then `https://stable.drpc.org`. Chain id `0x3DC` = 988.

## Testnets

- **Robinhood testnet:** chainId 46630 (`0xB5E6`), RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- **HyperEVM testnet:** chainId 998 (`0x3E6`), RPC `https://rpc.hyperliquid-testnet.xyz/evm`.
- **Sepolia** (11155111) is the primary test chain; it uses the canonical Uniswap deployment.

## Live DEX liquidity

Real on-chain pools now exist on **6 of the 7** production chains — each a **v2** pair of the
chain's wrapped-native against a **real stablecoin** (no mock tokens). They are **small proof /
"dust" pools (~$10–30 each)**, enough to prove routing but not deep liquidity yet. See
[Providing liquidity → Live pools today](./liquidity.md#live-pools-today) for the pair addresses
(source: `contracts/deployments/pools-seeded.json`).

| Chain | Live pool? |
|---|---|
| Robinhood (4663) | ✅ WETH/USDG anchor |
| Stable (988) | ✅ WgUSDT/USDT0 |
| Ink (57073) | ✅ WETH/USD₮0 |
| MegaETH (4326) | ✅ WETH/USDm |
| HyperEVM (999) | ✅ WHYPE/USDC |
| X Layer (196) | ✅ STT/WOKB (existing seed) |
| Tempo (4217) | ⛔ none — AA-native tokens can't form a standard v2 pair yet |

## Notes

- Public RPCs are rate-limited and are expected to move to dedicated nodes for production
  traffic. Sepolia uses a hosted RPC; the 7 custom chains use public RPCs.
- **v4/hooks are not deployed on any chain.** Some chain config files carry a `supportsV4`
  flag, but no v4 PoolManager or hook contracts exist on HookSwap — only v2 + v3 + Universal
  Router. See the [FAQ](./faq.md).
