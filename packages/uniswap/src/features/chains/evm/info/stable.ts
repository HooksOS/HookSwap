import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { SwapConfigKey } from '@universe/gating'
import { ALL_NETWORKS_LOGO } from 'ui/src/assets'
import { ALL_APPS_CHAIN_SUPPORTED_APPS } from 'uniswap/src/features/chains/chainAppSupport'
import { CHAIN_ID_TO_URL_PARAM } from 'uniswap/src/features/chains/chainUrlParam'
import { DEFAULT_MS_BEFORE_WARNING, DEFAULT_NATIVE_ADDRESS } from 'uniswap/src/features/chains/evm/rpc'
import { buildChainTokens } from 'uniswap/src/features/chains/evm/tokens'
import {
  GqlChainId,
  NetworkLayer,
  RPCType,
  UniverseChainId,
  UniverseChainInfo,
} from 'uniswap/src/features/chains/types'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { ONE_SECOND_MS } from 'utilities/src/time/time'

// Stable / Stable Mainnet (988) — stablecoin-gas L1. USDT0 is both the native gas token
// (18-decimal native balance) and a 6-decimal ERC-20 over the same balance. The 6-decimal
// ERC-20 USDT0 (0x779D..3736, on-chain verified: symbol "USDT0", decimals 6) backs gas
// (gasTokenOverride), balances, and (future) routing. No HookSwap/Uniswap DEX contracts are
// deployed on 988 yet → supportsV4:false and the sdk-core addresses are zeroed; the chain
// connects + shows balances but advertises no routes.
const USDT0_ERC20_ADDRESS = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'

const stableTokens = buildChainTokens({
  stables: {
    USDT0: new Token(UniverseChainId.Stable, USDT0_ERC20_ADDRESS, 6, 'USDT0', 'USDT0'),
  },
  primaryStablecoin: 'USDT0',
})

export const STABLE_CHAIN_INFO = {
  id: UniverseChainId.Stable,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  testnet: false,
  assetRepoNetworkName: undefined,
  // Uniswap's hosted GraphQL backend does not index Stable.
  backendChain: {
    chain: GraphQLApi.Chain.UnknownChain as GqlChainId,
    backendSupported: false,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: DEFAULT_MS_BEFORE_WARNING,
  docs: 'https://stablescan.xyz',
  elementName: ElementName.ChainStable,
  explorer: {
    name: 'Stablescan',
    url: 'https://stablescan.xyz/',
  },
  interfaceName: 'stable',
  label: 'Stable',
  logo: ALL_NETWORKS_LOGO,
  name: 'Stable Mainnet',
  // Native gas token is USDT0 (18-decimal native balance), not ETH.
  nativeCurrency: {
    name: 'USDT0',
    symbol: 'USDT0',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS,
    logo: ALL_NETWORKS_LOGO,
  },
  // Stable pays gas in the 6-decimal ERC-20 USDT0, not a native ETH token.
  gasTokenOverride: stableTokens.USDT0,
  // No WETH-style wrapped native on Stable.
  wrappedNativeCurrency: null,
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 480,
  pendingTransactionsRetryOptions: undefined,
  // Public Stable RPC (chainId 0x3dc / 988 verified via eth_chainId).
  rpcUrls: {
    [RPCType.Default]: { http: ['https://rpc.stable.xyz'] },
    [RPCType.Public]: { http: ['https://rpc.stable.xyz'] },
    [RPCType.Interface]: { http: ['https://rpc.stable.xyz'] },
  },
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0],
  // No DEX contracts deployed on 988 → do not advertise v4 routing.
  supportsV4: false,
  supportsNFTs: false,
  tokens: stableTokens,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Stable],
  tradingApiPollingIntervalMs: ONE_SECOND_MS / 2,
  // Reuse Arc's Statsig gas keys (SwapConfigKey lives in the external @universe/gating
  // package and cannot add Stable-specific keys here).
  gasConfig: {
    send: {
      configKey: SwapConfigKey.ArcSendMinGasAmount,
      default: 100, // .0001 USDT0 (6-decimal units)
    },
    swap: {
      configKey: SwapConfigKey.ArcSwapMinGasAmount,
      default: 200, // .0002 USDT0 (6-decimal units)
    },
  },
} as const satisfies UniverseChainInfo
