import { Token } from '@uniswap/sdk-core'
import { GraphQLApi, TradingApi } from '@universe/api'
import { ETH_LOGO, ROBINHOOD_LOGO } from 'ui/src/assets'
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
    USDG: new Token(
      UniverseChainId.Robinhood,
      '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      6,
      'USDG',
      'Global Dollar',
    ),
  },
  primaryStablecoin: 'USDG',
})

// The ONLY working public Robinhood Chain RPC (returns chainId 0x1237 / 4663).
// PUBLIC ONLY — no keyed provider (see evm/rpc.ts).
// ⛔ BLACKLISTED, do not re-add — both answer HTTP 200 with WRONG data:
//   https://robinhood.drpc.org — returns the correct eth_chainId but replies
//     "does not exist" for every other method, so it passes a naive health check
//     and then fails every real read.
//   https://robinhoodchain.blockscout.com/api/eth-rpc — replies HTTP 429 with
//     `result: null` and NO `error` field, which JSON-RPC clients read as a
//     successful empty result (phantom "no balance" / "not deployed" states).
const ROBINHOOD_PUBLIC_RPC_URLS = [
  'https://rpc.mainnet.chain.robinhood.com',
]

export const ROBINHOOD_CHAIN_INFO = {
  id: UniverseChainId.Robinhood,
  platform: Platform.EVM,
  supportedApps: ALL_APPS_CHAIN_SUPPORTED_APPS,
  testnet: false,
  assetRepoNetworkName: 'robinhood',
  backendChain: {
    chain: GraphQLApi.Chain.Robinhood as GqlChainId,
    backendSupported: true,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 1,
  blockWaitMsBeforeWarning: DEFAULT_MS_BEFORE_WARNING,
  bridge: 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain',
  docs: 'https://docs.robinhood.com/chain/',
  elementName: ElementName.ChainRobinhood,
  explorer: {
    name: 'Robinscan',
    url: 'https://robinscan.io/',
  },
  interfaceName: 'robinhood',
  label: 'Robinhood Chain',
  logo: ROBINHOOD_LOGO,
  name: 'Robinhood Chain',
  nativeCurrency: {
    name: 'Robinhood ETH',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L2,
  blockTimeMs: 100,
  pendingTransactionsRetryOptions: undefined,
  // HookSwap has no Uniswap-hosted UniRPC gateway access, so `getUniRpcEndpointUrl()`
  // (Uniswap's `entry-gateway`) 401s/CORS-fails for every browser-side on-chain read
  // (wagmi's public client uses RPCType.Public — see apps/web/src/connection/wagmiConfig.ts)
  // — this silently broke Locker/Referrals ("Failed to load") despite the contracts
  // and RPC working fine directly (verified via `cast call`). Fix: real public RPC on
  // every RPCType slot, mirroring the already-correct ink.ts/hyperevm.ts pattern.
  // KNOWN LIMITATION: the official RH RPC rate-limits under load and there is no second
  // usable endpoint to fail over to, so RH is the one chain with no redundancy. A paid
  // RH endpoint is the only real fix — do NOT paper over it with a blacklisted mirror.
  // PUBLIC RPC ONLY. Robinhood Chain has exactly ONE working public endpoint, so
  // there is no failover set to give it — see ROBINHOOD_PUBLIC_RPC_URLS above for the
  // endpoints that were removed and why they must not come back.
  rpcUrls: {
    // Default also feeds third-party wallet-connector rpc maps (WalletConnect/Binance
    // read default.http[0] from a cookieless in-page client), so it must stay unkeyed.
    [RPCType.Default]: { http: ROBINHOOD_PUBLIC_RPC_URLS },
    [RPCType.Public]: { http: ROBINHOOD_PUBLIC_RPC_URLS },
    [RPCType.Interface]: { http: ROBINHOOD_PUBLIC_RPC_URLS },
  },
  supportedURVersions: [TradingApi.UniversalRouterVersion._2_0, TradingApi.UniversalRouterVersion._2_1_1],
  supportsV4: true,
  supportsNFTs: true,
  tokens,
  urlParam: CHAIN_ID_TO_URL_PARAM[UniverseChainId.Robinhood],
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  },
  gasConfig: GENERIC_L2_GAS_CONFIG,
  tradingApiPollingIntervalMs: 250,
} as const satisfies UniverseChainInfo
