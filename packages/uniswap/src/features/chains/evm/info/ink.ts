import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { ETH_LOGO } from 'ui/src/assets'
import { ALL_APPS_CHAIN_SUPPORTED_APPS } from 'uniswap/src/features/chains/chainAppSupport'
import { CHAIN_ID_TO_URL_PARAM } from 'uniswap/src/features/chains/chainUrlParam'
import {
  DEFAULT_MS_BEFORE_WARNING,
  DEFAULT_NATIVE_ADDRESS_LEGACY,
  withAlchemyPrimary,
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
    // TODO(HookSwap): verify Ink USDT0 address
    USDT0: new Token(UniverseChainId.Ink, '0x0200C29006150606B650577BBE7B6248F58470c1', 6, 'USD₮0', 'USDT0'),
  },
  primaryStablecoin: 'USDT0',
})

export const INK_CHAIN_INFO = {
  id: UniverseChainId.Ink,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  testnet: false,
  assetRepoNetworkName: 'ink',
  backendChain: {
    chain: GraphQLApi.Chain.UnknownChain as GqlChainId,
    backendSupported: false,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: DEFAULT_MS_BEFORE_WARNING,
  bridge: 'https://inkonchain.com/bridge',
  docs: 'https://docs.inkonchain.com/',
  elementName: ElementName.ChainInk,
  explorer: {
    name: 'Ink Explorer',
    url: 'https://explorer.inkonchain.com/',
  },
  interfaceName: 'ink',
  label: 'Ink',
  // TODO: add Ink logo asset
  logo: ETH_LOGO,
  name: 'Ink',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L2,
  blockTimeMs: 1000,
  pendingTransactionsRetryOptions: undefined,
  rpcUrls: {
    // Keyed Alchemy (ink-mainnet) leads when ALCHEMY_API_KEY is set; the verified
    // public Ink RPCs (each returns chainId 0xdef1 / 57073) stay as fallbacks.
    // rpc-gel/rpc-qnd are Ink's official endpoints (both block debug/trace);
    // *.drpc.org is on the CSP allowlist. NOTE: rpc-gel is a load balancer whose
    // reads and nonces lag — prefer rpc-qnd for broadcasts (see CLAUDE.md).
    // Default feeds third-party wallet-connector rpc maps — stays UNKEYED (see robinhood.ts).
    [RPCType.Default]: {
      http: [
        'https://rpc-gel.inkonchain.com',
        'https://rpc-qnd.inkonchain.com',
        'https://ink.drpc.org',
        'https://ink.gateway.tenderly.co',
        'https://57073.rpc.thirdweb.com',
      ],
    },
    [RPCType.Public]: {
      http: withAlchemyPrimary(UniverseChainId.Ink, [
        'https://rpc-gel.inkonchain.com',
        'https://rpc-qnd.inkonchain.com',
        'https://ink.drpc.org',
        'https://ink.gateway.tenderly.co',
        'https://57073.rpc.thirdweb.com',
      ]),
    },
    [RPCType.Interface]: {
      http: withAlchemyPrimary(UniverseChainId.Ink, [
        'https://rpc-gel.inkonchain.com',
        'https://rpc-qnd.inkonchain.com',
        'https://ink.drpc.org',
        'https://ink.gateway.tenderly.co',
        'https://57073.rpc.thirdweb.com',
      ]),
    },
  },
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0],
  supportsV4: true,
  supportsNFTs: false,
  tokens,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Ink],
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0x4200000000000000000000000000000000000006',
  },
  gasConfig: GENERIC_L2_GAS_CONFIG,
  tradingApiPollingIntervalMs: 250,
} as const satisfies UniverseChainInfo
