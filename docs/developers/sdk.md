# SDK

The **HookSwap SDK** gives integrators the HookSwap chain IDs and the per-chain deployed
contract addresses (v2/v3 factories, routers, position manager, Universal Router, Permit2). It is
the single source of truth the app and tooling use to resolve addresses per chain.

For most integrations you don't need the SDK at all — the machine-readable
[`addresses.json`](../../launchpad-integration/addresses.json) plus the
[contract addresses](./contract-addresses.md) reference cover everything needed to point calls at
HookSwap. Use the SDK when you want typed helpers for pool-address computation and route encoding.

## What the SDK provides

- **Chain IDs** for every HookSwap chain (table below).
- **Per-chain addresses** — v2 factory/router, v3 factory, NonfungiblePositionManager,
  SwapRouter02, QuoterV2, Universal Router, Permit2.
- **Canonical init-code hashes** — identical on every chain, so pool/pair addresses are
  computable off-chain with `getCreate2Address(factory, salt, initCodeHash)`. See
  [overview](./overview.md#init-code-hashes).

Only the **factory / manager addresses** differ per chain; the init-code hashes and the
computation logic are the same everywhere.

## Chain IDs

| Chain | chainId |
|---|---|
| HyperEVM | 999 |
| X Layer | 196 |
| MegaETH | 4326 |
| Tempo | 4217 |
| Robinhood | 4663 |
| Ink | 57073 |
| Stable | 988 |
| Sepolia (testnet) | 11155111 |

## Stable (988) — WgUSDT DEX stack

Stable Mainnet (988) is a stablecoin-gas L1. Native gas is **USDT0** (18-dec native; a separate
6-dec `USDT0` ERC-20 at `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` is used for balances/routing).
Its canonical wrapped-native is **WgUSDT** (`0x817997ca8394e26cce3de3a076a4889b27dbf9de`, 18-dec) —
a WETH9-style wrapper with live v2 DEX pairs. The HookSwap DEX is deployed against WgUSDT as the
WETH9 constructor arg (**all four v3 fee tiers 100 / 500 / 3000 / 10000 enabled**):

| Contract | Address |
|---|---|
| WgUSDT (wrapped-native) | `0x817997ca8394e26cce3de3a076a4889b27dbf9de` |
| v2Factory | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v2Router02 | `0xFd0Dd93a1b6157e68b0A491d94249720506dc787` |
| v3Factory | `0xf486e625C892C0739A16A3A49B37fD52374B30CB` |
| NonfungiblePositionManager | `0xEcA2f71C9C4bFb522877B808970b2C06c7A83894` |
| SwapRouter02 | `0x5B57386e5F882e13946Ea4ef638c30d1f9b95D84` |
| QuoterV2 | `0x1b51C392DE4e3D3E0Ab066C5F89492ec0fCF21c3` |
| UniversalRouter | `0x79F291b64e46a5D2adbe150D58516cd19f49A323` |

This WgUSDT stack **supersedes** the earlier throwaway own-WETH9 (`0xD1Cf66…6B45`) stack, which is
abandoned/unused. `v2Factory 0xBe3729…EEFA` was reused across the redeploy. Public RPC:
`https://stable-mainnet.rpc.sentio.xyz` · explorer: https://stablescan.xyz.

## Consuming addresses in your own service

If your own backend needs the same addresses (e.g. a quoting service or a launchpad worker),
import the per-chain map directly from [`addresses.json`](../../launchpad-integration/addresses.json)
— it carries the deployed addresses, init-code hashes, and fee tiers per chain. This is the
simplest, dependency-free way to stay in sync with HookSwap's deployments.

The routing stack's wiring is covered in [routing.md](./routing.md).
