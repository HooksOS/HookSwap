import { CurrencyAmount } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { isWebApp, isE2eTestEnv } from '@universe/environment'
import { SwapConfigKey } from '@universe/gating'
import { ETH_LOGO, ETHEREUM_LOGO } from 'ui/src/assets'
import { config } from 'uniswap/src/config'
import { ALL_APPS_CHAIN_SUPPORTED_APPS } from 'uniswap/src/features/chains/chainAppSupport'
import { CHAIN_ID_TO_URL_PARAM } from 'uniswap/src/features/chains/chainUrlParam'
import {
  DEFAULT_MS_BEFORE_WARNING,
  DEFAULT_NATIVE_ADDRESS_LEGACY,
  getPlaywrightRpcUrls,
  getQuicknodeEndpointUrl,
  getUniRpcEndpointUrl,
} from 'uniswap/src/features/chains/evm/rpc'
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
import { buildDAI, buildUSDC, buildUSDT } from 'uniswap/src/features/tokens/stablecoin'
import { ONE_MINUTE_MS } from 'utilities/src/time/time'
import { mainnet, sepolia } from 'wagmi/chains'

const tokens = buildChainTokens({
  stables: {
    USDC: buildUSDC('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', UniverseChainId.Mainnet),
    USDT: buildUSDT('0xdAC17F958D2ee523a2206206994597C13D831ec7', UniverseChainId.Mainnet),
    DAI: buildDAI('0x6B175474E89094C44Da98b954EedeAC495271d0F', UniverseChainId.Mainnet),
  },
})

const LOCAL_MAINNET_PLAYWRIGHT_RPC_URL = 'http://127.0.0.1:8545'

export const MAINNET_CHAIN_INFO = {
  ...mainnet,
  id: UniverseChainId.Mainnet,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  assetRepoNetworkName: 'ethereum',
  backendChain: {
    chain: GraphQLApi.Chain.Ethereum as GqlChainId,
    backendSupported: true,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: isWebApp ? DEFAULT_MS_BEFORE_WARNING : ONE_MINUTE_MS,
  bridge: undefined,
  docs: 'https://docs.uniswap.org/',
  elementName: ElementName.ChainEthereum,
  explorer: {
    name: 'Etherscan',
    url: 'https://etherscan.io/',
  },
  openseaName: 'ethereum',
  interfaceName: 'mainnet',
  label: 'Ethereum',
  logo: ETHEREUM_LOGO,
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    explorerLink: 'https://etherscan.io/chart/etherprice',
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 12000,
  pendingTransactionsRetryOptions: undefined,
  rpcUrls: isE2eTestEnv()
    ? getPlaywrightRpcUrls(LOCAL_MAINNET_PLAYWRIGHT_RPC_URL)
    : {
        [RPCType.Private]: {
          http: ['https://rpc.mevblocker.io/?referrer=uniswapwallet'],
        },
        [RPCType.Public]: {
          http: [getUniRpcEndpointUrl(UniverseChainId.Mainnet)],
        },
        // Default feeds the wallet-connector rpc maps (WalletConnect/Binance read
        // rpcUrls.default.http[0] from a cookieless in-page client), so it must be an
        // unkeyed endpoint that is CORS- and CSP-allowed. Keyed QuickNode/Infura URLs
        // leak the key into third-party traffic; rpc.ankr.com now returns "Unauthorized"
        // for anonymous reads. *.drpc.org is on the CSP allowlist and serves these
        // chains unauthenticated.
        [RPCType.Default]: {
          http: ['https://eth.drpc.org', 'https://eth-mainnet.public.blastapi.io'],
        },
        [RPCType.Fallback]: {
          http: ['https://rpc.ankr.com/eth', 'https://eth-mainnet.public.blastapi.io'],
        },
        [RPCType.Interface]: {
          http: [`https://mainnet.infura.io/v3/${config.infuraKey}`, getQuicknodeEndpointUrl(UniverseChainId.Mainnet)],
        },
      },
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Mainnet],
  statusPage: undefined,
  spotPriceStablecoinAmountOverride: CurrencyAmount.fromRawAmount(tokens.USDC, 100_000e6),
  tokens,
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0, TradingApi.UniversalRouterVersion._2_1_1],
  supportsV4: true,
  supportsNFTs: true,
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  },
  gasConfig: {
    send: {
      configKey: SwapConfigKey.EthSendMinGasAmount,
      default: 20, // .002 ETH
    },
    swap: {
      configKey: SwapConfigKey.EthSwapMinGasAmount,
      default: 150, // .015 ETH
    },
  },
  tradingApiPollingIntervalMs: 500,
  acrossProtocolAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
} as const satisfies UniverseChainInfo

const testnetTokens = buildChainTokens({
  stables: {
    USDC: buildUSDC('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', UniverseChainId.Sepolia),
  },
})

// Verified-live public Sepolia RPCs, in failover order (each returns chainId 0xaa36a7 / 11155111).
// PUBLIC ONLY — no keyed provider (see evm/rpc.ts).
// ⛔ BLACKLISTED, do not re-add: https://ethereum-sepolia-rpc.publicnode.com — it 403s on
// eth_getLogs and on archive eth_call, so it works only for `eth_call` at latest and silently
// breaks log/history reads while looking healthy.
const SEPOLIA_PUBLIC_RPC_URLS = [
  'https://sepolia.drpc.org',
  'https://sepolia.gateway.tenderly.co',
  'https://11155111.rpc.thirdweb.com',
]

export const SEPOLIA_CHAIN_INFO = {
  ...sepolia,
  id: UniverseChainId.Sepolia,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  assetRepoNetworkName: undefined,
  backendChain: {
    chain: GraphQLApi.Chain.EthereumSepolia as GqlChainId,
    backendSupported: true,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: undefined,
  bridge: undefined,
  docs: 'https://docs.uniswap.org/',
  elementName: ElementName.ChainSepolia,
  explorer: {
    name: 'Etherscan',
    url: 'https://sepolia.etherscan.io/',
  },
  interfaceName: 'sepolia',
  label: 'Sepolia',
  logo: ETHEREUM_LOGO,
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    explorerLink: 'https://sepolia.etherscan.io/chart/etherprice',
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L1,
  blockTimeMs: 12000,
  pendingTransactionsRetryOptions: undefined,
  // PUBLIC RPCs ONLY, ordered for client-side failover. HookSwap has no UniRPC gateway
  // session, so the gateway URL 401s / CORS-fails from the browser (Sepolia is in
  // PUBLIC_RPC_ONLY_CHAINS) — the perps MarketRegistry directory and every anonymous read
  // depend on these resolving to real, CORS-enabled endpoints.
  rpcUrls: {
    [RPCType.Public]: { http: SEPOLIA_PUBLIC_RPC_URLS },
    // Default also feeds third-party wallet-connector rpc maps (cookieless in-page clients).
    [RPCType.Default]: { http: SEPOLIA_PUBLIC_RPC_URLS },
    [RPCType.Fallback]: { http: SEPOLIA_PUBLIC_RPC_URLS },
    [RPCType.Interface]: { http: SEPOLIA_PUBLIC_RPC_URLS },
  },
  spotPriceStablecoinAmountOverride: CurrencyAmount.fromRawAmount(testnetTokens.USDC, 100e6),
  tokens: testnetTokens,
  statusPage: undefined,
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0, TradingApi.UniversalRouterVersion._2_1_1],
  supportsV4: true,
  supportsNFTs: false,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Sepolia],
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
  },
  gasConfig: {
    send: {
      configKey: SwapConfigKey.EthSendMinGasAmount,
      default: 20, // .002 ETH
    },
    swap: {
      configKey: SwapConfigKey.EthSwapMinGasAmount,
      default: 150, // .015 ETH
    },
  },
  tradingApiPollingIntervalMs: 500,
} as const satisfies UniverseChainInfo
