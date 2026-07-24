/**
 * Per-chain config for the HookSwap data-api.
 *
 * COPIED from trading-api-adapter/src/chains.ts (single source of truth for the deployed
 * HookSwap-owned v2+v3 stack, from HookSwap/contracts/deployments/<chain>.json). The data-api
 * only needs a subset of those fields: chainId, RPC, wrapped-native metadata, the v2/v3 factory
 * addresses (for on-chain pool discovery), and the `seededTokens` list (real, verified tokens
 * beyond the wrapped-native). Router/quoter/permit2 addresses are NOT needed for read-only data.
 *
 * ROBINHOOD (4663) is the priority chain (its seeded WETH/tHOOK v2 pool is the Phase-1 target).
 * The other chains are included for parity but secondary.
 *
 * RPC URLs are read from env (WEB3_RPC_<chainId>) with the public endpoint as fallback —
 * same `resolveRpcUrl` helper as the adapter.
 */

export interface ChainConfig {
  chainId: number
  name: string
  /** env var this service reads for the RPC URL (falls back to `publicRpc`). */
  rpcEnvVar: string
  /** public fallback RPC (works but rate-limited; replace with hosted via env). */
  publicRpc: string
  nativeSymbol: string
  nativeDecimals: number
  /** wrapped-native token (WETH9-compatible). Real, static, verified metadata. */
  wrappedNative: {
    address: string
    symbol: string
    name: string
    decimals: number
  }
  /** deployed HookSwap v2 factory (from contracts/deployments/*.json). Used for CREATE2 pair discovery. */
  v2Factory: string
  /** deployed HookSwap v3 factory. Used for v3 `PoolCreated` log-scan discovery (see onchain.ts). */
  v3Factory: string
  /**
   * Canonical Uniswap v4 singleton `PoolManager` for this chain (bytes32-poolId-keyed pools), when one
   * exists. Source: V4-ENABLEMENT-PLAN.md §4 (each address `eth_getCode`-confirmed on-chain 2026-07-21)
   * and matches `vendor/sdk-core` `v4PoolManagerAddress`. The event indexer scans its Initialize/Swap/
   * ModifyLiquidity logs for v4 pool discovery + metrics. OMITTED where a chain has NO canonical v4
   * (HyperEVM 999, Stable 988 — verified none) → v4 discovery is skipped honestly for that chain.
   */
  v4PoolManager?: string
  /**
   * Block the v4 `PoolManager` was deployed at — the start block for the singleton Initialize/Swap scan.
   * Optional: like v3, unbounded full-history scans are avoided. When unset, the indexer's first v4 pass
   * is bounded to `latest - INDEXER_BACKFILL_BLOCKS` (logged, honest partial) or env
   * `V4_SCAN_FROM_BLOCK_<chainId>`. Fill once the deploy block is recorded for full history.
   */
  v4DeployBlock?: number
  /**
   * Deployed `HookSwapTokenFactory` (self-service, fixed-supply ERC-20 launcher) address. When set,
   * onchain.ts `enumerateEcosystemTokens` reads its `allTokens()` / `allTokensLength()` + `tokenAt(i)`
   * to surface EVERY self-service-created token in the token surfaces (Markets/picker/search) even when
   * the token has NO pool yet. Optional: omit until the factory is deployed on a chain. Copied VERBATIM
   * from apps/web/src/terminal/tokenfactory/addresses.ts (never guessed).
   */
  tokenFactory?: string
  /**
   * Deployed `HookOSV3Launcher` (launchpad) proxy address. When set, `enumerateEcosystemTokens` reads
   * `launchCount()` + `getLaunch(id)` (token = struct field 0) to surface every launchpad-launched token
   * regardless of whether its v3 pool is currently scanned. Optional: only the @hookos/sdk chains carry a
   * launcher (4663/8453/56/1/4326/999) — leave undefined elsewhere. Addresses copied VERBATIM from
   * @hookos/sdk `HOOKOS_V3_ADDRESSES_BY_CHAIN` (never guessed).
   */
  launcher?: string
  /**
   * Block the v3 factory was deployed at — the start block for the `PoolCreated` log scan. Optional:
   * UniswapV3Factory has no pool enumerator, so v3 discovery requires a start block (this, or env
   * `V3_SCAN_FROM_BLOCK_<chainId>`) to avoid an unbounded full-history scan on every request. Omit
   * until v3 pools are actually seeded on a chain — while unset, v3 discovery honestly returns [].
   */
  v3DeployBlock?: number
  /**
   * Known-real tokens beyond the wrapped-native (e.g. a chain's seeded test token).
   * Real, static, verified metadata only — we do NOT invent tokens. Optional; omit until a
   * chain has one. On-chain pool discovery pairs each of these with the wrapped-native.
   */
  seededTokens?: Array<{ address: string; symbol: string; name: string; decimals: number }>
  /**
   * The chain's canonical USD stablecoin — the USD ANCHOR for this chain. When a
   * wrapped-native/stablecoin v2 pool has been ingested, metrics.ts derives usdPerNative from that
   * single pool's reserves (see getUsdPerNative) and every USD value on the chain flows from it. NO
   * external oracle. Optional: leave UNSET until a chain's real stablecoin address is verified — an
   * unset stablecoin means all USD fields stay `undefined` (never fabricated). Do NOT guess: only
   * populate with an on-chain-verified stablecoin. Robinhood (4663) = USDG (6 decimals), verified.
   */
  stablecoin?: { address: string; symbol: string; decimals: number }
}

export const CHAINS: Record<number, ChainConfig> = {
  // ---- Robinhood (4663) — PRIORITY. Seeded WETH/tHOOK v2 pool. ----
  4663: {
    chainId: 4663,
    name: 'robinhood',
    rpcEnvVar: 'WEB3_RPC_4663',
    publicRpc: 'https://rpc.mainnet.chain.robinhood.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    // Canonical Uniswap v4 PoolManager (V4-ENABLEMENT-PLAN.md §4, getCode-confirmed; == sdk-core). HOOK
    // (v4-only) liquidity lives here. Singleton — the indexer scans its Initialize/Swap logs for v4 pools,
    // gated to HookSwap-owned hooks (see v4Hooks.ts): the flagship $HOOK/WETH pool (hook 0x0a09eedc…,
    // Initialized at block 8,751,433) is HookSwap-native; the other ~10.8k pools on this shared singleton
    // are foreign and skipped.
    v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    // PoolManager deploy block VERIFIED on-chain (eth_getCode binary-search, 2026-07-24). Needed so the v4
    // scan reaches HookSwap's v4 pools that predate the default backfill window — notably the flagship
    // $HOOK/WETH pool at block ~8.75M — which the 200k-block default would miss. Full-history scan from
    // here (foreign pools are cheaply skipped by the hook allowlist); cursor persists + tails.
    v4DeployBlock: 3967002,
    // Self-service token factory + launchpad launcher — enumerated for pool-less token discovery.
    // tokenFactory from apps/web/src/terminal/tokenfactory/addresses.ts; launcher from @hookos/sdk.
    tokenFactory: '0x13064247c5687a912fb362e2bb28f24e24f3bdca',
    launcher: '0x9B8d992704ddf38729535A641502bcc55734e0B8',
    // v3 factory 0xAa1f5Bd… deploy block VERIFIED on-chain (eth_getCode bisection, 2026-07-24) — needed
    // so v3 PoolCreated discovery reaches launchpad pools (e.g. HSTT/WETH 0xE10f33… at block ~13.77M),
    // which predate the default 700k backfill window. Full-history scan from here; cursors persist + tail.
    v3DeployBlock: 3967105,
    // Seeded WETH/tHOOK v2 pool (contracts/seed/broadcast/SeedPools.s.sol/4663/run-latest.json).
    seededTokens: [{ address: '0x3b5a01Efc59f3465b8Eb04697f97CFE0BA700D9D', symbol: 'tHOOK', name: 'Test Hook Token', decimals: 18 }],
    // USD anchor: Robinhood's real stablecoin USDG (6 decimals, verified on-chain). Once a
    // WETH/USDG v2 pool is seeded + ingested, usdPerNative (and all USD fields) light up automatically.
    stablecoin: { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG', decimals: 6 },
  },

  // ---- MegaETH (4326) ----
  4326: {
    chainId: 4326,
    name: 'megaeth',
    rpcEnvVar: 'WEB3_RPC_4326',
    publicRpc: 'https://mainnet.megaeth.com/rpc',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    // Canonical Uniswap v4 PoolManager (V4-ENABLEMENT-PLAN.md §4, getCode-confirmed; == sdk-core).
    v4PoolManager: '0xacb7e78fa05d562e0a5d3089ec896d57d057d38e',
    // tokenFactory from apps/web/src/terminal/tokenfactory/addresses.ts; launcher from @hookos/sdk (4326).
    tokenFactory: '0x144331bb4c3026d135896cafec3ae3d667f4f376',
    launcher: '0x528Bcecff5DA16cE65C198fBe42dA55A0088d4c2',
    // TODO(v3DeployBlock): v3 factory deploy block not recorded in contracts/deployments/megaeth.json.
    // USD anchor: real stablecoin USDm (18 decimals). Seeded WETH/USDm v2 pool
    // 0xAD12931B2ff618C4aFEA9d9BCB7508Ccb51fF674 (contracts/deployments/pools-seeded.json, verified
    // on-chain 2026-07-23: token0 WETH 0x4200..0006 / token1 USDm 0xFAfD..79E7). usdPerNative derives
    // from its reserves; every USD field lights up once ingested.
    stablecoin: { address: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7', symbol: 'USDm', decimals: 18 },
  },

  // ---- Ink (57073) ----
  57073: {
    chainId: 57073,
    name: 'ink',
    rpcEnvVar: 'WEB3_RPC_57073',
    publicRpc: 'https://rpc-gel.inkonchain.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    // Canonical Uniswap v4 PoolManager (V4-ENABLEMENT-PLAN.md §4, getCode-confirmed; shares the CREATE2
    // address with XLayer — distinct legit deploys; == sdk-core).
    v4PoolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
    // tokenFactory from apps/web/src/terminal/tokenfactory/addresses.ts. No launcher on Ink (not a @hookos/sdk chain).
    tokenFactory: '0x7effe9dd68035f43ad43ae6c31bc1a47ab4579d0',
    // TODO(v3DeployBlock): v3 factory deploy block not recorded in contracts/deployments/ink.json.
    // USD anchor: canonical USD₮0 (6 decimals). Seeded WETH/USD₮0 v2 pool
    // 0xB738BBaC16121D11B1F59AbC619A359413503d12 (contracts/deployments/pools-seeded.json, verified
    // on-chain 2026-07-23: token0 USD₮0 0x0200..70c1 / token1 WETH 0x4200..0006).
    stablecoin: { address: '0x0200C29006150606B650577BBE7B6248F58470c1', symbol: 'USD₮0', decimals: 6 },
  },

  // ---- XLayer (196) — has a seeded WOKB/SeedTestToken v2 pool (per CLAUDE.md 2026-07-08). ----
  196: {
    chainId: 196,
    name: 'xlayer',
    rpcEnvVar: 'WEB3_RPC_196',
    publicRpc: 'https://xlayer.drpc.org',
    nativeSymbol: 'OKB',
    nativeDecimals: 18,
    wrappedNative: { address: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', symbol: 'WOKB', name: 'Wrapped OKB', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v3Factory: '0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC',
    // Canonical Uniswap v4 PoolManager (V4-ENABLEMENT-PLAN.md §4, getCode-confirmed; shares the CREATE2
    // address with Ink — distinct legit deploys; == sdk-core).
    v4PoolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
    // tokenFactory from apps/web/src/terminal/tokenfactory/addresses.ts. No launcher on XLayer (not a @hookos/sdk chain).
    tokenFactory: '0x70b9025746387e10a9ced77a4c1670def0871376',
    // TODO(v3DeployBlock): v3 factory deploy block not recorded in contracts/deployments/xlayer.json.
    // NOTE: XLayer has TWO real on-chain v2 pools under this factory (verified via live allPairs()
    // on 2026-07-10): pair[0] 0x782acfD69d0BeE76aC4B618D2f5fDD9060F5854E (HKT 0x0E88A920A522d2e858B5fB0e896F228f4619E0a6 / WOKB)
    // and the seeded pair[1] 0x1A95898916C7872F4712c92A1b665E54414728Bd (HKT 0x144331BB4C3026D135896CaFec3Ae3D667f4F376 / WOKB,
    // matching CLAUDE.md 2026-07-08). Both are now discovered automatically by onchain.ts factory
    // ENUMERATION (allPairsLength/allPairs) with live-read ERC-20 metadata — no hardcoded seededTokens
    // needed. Left empty deliberately: enumeration is authoritative and avoids duplicating the two
    // same-symbol ("HKT") tokens with guessed names here.
  },

  // ---- HyperEVM (999) ----
  999: {
    chainId: 999,
    name: 'hyperevm',
    rpcEnvVar: 'WEB3_RPC_999',
    publicRpc: 'https://rpc.hyperliquid.xyz/evm',
    nativeSymbol: 'HYPE',
    nativeDecimals: 18,
    wrappedNative: { address: '0x5555555555555555555555555555555555555555', symbol: 'WHYPE', name: 'Wrapped HYPE', decimals: 18 },
    v2Factory: '0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2',
    v3Factory: '0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A',
    // tokenFactory from apps/web/src/terminal/tokenfactory/addresses.ts (HyperEvm); launcher from @hookos/sdk (999).
    tokenFactory: '0x13064247c5687a912fb362e2bb28f24e24f3bdca',
    launcher: '0x2dB1b1e2123c3d61B0cAfE4aF5864E4FAB3a5F74',
    // TODO(v3DeployBlock): v3 factory deploy block not recorded in contracts/deployments/hyperevm.json.
    // USD anchor: real HyperEVM USDC (6 decimals, 0xb883..630f — acquired via swap, NOT the bridged
    // USD₮0). Seeded WHYPE/USDC v2 pool 0x8628AfE800ca8C26F1d4Dc41e2B02C85e0B19Fc3
    // (contracts/deployments/pools-seeded.json, verified on-chain 2026-07-23: token0 WHYPE 0x5555.. /
    // token1 USDC 0xb883..630f). NB: this chain's own v2Factory 0xB925..60B2 (not the 0xD1Cf.. one).
    stablecoin: { address: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', symbol: 'USDC', decimals: 6 },
  },

  // ---- Stable / Stable Mainnet (988) — stablecoin-gas L1. Canonical DEX on the WgUSDT stack. ----
  988: {
    chainId: 988,
    name: 'stable',
    rpcEnvVar: 'WEB3_RPC_988',
    // rpc.stable.xyz is the official endpoint but documented flaky (503s/timeouts); Sentio is the
    // interface's primary (packages/uniswap/.../evm/info/stable.ts). Override via WEB3_RPC_988.
    publicRpc: 'https://stable-mainnet.rpc.sentio.xyz',
    // Native gas token is USDT0 (18-dec balance); the routing/wrapped form is WgUSDT (see stable.ts).
    nativeSymbol: 'USDT0',
    nativeDecimals: 18,
    // Canonical wrapped-native = WgUSDT (WETH9-style deposit()/withdraw(), 18-dec), verified in
    // contracts/deployments/stable.json (weth9Note) + packages/uniswap/.../evm/info/stable.ts.
    wrappedNative: { address: '0x817997Ca8394E26CCE3dE3A076a4889b27DbF9dE', symbol: 'WgUSDT', name: 'Wrapped gasUSDT', decimals: 18 },
    // Canonical Stable v2 factory — verified on-chain via the seeded pair's factory() call 2026-07-23
    // (== contracts/deployments/stable.json v2Factory). NOTE: a DIFFERENT address from the 0xD1Cf.. one
    // the L2s share.
    v2Factory: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v3Factory: '0xf486e625C892C0739A16A3A49B37fD52374B30CB',
    tokenFactory: '0x86426094d82bC1fd40F0901965b23D30837Dc66b',
    // TODO(v3DeployBlock): v3 factory deploy block not recorded in contracts/deployments/stable.json.
    // USD anchor: USDT0 (6-dec ERC-20, 0x779D..3736) — the seeded WgUSDT/USDT0 v2 pool
    // 0x7F9023729F92ecb5aCbe9A4d9F9463fCDf5b2B9f (verified on-chain 2026-07-23: token0 USDT0 6-dec /
    // token1 WgUSDT 18-dec). Both sides are ~$1 stablecoins; usdPerNative (USDT0-per-WgUSDT) derives
    // from the pool's real reserves (≈1.05), so TVL/prices are honest market-rate values.
    stablecoin: { address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', symbol: 'USDT0', decimals: 6 },
  },

  // ---- Sepolia (11155111) — canonical Uniswap stack (testing). ----
  11155111: {
    chainId: 11155111,
    name: 'sepolia',
    rpcEnvVar: 'WEB3_RPC_11155111',
    publicRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xF62c03E08ada871A0bEb309762E260a7a6a880E6',
    v3Factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
    // Canonical Uniswap v4 PoolManager on Sepolia (V4-ENABLEMENT-PLAN.md §4, getCode-confirmed; == sdk-core).
    v4PoolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  },
}

/**
 * v2 pair init-code hash — CANONICAL Uniswap v2 (verified == HookSwap's deployed v2 factory in
 * CLAUDE.md 2026-07-03 & confirmed on XLayer 2026-07-08, computed pair == on-chain pair).
 * Used with the per-chain v2Factory for CREATE2 pair-address computation in onchain.ts.
 */
export const V2_PAIR_INIT_CODE_HASH = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAINS
}

export function supportedChainIds(): number[] {
  return Object.keys(CHAINS).map(Number)
}

/** Resolve the RPC URL for a chain: env override first, public fallback second. */
export function resolveRpcUrl(chain: ChainConfig): string {
  return process.env[chain.rpcEnvVar] || chain.publicRpc
}
