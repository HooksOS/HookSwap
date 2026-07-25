import { PlainMessage, toPlainMessage } from '@bufbuild/protobuf'
import { skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  GetAddressesRequest,
  GetAddressesResponse,
  GetAddressRequest,
  GetAddressResponse,
  type UseQueryApiHelperHookArgs,
} from '@universe/api'
import { unitagsApiClient } from 'uniswap/src/data/apiClients/unitagsApi/UnitagsApiClient'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'
import { persistableQueryOptions } from 'utilities/src/reactQuery/persistableQueryOptions'
import { MAX_REACT_QUERY_CACHE_TIME_MS, ONE_MINUTE_MS } from 'utilities/src/time/time'

export function useUnitagsAddressQuery({
  params,
  ...rest
}: UseQueryApiHelperHookArgs<PlainMessage<GetAddressRequest>, PlainMessage<GetAddressResponse>>): UseQueryResult<
  PlainMessage<GetAddressResponse>
> {
  const queryKey = [ReactQueryCacheKey.UnitagsApi, 'address', params]
  // HookSwap dedupe (2026-07): unitag (Uniswap's ENS-like username) reverse lookup calls
  // Uniswap's UnitagService on the entry gateway
  // (entry-gateway.backend-prod.api.uniswap.org/uniswap.unitag.v1.UnitagService/GetAddress) —
  // not a HookSwap service. Always skip the query so no request reaches *.uniswap.org
  // (addresses simply resolve to no unitag).
  return useQuery(
    persistableQueryOptions<PlainMessage<GetAddressResponse>>({
      queryKey,
      queryFn: skipToken,
      staleTime: ONE_MINUTE_MS,
      gcTime: MAX_REACT_QUERY_CACHE_TIME_MS,
      ...rest,
    }),
  )
}

export function useUnitagsAddressesQuery({
  params,
  ...rest
}: UseQueryApiHelperHookArgs<PlainMessage<GetAddressesRequest>, PlainMessage<GetAddressesResponse>>): UseQueryResult<
  PlainMessage<GetAddressesResponse>
> {
  const queryKey = [ReactQueryCacheKey.UnitagsApi, 'addresses', params]

  return useQuery(
    persistableQueryOptions<PlainMessage<GetAddressesResponse>>({
      queryKey,
      queryFn: params
        ? async (): Promise<PlainMessage<GetAddressesResponse>> =>
            toPlainMessage(new GetAddressesResponse(await unitagsApiClient.fetchUnitagsByAddresses(params)))
        : skipToken,
      staleTime: ONE_MINUTE_MS,
      gcTime: MAX_REACT_QUERY_CACHE_TIME_MS,
      ...rest,
    }),
  )
}
