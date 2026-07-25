import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { type ScreenRequest, type ScreenResponse, type UseQueryApiHelperHookArgs } from '@universe/api'
import { ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export function useTrmScreenQuery({
  params,
  ...rest
}: UseQueryApiHelperHookArgs<ScreenRequest, ScreenResponse>): UseQueryResult<ScreenResponse> {
  const queryKey = [ReactQueryCacheKey.Compliance, params]

  // HookSwap dedupe (2026-07): the TRM address screen calls Uniswap's compliance
  // service (entry-gateway.backend-prod.api.uniswap.org/.../ScreenAddress) — not a
  // HookSwap service. Short-circuit to a resolved "not blocked" result so no request
  // is ever issued to *.uniswap.org and the address is allowed (never blocked). This
  // is a no-op that ALLOWS, not a blocked fetch.
  return useQuery<ScreenResponse>({
    queryKey,
    queryFn: async (): Promise<ScreenResponse> => ({ block: false } as ScreenResponse),
    ...rest,
  })
}
