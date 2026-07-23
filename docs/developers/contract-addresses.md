# Contract addresses

> This page covers the **DEX stack** (v2/v3/UR, WETH, init-code hashes, fee tiers). For the full
> address book — the DEX stack **plus** the self-service suite (locker, farms, vesting, token
> factory, airdrop, LaunchPad) per chain — see [deployed-contracts.md](./deployed-contracts.md).

The canonical address reference for the HookSwap DEX stack — the contracts you integrate
against (factories, routers, quoter, position manager, WETH) per chain.

- **Permit2** (every chain, canonical CREATE2): `0x000000000022D473030F116dDEE9F6B43aC78BA3`

## Deterministic group — MegaETH (4326), Robinhood (4663), Ink (57073)

These three were deployed from a nonce-0 deployer, so **v2/v3/router addresses are identical**
across all three. Only WETH differs.

| Contract | Address |
|---|---|
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` |
| v2Router02 | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v3Factory | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| NonfungiblePositionManager | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| SwapRouter02 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| QuoterV2 | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` |
| UniversalRouter | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| **WETH** — MegaETH (4326) | `0x4200000000000000000000000000000000000006` |
| **WETH** — Ink (57073) | `0x4200000000000000000000000000000000000006` |
| **WETH** — Robinhood (4663) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

Shared v3 periphery (identical across the deterministic group):

| Contract | Address |
|---|---|
| multicall2 | `0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A` |
| proxyAdmin | `0xA24cD888adAF42011a49d8Eaedb2Fe751C54e7E2` |
| tickLens | `0xf248c369C125094cDB95E8AbeE095c11758C8F14` |
| v3Migrator | `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A` |
| v3Staker | `0xD412b66afAd16a247a12a1eF31A1c6d37BBb9B6f` |

## Unique addresses — XLayer (196), HyperEVM (999), Tempo (4217), Stable (988)

Deployed at a **non-zero** deployer nonce (or a WETH9-first shift), so addresses differ per chain.
**Read them per-chain — do not assume the deterministic set.**

| Contract | XLayer (196) | HyperEVM (999) | Tempo (4217) | Stable (988) |
|---|---|---|---|---|
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` | `0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2` | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v2Router02 | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` | `0x6d8a0783213B3b06648DB3708a89732af3661005` | `0xFd0Dd93a1b6157e68b0A491d94249720506dc787` |
| v3Factory | `0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC` | `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A` | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` | `0xf486e625C892C0739A16A3A49B37fD52374B30CB` |
| NonfungiblePositionManager | `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A` | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` | `0xEcA2f71C9C4bFb522877B808970b2C06c7A83894` |
| SwapRouter02 | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` | `0xD96fc9629AFaf325fCdd7F98Dc9b8dc2165adcBB` | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` | `0x5B57386e5F882e13946Ea4ef638c30d1f9b95D84` |
| QuoterV2 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | `0x3b5a01Efc59f3465b8Eb04697f97CFE0BA700D9D` | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` | `0x1b51C392DE4e3D3E0Ab066C5F89492ec0fCF21c3` |
| UniversalRouter | `0x6d8a0783213B3b06648DB3708a89732af3661005` | `0xD9d4795F2A12305a12C36455ADAD011F2D6143AB` | `0x62aE013cb2b232C20094B466C94bb39714eF661E` | `0x79F291b64e46a5D2adbe150D58516cd19f49A323` |
| Permit2 | `0x0000…78BA3` | `0x0000…78BA3` | `0x0000…78BA3` | `0x0000…78BA3` |
| WETH / wrapped | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` (WOKB) | `0x5555555555555555555555555555555555555555` (WHYPE) | `0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2` (WETH9¹) | `0x817997ca8394e26cce3de3a076a4889b27dbf9de` (WgUSDT²) |

¹ **Tempo has no native-gas wrapper.** Gas is paid in `pathUSD` (ERC-20). This WETH9 address is
only the router/periphery constructor arg — do **not** use `addLiquidityETH` / `msg.value` on
Tempo. Use token/token pairs against `pathUSD` or another ERC-20 quote asset.

² **Stable's canonical wrapped-native is WgUSDT** (`0x817997ca8394e26cce3de3a076a4889b27dbf9de`,
18-dec, on-chain verified) — the real ecosystem WETH9-style wrapper with live v2 DEX pairs. The DEX
(v2Router02 / v3 periphery / SwapRouter02 / UniversalRouter above) is deployed against WgUSDT as the
WETH9 constructor arg, and the app's `wrappedNativeCurrency` in `stable.ts` is set to WgUSDT. This
**supersedes** the earlier throwaway own-WETH9 (`0xD1Cf66…6B45`) WETH9-first stack, now
**abandoned/unused** — its v2Router02 `0xAa1f5B…D7f3`, v3Factory `0xAB34Bb…07aC`, SwapRouter02
`0x6d8a07…1005`, QuoterV2 `0x3D3013…93b3`, NPM `0x45DB3e…275A`, and UniversalRouter `0x35dB40…E7e2`
no longer apply. Native gas is still **USDT0** (18-dec native; a 6-dec `USDT0` ERC-20 lives at
`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`) — the gas-token-override / balances / routing asset.
`v2Factory 0xBe3729…EEFA` was reused across the redeploy; all four v3 fee tiers (100 / 500 / 3000 /
10000) are enabled.

**Chain-specific deploy notes** (from the deployment records):
- **HyperEVM (999):** addresses are non-deterministic (deployer nonce ≠ 0). Big-blocks mode was
  enabled on the deployer (Hyperliquid `evmUserModify`) to fit the large deploy txs.
- **XLayer (196):** the canonical `v2Factory` (`0xD1Cf66…`, nonce 0) is the one used everywhere;
  a duplicate factory at `0xBe3729d0…` was accidentally created at nonce 1 and is **unused/harmless**.
  Because that nonce was consumed, all downstream addresses are shifted by one and differ from the
  deterministic group.
- **Tempo (4217):** deployed at deployer nonce 15→18; all txs landed at the 20 gwei network floor.
- **Stable (988):** the DEX was **redeployed against the canonical WgUSDT wrapper**
  (`0x817997ca…f9de`) — v2Router02 / v3 periphery / SwapRouter02 / QuoterV2 / UniversalRouter are the
  WgUSDT-stack addresses above; `v2Factory 0xBe3729…EEFA` was reused. The earlier throwaway
  own-WETH9 (`0xD1Cf66…6B45`) stack is **superseded/abandoned**. Permit2 + Multicall3 are the
  canonical reused addresses. Native gas is USDT0 (~1.13 gwei; no Tempo-style multiplier). The DEX
  is **live and on-chain-verified** — a real swap has been executed.

## Sepolia (11155111) — testnet, canonical Uniswap

HookSwap reuses Uniswap's canonical Sepolia deployment for testing (no HookSwap deploy).

| Contract | Address |
|---|---|
| v2Factory | `0xF62c03E08ada871A0bEb309762E260a7a6a880E6` |
| v2Router02 | `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3` |
| v3Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| NonfungiblePositionManager | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| QuoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| UniversalRouter (v2_0) | `0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |

## v3 fee tiers

| Fee | Meaning | tickSpacing |
|---|---|---|
| `100` | 0.01% | 1 |
| `500` | 0.05% | 10 |
| `3000` | 0.30% | 60 |
| `10000` | 1.00% | 200 |

`tickLower` / `tickUpper` must be multiples of the pool's `tickSpacing`, or `mint` reverts.

> If a chain is ever redeployed, regenerate `launchpad-integration/addresses.json` from the
> updated `contracts/deployments/*.json` and update this page.
