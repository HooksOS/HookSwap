# Deployed contracts (canonical address book)

The full, per-chain address book for **every** deployed HookSwap contract — the DEX stack
**and** the self-service suite (locker, farms, vesting, token factory, airdrop/multisender,
LaunchPad). Values are lifted **verbatim** from the repo's deployment records; nothing here is
invented. Where a contract is **not** deployed on a chain, it is marked `— not deployed` rather
than guessed.

**Sources (in-repo, facts-only):**

| What | Source file |
|---|---|
| DEX stack (v2/v3/UR, WETH, USDG anchor) | `contracts/deployments/<chain>.json` |
| Self-service suite (token factory, farms, vesting, multisender, airdrop, LaunchPad) | `contracts/deployments/<chain>-suite.json` |
| Locker manager + v3 position locker | `contracts/deployments/<chain>-lockers.json` |
| Locker addresses (app) | `apps/web/src/terminal/lockers/addresses.ts` |
| Farm factory addresses (app) | `apps/web/src/terminal/farms/addresses.ts` |
| Vesting manager addresses (app) | `apps/web/src/terminal/vesting/addresses.ts` |
| LaunchPad launcher + fee vault (app) | `apps/web/src/terminal/launchpad/addresses.ts` |

> The DEX-only view (init-code hashes, fee tiers, deterministic-vs-unique grouping) lives in
> [contract-addresses.md](./contract-addresses.md). This page is the **superset** including the
> self-service suite.

## Global constants (every chain)

- **Deployer** (all 7 custom chains): `0xc14C897c6bff88a5Eeac31F795693b9230205125`
- **Permit2** (canonical CREATE2, identical everywhere): `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- **Init-code hashes** (canonical, identical everywhere):
  - v2 pair: `0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f`
  - v3 pool: `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54`
- **Multicall3** (used by the indexer; deployed on every chain): `0xcA11bde05977b3631167028862bE2a173976CA11`
- **Locker fee** (every chain with lockers): `0.04` native (`40000000000000000` wei), adjustable via `setLockFee` (owner-only).

---

## Robinhood (4663) — native ETH · priority chain

| Contract | Address |
|---|---|
| **WETH** | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| **USDG** (stablecoin anchor) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH/USDG anchor pool (v2 pair) | `0xF7ddC3837eAF447689a365f5f6f6B7C2AcdB72D7` |
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` |
| v2Router02 | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v3Factory | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| NonfungiblePositionManager | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| SwapRouter02 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| QuoterV2 | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` |
| UniversalRouter | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| TokenLockerManager | `0x35dB40f22143651159056285E92c113ECE65E7e2` |
| V3PositionLocker | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| StakingRewardsFactory (farms) | `0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33` |
| VestingManager | `0x7f91048007b653b088282a73d180541f9c228677` |
| TokenFactory | `0x13064247c5687a912fb362e2bb28f24e24f3bdca` |
| MerkleDistributorFactory (airdrop) | `0x1a1c0c6f9eadd115e6fed973b1c3cfa71dadd8d5` |
| Multisender (Disperse) | `0xddb6a9b9e2d6c5636b444c0cda907c9944c6cec7` |
| **LaunchPad** — HookOSV3Launcher | `0x9B8d992704ddf38729535A641502bcc55734e0B8` |
| **LaunchPad** — HookOSV3FeeVault | `0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF` |

Robinhood is the **only** chain with the USDG stablecoin anchor and the LaunchPad launcher/fee
vault deployed. USD-denominated analytics (Data API + locker indexer) light up here first
because the WETH/USDG pool is the sole on-chain price anchor.

## HyperEVM (999) — native HYPE

| Contract | Address |
|---|---|
| **WHYPE** (wrapped native) | `0x5555555555555555555555555555555555555555` |
| v2Factory | `0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2` |
| v2Router02 | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| v3Factory | `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A` |
| NonfungiblePositionManager | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| SwapRouter02 | `0xD96fc9629AFaf325fCdd7F98Dc9b8dc2165adcBB` |
| QuoterV2 | `0x3b5a01Efc59f3465b8Eb04697f97CFE0BA700D9D` |
| UniversalRouter | `0xD9d4795F2A12305a12C36455ADAD011F2D6143AB` |
| TokenLockerManager | `0x7EFFe9DD68035f43ad43aE6C31bc1a47Ab4579D0` |
| V3PositionLocker | `0xD08E609277eCB0B7E2eF15dF5C1Fb11436627a63` |
| StakingRewardsFactory (farms) | `0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33` |
| VestingManager | `0x7f91048007b653b088282a73d180541f9c228677` |
| TokenFactory | `0x13064247c5687a912fb362e2bb28f24e24f3bdca` |
| MerkleDistributorFactory (airdrop) | `0x1a1c0c6f9eadd115e6fed973b1c3cfa71dadd8d5` |
| Multisender (Disperse) | `0xddb6a9b9e2d6c5636b444c0cda907c9944c6cec7` |
| LaunchPad launcher / fee vault | — not deployed |

DEX addresses are **non-deterministic** here (deployer nonce ≠ 0; big-blocks mode was enabled
via Hyperliquid `evmUserModify` to fit the large deploy txs). The self-service suite mirrors the
Robinhood suite (identical deterministic addresses, nonce 0-4).

## Ink (57073) — native ETH

| Contract | Address |
|---|---|
| **WETH** | `0x4200000000000000000000000000000000000006` |
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` |
| v2Router02 | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v3Factory | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| NonfungiblePositionManager | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| SwapRouter02 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| QuoterV2 | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` |
| UniversalRouter | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| TokenLockerManager | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| V3PositionLocker | `0xB5A7BF488f2407479E116f713f116546F67c803b` |
| StakingRewardsFactory (farms) | `0x144331bb4c3026d135896cafec3ae3d667f4f376` |
| VestingManager | `0x250c3448278f7b71e3e9b641f2efeb6074820e25` |
| TokenFactory | `0x7effe9dd68035f43ad43ae6c31bc1a47ab4579d0` |
| MerkleDistributorFactory (airdrop) | `0xd9d4795f2a12305a12c36455adad011f2d6143ab` |
| Multisender (Disperse) | `0xd96fc9629afaf325fcdd7f98dc9b8dc2165adcbb` |
| LaunchPad launcher / fee vault | — not deployed |

DEX addresses match the deterministic group (MegaETH / Robinhood).

## MegaETH (4326) — native ETH

| Contract | Address |
|---|---|
| **WETH** | `0x4200000000000000000000000000000000000006` |
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` |
| v2Router02 | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v3Factory | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| NonfungiblePositionManager | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| SwapRouter02 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| QuoterV2 | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` |
| UniversalRouter | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| TokenLockerManager | `0x35dB40f22143651159056285E92c113ECE65E7e2` |
| V3PositionLocker | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| ReferralRouter | `0xB5A7BF488f2407479E116f713f116546F67c803b` (default 30 bps) |
| StakingRewardsFactory (farms) | `0xd9d4795f2a12305a12c36455adad011f2d6143ab` |
| VestingManager | `0x7effe9dd68035f43ad43ae6c31bc1a47ab4579d0` |
| TokenFactory | `0x144331bb4c3026d135896cafec3ae3d667f4f376` |
| MerkleDistributorFactory (airdrop) | `0x250c3448278f7b71e3e9b641f2efeb6074820e25` |
| Multisender (Disperse) | `0xd96fc9629afaf325fcdd7f98dc9b8dc2165adcbb` |
| LaunchPad launcher / fee vault | — not deployed |

DEX addresses match the deterministic group (Ink / Robinhood).

## XLayer (196) — native OKB

| Contract | Address |
|---|---|
| **WOKB** (wrapped native) | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` |
| v2Factory | `0xD1Cf664944173140AFc302c169eFD55c24966B45` |
| v2Router02 | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| v3Factory | `0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC` |
| NonfungiblePositionManager | `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A` |
| SwapRouter02 | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| QuoterV2 | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| UniversalRouter | `0x6d8a0783213B3b06648DB3708a89732af3661005` |
| TokenLockerManager | `0x35dB40f22143651159056285E92c113ECE65E7e2` |
| V3PositionLocker | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| StakingRewardsFactory (farms) | `0x7f91048007b653b088282a73d180541f9c228677` |
| VestingManager | `0xb8b8e647259d5de25754278878893456c72c2a56` |
| TokenFactory | `0x70b9025746387e10a9ced77a4c1670def0871376` |
| MerkleDistributorFactory (airdrop) | `0xfd0dd93a1b6157e68b0a491d94249720506dc787` |
| Multisender (Disperse) | `0x13064247c5687a912fb362e2bb28f24e24f3bdca` |
| LaunchPad launcher / fee vault | — not deployed |

DEX addresses are nonce-shifted (a duplicate v2Factory was accidentally deployed at nonce 1;
the canonical `0xD1Cf66…` factory is the one used everywhere — the duplicate is unused/harmless).

## Tempo (4217) — gas paid in pathUSD (ERC-20)

| Contract | Address |
|---|---|
| **WETH9** (routing wrapper only¹) | `0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2` |
| v2Factory | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` |
| v2Router02 | `0x6d8a0783213B3b06648DB3708a89732af3661005` |
| v3Factory | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| NonfungiblePositionManager | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` |
| SwapRouter02 | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` |
| QuoterV2 | `0x15cD41B273865feD20BC8B5cDF4423D7678ac78E` |
| UniversalRouter | `0x62aE013cb2b232C20094B466C94bb39714eF661E` |
| TokenLockerManager | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| V3PositionLocker | `0xB5A7BF488f2407479E116f713f116546F67c803b` |
| StakingRewardsFactory (farms) | `0x250c3448278f7b71e3e9b641f2efeb6074820e25` |
| VestingManager | `0xd08e609277ecb0b7e2ef15df5c1fb11436627a63` |
| TokenFactory | `0x7effe9dd68035f43ad43ae6c31bc1a47ab4579d0` |
| MerkleDistributorFactory (airdrop) | `0x144331bb4c3026d135896cafec3ae3d667f4f376` |
| Multisender (Disperse) | `0xd9d4795f2a12305a12c36455adad011f2d6143ab` |
| LaunchPad launcher / fee vault | — not deployed |

¹ Tempo has **no native-gas wrapper**. This WETH9 is only the router/periphery constructor arg —
do not use `addLiquidityETH` / `msg.value`. DEX addresses are non-deterministic (deployer nonce
15→18); all txs landed at the 20 gwei network floor.

## Stable (988) — native gas USDT0

| Contract | Address |
|---|---|
| **WgUSDT** (canonical wrapped-native¹) | `0x817997ca8394e26cce3de3a076a4889b27dbf9de` |
| **USDT0** (native gas ERC-20²) | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` |
| v2Factory | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` |
| v2Router02 | `0xFd0Dd93a1b6157e68b0A491d94249720506dc787` |
| v3Factory | `0xf486e625C892C0739A16A3A49B37fD52374B30CB` |
| NonfungiblePositionManager | `0xEcA2f71C9C4bFb522877B808970b2C06c7A83894` |
| SwapRouter02 | `0x5B57386e5F882e13946Ea4ef638c30d1f9b95D84` |
| QuoterV2 | `0x1b51C392DE4e3D3E0Ab066C5F89492ec0fCF21c3` |
| Multicall2 | `0xa1aa9D69f59b20c0eF2936933D677680D6277351` |
| TickLens | `0xca82BeFEb52b736e7EE27343A0Ec552Bf7EF8D03` |
| v3Migrator | `0x1bc611Dbc2373457D114c57B7F22F2DB7EcfBb75` |
| UniversalRouter | `0x79F291b64e46a5D2adbe150D58516cd19f49A323` |
| TokenLockerManager | `0x250c3448278f7b71e3e9b641f2efeb6074820e25` |
| V3PositionLocker | `0x144331bb4c3026d135896cafec3ae3d667f4f376` |
| ReferralRouter | `0x7EFFe9DD68035f43ad43aE6C31bc1a47Ab4579D0` |
| StakingRewardsFactory (farms) | `0x0e88a920a522d2e858b5fb0e896f228f4619e0a6` |
| VestingManager | `0xb5a7bf488f2407479e116f713f116546f67c803b` |
| TokenFactory | `0x86426094d82bC1fd40F0901965b23D30837Dc66b` |
| MerkleDistributorFactory (airdrop) | `0x3b5a01efc59f3465b8eb04697f97cfe0ba700d9d` |
| Multisender (Disperse) | `0xd96fc9629afaf325fcdd7f98dc9b8dc2165adcbb` |
| LaunchPad launcher / fee vault | — not deployed |

Owner / feeToSetter / fee-receiver across the stack: `0x011d438E3eb3fce848950859591ec037C6529E13`
(treasury).

¹ **WgUSDT** (`0x817997ca8394e26cce3de3a076a4889b27dbf9de`, 18-dec, on-chain verified) is the
**canonical wrapped-native / ecosystem wrapper** on Stable — a WETH9-style `deposit()`/`withdraw()`
token with live v2 DEX pairs. The DEX (v2Router02, v3 periphery, SwapRouter02, UniversalRouter) is
deployed against WgUSDT as the WETH9 constructor arg, and the app's `wrappedNativeCurrency` in
`stable.ts` is set to WgUSDT accordingly. This **supersedes** the earlier throwaway own-WETH9
(`0xD1Cf66…6B45`) WETH9-first stack, which is now **abandoned/unused** (v2Router02
`0xAa1f5B…D7f3` / v3Factory `0xAB34Bb…07aC` / SwapRouter02 `0x6d8a07…1005` / QuoterV2
`0x3D3013…93b3` / NPM `0x45DB3e…275A` / UniversalRouter `0x35dB40…E7e2` from that stack no longer
apply). `v2Factory 0xBe3729…EEFA` was reused across the redeploy. Native gas is still **USDT0** (an
18-dec native gas token), and all four canonical v3 fee tiers (100 / 500 / 3000 / 10000) are enabled.
² **USDT0** (`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, verified symbol `USDT0`, 6-dec ERC-20) is
the gas-token-override / balances / routing asset (Arc-USDC model). **Permit2** and **Multicall3**
are the canonical reused addresses (see [Global constants](#global-constants-every-chain)). The DEX
is **live and on-chain-verified** — a real swap has been executed.

## Sepolia (11155111) — testnet

The DEX layer reuses **Uniswap's canonical Sepolia deployment** (no HookSwap DEX deploy). The
HookSwap self-service suite + lockers ARE deployed here (for testing).

| Contract | Address |
|---|---|
| **WETH** | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| v2Factory (canonical Uniswap) | `0xF62c03E08ada871A0bEb309762E260a7a6a880E6` |
| v2Router02 (canonical Uniswap) | `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3` |
| v3Factory (canonical Uniswap) | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| NonfungiblePositionManager (canonical) | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| SwapRouter02 (canonical Uniswap) | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| QuoterV2 (canonical Uniswap) | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| UniversalRouter (v2_0, canonical) | `0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b` |
| TokenLockerManager (HookSwap) | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` |
| V3PositionLocker (HookSwap) | `0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC` |
| StakingRewardsFactory (farms) | `0x144331bb4c3026d135896cafec3ae3d667f4f376`² |
| VestingManager | `0x250c3448278f7b71e3e9b641f2efeb6074820e25` |
| TokenFactory | `0xf248c369c125094cdb95e8abee095c11758c8f14` |
| MerkleDistributorFactory (airdrop) | `0xa87a98a930d90fb8e68d497afe3ade02b949fc10` |
| Multisender (Disperse) | `0xd9d4795f2a12305a12c36455adad011f2d6143ab` |
| LaunchPad launcher / fee vault | — not deployed |

² A superseded (pre-security-fix) StakingRewardsFactory `0xb9df9afbcf909a16218285889912820c3f2c6313`,
Multisender `0xa24cd888adaf42011a49d8eaedb2fe751c54e7e2`, and VestingManager
`0xb92598fa464b96fec394a17a269ad18060ec60b2` were replaced on 2026-07-14 by the security-fix
redeploy above. Kept for provenance only — **do not use**. The locker indexer's Farms module
indexes both the current and the superseded factory on Sepolia.

---

## Coverage notes (honest gaps)

- **LaunchPad (HookOSV3Launcher + HookOSV3FeeVault)** is deployed on **Robinhood only**. The app's
  `apps/web/src/terminal/launchpad/addresses.ts` maps only chain 4663; every other chain renders an
  honest "not deployed" state.
- **USDG** and the **WETH/USDG anchor pool** exist on **Robinhood only** — the single on-chain USD
  price anchor. USD figures across the Data API and locker indexer are therefore Robinhood-first.
- The app's **farms** and **vesting** address maps (`farms/addresses.ts`, `vesting/addresses.ts`)
  intentionally list the **6 custom chains** (mainnet launch scope) and omit Sepolia; the Sepolia
  suite contracts above exist for testing and are read from `contracts/deployments/sepolia-suite.json`.
- Addresses only appear in this table when they exist in the source files. Any contract not deployed
  on a chain is written `— not deployed`, never guessed.

> If any chain is redeployed, update the relevant `contracts/deployments/*.json` /
> `*-suite.json` / `*-lockers.json` and the app address maps, then regenerate this page.
