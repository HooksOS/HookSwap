/**
 * Per-chain config for the HookSwap Trading API adapter.
 *
 * Addresses are copied from HookSwap/contracts/deployments/<chain>.json (the real,
 * on-chain HookSwap-owned v2+v3+UR stack). These are used for:
 *   - swappable_tokens (wrapped-native metadata is real, static, safe to serve)
 *   - documentation / sanity checks
 *   - the direct-SOR-embed mode (implemented in routingClient.ts/embedRouter.ts) which needs factory/quoter/router
 *
 * RPC URLs are read from env (see config/rpc.example.env). Public endpoints are the
 * defaults; Reggie replaces with hosted (Alchemy/QuickNode/etc) URLs + keys.
 */

export interface ChainConfig {
  chainId: number
  name: string
  /** env var this adapter reads for the RPC URL (falls back to `publicRpc`). */
  rpcEnvVar: string
  /** public fallback RPC (works but rate-limited; replace with hosted). */
  publicRpc: string
  nativeSymbol: string
  nativeDecimals: number
  /** wrapped-native token (WETH9-compatible). Real, static metadata. */
  wrappedNative: {
    address: string
    symbol: string
    name: string
    decimals: number
  }
  // deployed HookSwap stack (from contracts/deployments/*.json)
  v2Factory: string
  v2Router02: string
  v3Factory: string
  v3QuoterV2?: string // optional in the type; in practice all 7 chains have a deployed QuoterV2
  swapRouter02: string
  universalRouter: string
  multicall2: string
  permit2: string
  /** protocols to request for this chain. v4 is added only where canonical Uniswap v4 exists. */
  protocols: Array<'v2' | 'v3' | 'v4'>
  // ---- canonical Uniswap v4 infra (V4-ENABLEMENT-PLAN.md §4) — set ONLY on capable chains ----
  /** IV4Quoter (single-hop `quoteExactInputSingle`/`quoteExactOutputSingle`). */
  v4Quoter?: string
  /** v4 PoolManager (singleton). Informational; the quoter reads it. */
  v4PoolManager?: string
  /** StateView (getSlot0 / getLiquidity). Informational for now. */
  v4StateView?: string
  /** canonical v4-capable Universal Router (executes V4_SWAP). HookSwap's own UR keeps v2/v3. */
  universalRouterV4?: string
  /**
   * Configured v4 single-hop pools for this chain (esp. HOOKED pools that the hookless
   * fee-tier enumeration can't discover — e.g. HOOK on Robinhood). Each is a full v4 PoolKey.
   * Only add entries whose fields are on-chain VERIFIED — never fabricate a pool key.
   */
  v4Pools?: Array<{ currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }>
  /** contracts fully live? HyperEVM v3 quoter still pending per deployments/hyperevm.json. */
  ready: boolean
  /**
   * Known-real tokens beyond the wrapped-native (e.g. a chain's seeded test token),
   * returned by /v1/swappable_tokens alongside wrappedNative. Real, static, verified
   * metadata only — we do NOT invent tokens here. Optional; omit until a chain has one.
   */
  seededTokens?: Array<{ address: string; symbol: string; name: string; decimals: number }>
}

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export const CHAINS: Record<number, ChainConfig> = {
  // ---- MegaETH (4326) — DEPLOYED ----
  4326: {
    chainId: 4326,
    name: 'megaeth',
    rpcEnvVar: 'WEB3_RPC_4326',
    publicRpc: 'https://mainnet.megaeth.com/rpc',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v2Router02: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3QuoterV2: '0x15cD41B273865feD20BC8B5cDF4423D7678ac78E',
    swapRouter02: '0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4',
    universalRouter: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
    multicall2: '0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4)
    v4Quoter: '0x94bdc671f0c35f44a1daa53143fd1f868d1623b9',
    v4PoolManager: '0xacb7e78fa05d562e0a5d3089ec896d57d057d38e',
    v4StateView: '0x726f84e1dfb8d375a365e0808282f40d52d3e4e8',
    universalRouterV4: '0x47837eb80db5908eabba9105626d9b348bea7b02',
    ready: true,
  },

  // ---- Robinhood (4663) — DEPLOYED ----
  4663: {
    chainId: 4663,
    name: 'robinhood',
    rpcEnvVar: 'WEB3_RPC_4663',
    publicRpc: 'https://rpc.mainnet.chain.robinhood.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v2Router02: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3QuoterV2: '0x15cD41B273865feD20BC8B5cDF4423D7678ac78E',
    swapRouter02: '0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4',
    universalRouter: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
    multicall2: '0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4). NOTE: this v4 UR (0x8876…C0904) is
    // itself a `minHopPriceX36` fork — its V4_SWAP handling must be verified on-chain before
    // RH v4 SWAP execution is enabled (see urCalldata.ts). v4 QUOTING is unaffected.
    v4Quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
    v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    v4StateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
    universalRouterV4: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
    // v4Pools (ON-CHAIN VERIFIED): the only live HOOK pool = USDG/HOOK. HOOK is NOT a hooked pool
    // (hooks=0x0), but its fee 650000 / tickSpacing 13000 are NON-STANDARD, so it is discoverable
    // ONLY via this configured entry (the {100/500/3000/10000} tier enumeration would miss it).
    // Near-illiquid today → dust quotes only until liquidity is seeded (expected).
    v4Pools: [
      {
        currency0: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG
        currency1: '0x85d4e6f147bfb5729378e451f32cf5287de75f97', // HOOK
        fee: 650000,
        tickSpacing: 13000,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    ],
    ready: true,
    // Seeded WETH/tHOOK v2 pool (contracts/seed/broadcast/SeedPools.s.sol/4663/run-latest.json).
    seededTokens: [{ address: '0x3b5a01Efc59f3465b8Eb04697f97CFE0BA700D9D', symbol: 'tHOOK', name: 'Test Hook Token', decimals: 18 }],
  },

  // ---- Ink (57073) — DEPLOYED ----
  57073: {
    chainId: 57073,
    name: 'ink',
    rpcEnvVar: 'WEB3_RPC_57073',
    publicRpc: 'https://rpc-gel.inkonchain.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v2Router02: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3QuoterV2: '0x15cD41B273865feD20BC8B5cDF4423D7678ac78E',
    swapRouter02: '0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4',
    universalRouter: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
    multicall2: '0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4)
    v4Quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
    v4PoolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
    v4StateView: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
    universalRouterV4: '0x112908dac86e20e7241b0927479ea3bf935d1fa0',
    ready: true,
  },

  // ---- XLayer (196) — DEPLOYED ----
  196: {
    chainId: 196,
    name: 'xlayer',
    rpcEnvVar: 'WEB3_RPC_196',
    publicRpc: 'https://xlayer.drpc.org',
    nativeSymbol: 'OKB',
    nativeDecimals: 18,
    wrappedNative: { address: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', symbol: 'WOKB', name: 'Wrapped OKB', decimals: 18 },
    v2Factory: '0xD1Cf664944173140AFc302c169eFD55c24966B45',
    v2Router02: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3Factory: '0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC',
    v3QuoterV2: '0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4',
    swapRouter02: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
    universalRouter: '0x6d8a0783213B3b06648DB3708a89732af3661005',
    multicall2: '0xA24cD888adAF42011a49d8Eaedb2Fe751C54e7E2',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4)
    v4Quoter: '0x8928074ca1b241d8ec02815881c1af11e8bc5219',
    v4PoolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
    v4StateView: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
    universalRouterV4: '0xda00ae15d3a71466517129255255db7c0c0956d3',
    ready: true,
  },

  // ---- HyperEVM (999) — v2+v3+UR DEPLOYED (v3 QuoterV2 now filled) ----
  999: {
    chainId: 999,
    name: 'hyperevm',
    rpcEnvVar: 'WEB3_RPC_999',
    publicRpc: 'https://rpc.hyperliquid.xyz/evm',
    nativeSymbol: 'HYPE',
    nativeDecimals: 18,
    wrappedNative: { address: '0x5555555555555555555555555555555555555555', symbol: 'WHYPE', name: 'Wrapped HYPE', decimals: 18 },
    v2Factory: '0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2',
    v2Router02: '0xbd817036c5bF69Cb27D3A342129e39f9f908577d',
    v3Factory: '0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A',
    v3QuoterV2: '0x3b5a01Efc59f3465b8Eb04697f97CFE0BA700D9D', // contracts/deployments/hyperevm.json (v3 periphery COMPLETE)
    swapRouter02: '0xD96fc9629AFaf325fCdd7F98Dc9b8dc2165adcBB',
    universalRouter: '0xD9d4795F2A12305a12C36455ADAD011F2D6143AB',
    multicall2: '0x15cD41B273865feD20BC8B5cDF4423D7678ac78E',
    permit2: PERMIT2,
    protocols: ['v2', 'v3'],
    ready: true, // full v2+v3 stack live (quoter filled).
  },

  // ---- Tempo (4217) — DEPLOYED; native gas paid in pathUSD (no native wrap in-app) ----
  4217: {
    chainId: 4217,
    name: 'tempo',
    rpcEnvVar: 'WEB3_RPC_4217',
    publicRpc: 'https://rpc.tempo.xyz',
    nativeSymbol: 'pathUSD',
    nativeDecimals: 18,
    // WETH9 param used by the router deploy; interface leaves tempo wrappedNativeCurrency=null.
    wrappedNative: { address: '0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    v2Factory: '0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4',
    v2Router02: '0x6d8a0783213B3b06648DB3708a89732af3661005',
    v3Factory: '0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3',
    v3QuoterV2: '0x15cD41B273865feD20BC8B5cDF4423D7678ac78E', // contracts/deployments/tempo.json (v3 periphery COMPLETE)
    swapRouter02: '0x3D30133F4d4A80684F02d8310faF572E3dc193b3',
    universalRouter: '0x62aE013cb2b232C20094B466C94bb39714eF661E',
    multicall2: '0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4)
    v4Quoter: '0x20e6487c371a2086f841ef453f85378223df4f4e',
    v4PoolManager: '0x33620f62c5b9b2086dd6b62f4a297a9f30347029',
    v4StateView: '0x21b954fba3f5ddebe77ef2d47a3100c066908b2a',
    universalRouterV4: '0xa2dc7d0266f0cc50b3eeaf36c9bfcecff1beea91',
    // quoter now filled; kept false because native gas = pathUSD (ERC-20), an
    // unusual model that needs on-chain validation before GA (see tempo.json).
    ready: false,
  },

  // ---- Stable (988) — DEPLOYED (canonical WgUSDT stack; contracts/deployments/stable.json) ----
  988: {
    chainId: 988,
    name: 'stable',
    rpcEnvVar: 'WEB3_RPC_988',
    publicRpc: 'https://stable-mainnet.rpc.sentio.xyz',
    // Native gas is USDT0 (18-dec native balance), NOT ETH; the wrapped-native / WETH9 arg is WgUSDT.
    nativeSymbol: 'USDT0',
    nativeDecimals: 18,
    wrappedNative: { address: '0x817997ca8394e26cce3de3a076a4889b27dbf9de', symbol: 'WgUSDT', name: 'Wrapped gUSDT', decimals: 18 },
    v2Factory: '0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA',
    v2Router02: '0xFd0Dd93a1b6157e68b0A491d94249720506dc787',
    v3Factory: '0xf486e625C892C0739A16A3A49B37fD52374B30CB',
    v3QuoterV2: '0x1b51C392DE4e3D3E0Ab066C5F89492ec0fCF21c3',
    swapRouter02: '0x5B57386e5F882e13946Ea4ef638c30d1f9b95D84',
    universalRouter: '0x79F291b64e46a5D2adbe150D58516cd19f49A323',
    multicall2: '0xa1aa9D69f59b20c0eF2936933D677680D6277351',
    permit2: PERMIT2,
    protocols: ['v2', 'v3'], // no v4 on 988 (stable.ts supportsV4:false)
    // ready:false until (1) the SOR fork adds 988 to HOOKSWAP_V2_FACTORY_ADDRESSES + static
    // subgraph providers (same fix pattern as XLayer, SOR commits 5b28db5/3acce5b) AND
    // (2) on-chain liquidity is seeded (no WgUSDT pool exists yet). Contracts + web SDK are wired;
    // this entry makes getChain(988) defined so the chain is served instead of crashing.
    ready: false,
  },

  // ---- Sepolia (11155111) — canonical Uniswap stack reused (testing) ----
  11155111: {
    chainId: 11155111,
    name: 'sepolia',
    rpcEnvVar: 'WEB3_RPC_11155111',
    publicRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    wrappedNative: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    // Canonical Uniswap Sepolia deployment (already wired in sdk-core; adapter serves via routing-api).
    v2Factory: '0xF62c03E08ada871A0bEb309762E260a7a6a880E6',
    v2Router02: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3',
    v3Factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
    v3QuoterV2: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
    swapRouter02: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    multicall2: '0xca11bde05977b3631167028862be2a173976ca11',
    permit2: PERMIT2,
    protocols: ['v2', 'v3', 'v4'],
    // canonical Uniswap v4 (V4-ENABLEMENT-PLAN.md §4). Sepolia = mandatory validation chain.
    v4Quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
    v4PoolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    v4StateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
    universalRouterV4: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    // v4Pools (ON-CHAIN VERIFIED): a real liquid native-ETH/0x389f pool — the v4 quoting
    // validation pool for Sepolia (proven: 0.001 ETH in -> 319171.74 out). fee 10000 / tickSpacing
    // 200 IS a standard tier (enumeration would also find it), but configured here for determinism.
    v4Pools: [
      {
        currency0: '0x0000000000000000000000000000000000000000', // native ETH
        currency1: '0x389f67f7ee5331a0e9e0857dcf6b6ce89291565c',
        fee: 10000,
        tickSpacing: 200,
        hooks: '0x0000000000000000000000000000000000000000',
      },
    ],
    ready: true,
  },
}

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAINS
}

/** Resolve the RPC URL for a chain: env override first, public fallback second. */
export function resolveRpcUrl(chain: ChainConfig): string {
  return process.env[chain.rpcEnvVar] || chain.publicRpc
}
