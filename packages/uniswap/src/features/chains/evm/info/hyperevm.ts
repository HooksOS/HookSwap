import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { ETH_LOGO } from 'ui/src/assets'
import { ALL_APPS_CHAIN_SUPPORTED_APPS } from 'uniswap/src/features/chains/chainAppSupport'
import { CHAIN_ID_TO_URL_PARAM } from 'uniswap/src/features/chains/chainUrlParam'
import {
  DEFAULT_MS_BEFORE_WARNING,
  DEFAULT_NATIVE_ADDRESS_LEGACY,
} from 'uniswap/src/features/chains/evm/rpc'
import { buildChainTokens } from 'uniswap/src/features/chains/evm/tokens'
import { GENERIC_L2_GAS_CONFIG } from 'uniswap/src/features/chains/gasDefaults'
import {
  GqlChainId,
  NetworkLayer,
  RPCType,
  UniverseChainId,
  UniverseChainInfo,
} from 'uniswap/src/features/chains/types'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { ElementName } from 'uniswap/src/features/telemetry/constants'

const tokens = buildChainTokens({
  stables: {
    USDT0: new Token(UniverseChainId.HyperEvm, '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 6, 'USDT0', 'USDT0'),
  },
  primaryStablecoin: 'USDT0',
})

// Verified-live public HyperEVM RPCs, in failover order (each returns chainId 0x3e7 / 999).
// PUBLIC ONLY — no keyed provider (see evm/rpc.ts). The OFFICIAL endpoint
// rpc.hyperliquid.xyz/evm is LAST on purpose: it caps at ~100 req/min per IP and
// 429s hard under normal app load, so it is the last-resort hop, not the first.
// Dropped: public.1rpc.io/hyperliquid and hyperliquid.api.onfinality.io/evm/public
// (429'd on ~18/20 sequential requests when measured).
const HYPEREVM_PUBLIC_RPC_URLS = [
  'https://hyperliquid.drpc.org',
  'https://rpc.hyperlend.finance',
  'https://hyperliquid.rpc.blxrbdn.com',
  'https://hyperliquid-json-rpc.stakely.io',
  'https://999.rpc.thirdweb.com',
  'https://rpc.hyperliquid.xyz/evm',
]

export const HYPEREVM_CHAIN_INFO = {
  id: UniverseChainId.HyperEvm,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  testnet: false,
  assetRepoNetworkName: 'hyperevm',
  backendChain: {
    chain: GraphQLApi.Chain.UnknownChain as GqlChainId,
    backendSupported: false,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: DEFAULT_MS_BEFORE_WARNING,
  bridge: 'https://app.hyperliquid.xyz/',
  docs: 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm',
  elementName: ElementName.ChainHyperEVM,
  explorer: {
    name: 'HyperEVMScan',
    url: 'https://hyperevmscan.io/',
  },
  interfaceName: 'hyperevm',
  label: 'HyperEVM',
  // TODO: add HYPE logo asset
  logo: ETH_LOGO,
  name: 'HyperEVM',
  nativeCurrency: {
    name: 'Hyperliquid HYPE',
    symbol: 'HYPE',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 2000,
  pendingTransactionsRetryOptions: undefined,
  // PUBLIC RPCs ONLY, ordered for client-side failover. HyperEVM is in
  // PUBLIC_RPC_ONLY_CHAINS (providers/unirpcOnlyChains.ts).
  rpcUrls: {
    // Default also feeds third-party wallet-connector rpc maps (cookieless in-page clients).
    [RPCType.Default]: { http: HYPEREVM_PUBLIC_RPC_URLS },
    [RPCType.Public]: { http: HYPEREVM_PUBLIC_RPC_URLS },
    [RPCType.Interface]: { http: HYPEREVM_PUBLIC_RPC_URLS },
  },
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0],
  supportsV4: false,
  supportsNFTs: false,
  tokens,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.HyperEvm],
  wrappedNativeCurrency: {
    name: 'Wrapped HYPE',
    symbol: 'WHYPE',
    decimals: 18,
    address: '0x5555555555555555555555555555555555555555',
  },
  gasConfig: GENERIC_L2_GAS_CONFIG,
  tradingApiPollingIntervalMs: 250,
} as const satisfies UniverseChainInfo
