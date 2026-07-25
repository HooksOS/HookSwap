import { Transport } from '@connectrpc/connect'
import { ConnectTransportOptions } from '@connectrpc/connect-web'
import { getTransport } from '@universe/api'
import { tryProvideSession } from '@universe/api'
import { isWebApp } from '@universe/environment'
import { SessionGateSource, type Session } from '@universe/sessions'
import { config } from 'uniswap/src/config'
import { getUniswapServiceUrls } from 'uniswap/src/constants/urls'
import { BASE_UNISWAP_HEADERS } from 'uniswap/src/data/apiClients/createUniswapFetchClient'

export function createConnectTransportWithDefaults({
  options = {},
  getBaseUrlOverride,
  getSession,
  source,
}: {
  options?: Partial<ConnectTransportOptions>
  getBaseUrlOverride?: () => string
  getSession?: () => Session | null
  /** Telemetry identifier for the gate's emitted events. */
  source?: string
}): Transport {
  return getTransport({
    getBaseUrl: getBaseUrlOverride ?? ((): string => getUniswapServiceUrls(config).apiBaseUrlV2),
    getHeaders: () => BASE_UNISWAP_HEADERS,
    options,
    getSession,
    source,
  })
}

/**
 * Connectrpc transports for Uniswap REST BE service
 */
export const uniswapGetTransport = createConnectTransportWithDefaults({ options: { useHttpGet: true } })
export const uniswapPostTransport = createConnectTransportWithDefaults({})

// The string arg to pass to the BE for chainId to get data for all networks
export const ALL_NETWORKS_ARG = 'ALL_NETWORKS'

/**
 * To add a ConnectRPC hook for a new BE client service:
 * 1. Create a new file in the `data/rest` directory with a name matching the service
 * 2. Copy the below template replacing `newService` with the service name
 *   a. The client service, Request, and Response types are imported from the generated client
 *   b. You can use exploreStats as a reference for how to structure the hook
 * export function useNewServiceQuery(
    input?: PartialMessage<NewServiceRequest>,
  ): UseQueryResult<NewServiceResponse, ConnectError> {
    return useQuery(newService, input, { transport: uniswapGetTransport })
  }
 */

export const dataApiGetTransport = createConnectTransportWithDefaults({
  options: { useHttpGet: true },
  getBaseUrlOverride: () => getUniswapServiceUrls(config).dataApiBaseUrlV2,
})

export const dataApiPostTransport = createConnectTransportWithDefaults({
  getBaseUrlOverride: () => getUniswapServiceUrls(config).dataApiBaseUrlV2,
})

/**
 * ConnectRPC transport for services behind the entry-gateway (sessions-authenticated).
 *
 * HookSwap dedupe (2026-07): the upstream base URL was Uniswap's entry gateway
 * (getEntryGatewayUrl -> entry-gateway.backend-prod.api.uniswap.org). Every service on
 * it (unitag, RWA index, earn vaults, UniRPC gas service, portfolio chart, …) is a
 * Uniswap backend that does not serve HookSwap, not a HookSwap service. Repoint the base
 * to HookSwap's own data-api (data.hookswap.org) — mirroring the getWalletBalances
 * repoint — so NONE of these connectrpc calls can ever reach *.uniswap.org. Unimplemented
 * endpoints simply 404 on the HookSwap host (the same failing behavior as before, minus
 * the Uniswap dependency). The genuinely-used data path already runs on the separate
 * dataApiGet/PostTransport, which is unaffected.
 */
export const entryGatewayPostTransport = createConnectTransportWithDefaults({
  // Web uses cookies (credentials: 'include'), while mobile/extension use session headers (via getTransport interceptor).
  options: isWebApp ? { credentials: 'include' } : undefined,
  getBaseUrlOverride: () => getUniswapServiceUrls(config).dataApiBaseUrlV2,
  getSession: tryProvideSession,
  source: SessionGateSource.ConnectRpcEntryGateway,
})

/**
 * Historically pinned to the prod entry gateway. HookSwap dedupe (2026-07): repointed to
 * HookSwap's data-api for the same reason as entryGatewayPostTransport above — never
 * *.uniswap.org.
 */
export const entryGatewayProdPostTransport = createConnectTransportWithDefaults({
  // Web uses cookies (credentials: 'include'), while mobile/extension use session headers (via getTransport interceptor).
  options: isWebApp ? { credentials: 'include' } : undefined,
  getBaseUrlOverride: () => getUniswapServiceUrls(config).dataApiBaseUrlV2,
  getSession: tryProvideSession,
  source: SessionGateSource.ConnectRpcEntryGatewayProd,
})
