import { ConnectError } from '@connectrpc/connect'
import { useQuery } from '@connectrpc/connect-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { listRwas } from '@uniswap/client-data-api/dist/data/v1/api-DataApiService_connectquery'
import type { ListRwasResponse } from '@uniswap/client-data-api/dist/data/v1/api_pb'
import { entryGatewayProdPostTransport } from 'uniswap/src/data/rest/base'
import { ONE_MINUTE_MS } from 'utilities/src/time/time'

export function useListRwasQuery({
  chainIds,
  includeCommodities,
  enabled = true,
}: {
  chainIds: number[]
  /** Opt-in: include standalone commodity entries (no issuer structure). Commodity-free callers (TDP whitelist,
   *  geo-block) omit it; only the search index passes `true`. proto3 normalizes the connect-query key, so an
   *  omitted bool defaults to `false` — the index's `true` is what gives it a distinct key + cache entry. */
  includeCommodities?: boolean
  enabled?: boolean
}): UseQueryResult<ListRwasResponse, ConnectError> {
  // HookSwap dedupe (2026-07): ListRwas queries Uniswap's DataApiService on the entry
  // gateway (entry-gateway.backend-prod.api.uniswap.org/.../DataApiService/ListRwas) —
  // not a HookSwap service, and HookSwap does not surface Uniswap's RWA index. Force the
  // query disabled so it never fires to *.uniswap.org; consumers see an empty RWA list.
  // `enabled` from the caller is intentionally ignored (kept for call-site compatibility).
  void enabled
  return useQuery(listRwas, includeCommodities === undefined ? { chainIds } : { chainIds, includeCommodities }, {
    transport: entryGatewayProdPostTransport,
    enabled: false,
    staleTime: 5 * ONE_MINUTE_MS,
    gcTime: 30 * ONE_MINUTE_MS,
  })
}
