import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { SwapConfigKey } from '@universe/gating'
import { ARC_LOGO } from 'ui/src/assets'
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

// Arc Testnet (5042002) — sibling of Arc mainnet (5042). Same gas model: USDC is both
// the native gas token (18-decimal native balance) and a 6-decimal ERC-20 over the same
// balance. The ERC-20 precompile at 0x3600..0000 is on-chain-verified to have code on
// 5042002 (eth_getCode), so it backs gas (gasTokenOverride), balances, and (future) routing.
// No HookSwap/Uniswap DEX contracts are deployed on 5042002 yet → supportsV4:false and the
// sdk-core addresses are zeroed; the chain connects + shows balances but advertises no routes.
const USDC_ERC20_ADDRESS = '0x3600000000000000000000000000000000000000'

const arcTestnetTokens = buildChainTokens({
  stables: {
    USDC: new Token(UniverseChainId.ArcTestnet, USDC_ERC20_ADDRESS, 6, 'USDC', 'USD Coin'),
  },
  primaryStablecoin: 'USDC',
})

export const ARC_TESTNET_CHAIN_INFO = {
  id: UniverseChainId.ArcTestnet,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  testnet: true,
  assetRepoNetworkName: 'arc',
  // Uniswap's hosted GraphQL backend does not index Arc Testnet.
  backendChain: {
    chain: GraphQLApi.Chain.UnknownChain as GqlChainId,
    backendSupported: false,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: DEFAULT_MS_BEFORE_WARNING,
  docs: 'https://docs.arc.network/',
  elementName: ElementName.ChainArcTestnet,
  explorer: {
    name: 'Arcscan',
    url: 'https://testnet.arcscan.app/',
  },
  interfaceName: 'arc_testnet',
  label: 'Arc Testnet',
  logo: ARC_LOGO,
  name: 'Arc Testnet',
  // Native gas token is USDC (18-decimal native balance), not ETH.
  nativeCurrency: {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS,
    logo: ARC_LOGO,
  },
  // Arc pays gas in the 6-decimal ERC-20 USDC, not a native ETH token.
  gasTokenOverride: arcTestnetTokens.USDC,
  // No WETH-style wrapped native on Arc.
  wrappedNativeCurrency: null,
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 480,
  pendingTransactionsRetryOptions: undefined,
  // Public Arc Testnet RPC (chainId 0x4cef52 / 5042002 verified via eth_chainId).
  rpcUrls: {
    [RPCType.Default]: { http: ['https://rpc.testnet.arc.network'] },
    [RPCType.Public]: { http: ['https://rpc.testnet.arc.network'] },
    [RPCType.Interface]: { http: ['https://rpc.testnet.arc.network'] },
  },
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0],
  // No DEX contracts deployed on 5042002 → do not advertise v4 routing.
  supportsV4: false,
  supportsNFTs: false,
  tokens: arcTestnetTokens,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.ArcTestnet],
  tradingApiPollingIntervalMs: ONE_SECOND_MS / 2,
  // Reuse Arc mainnet's Statsig gas keys (SwapConfigKey lives in the external @universe/gating
  // package and cannot add Arc-Testnet-specific keys here).
  gasConfig: {
    send: {
      configKey: SwapConfigKey.ArcSendMinGasAmount,
      default: 100, // .0001 USDC (6-decimal units)
    },
    swap: {
      configKey: SwapConfigKey.ArcSwapMinGasAmount,
      default: 200, // .0002 USDC (6-decimal units)
    },
  },
} as const satisfies UniverseChainInfo
