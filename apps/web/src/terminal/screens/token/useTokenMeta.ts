/**
 * HookSwap Terminal — per-token socials/description hook.
 *
 * Fetches a token's logo + socials (twitter / website / telegram / description) from the data-api's plain
 * REST route `/v1/token-meta` (a browser-friendly GET/JSON facade, NOT a Connect-RPC method). The values
 * are resolved server-side from a launchpad token's on-chain `metadataURI` JSON (see data-api `logos.ts`) —
 * so a token whose metadata JSON carries links gets them surfaced with no manual registry entry.
 *
 * DATA POLICY (no mock data): every field is optional and absent unless the token's metadata actually
 * contains it. A token with no launchpad metadata / no JSON / no links resolves to an empty object — an
 * honest "no socials", never a fabricated handle. The first request for an un-warmed token may return
 * nothing while the server resolves in the background; React-Query refetch picks up the resolved value.
 */
import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { config } from 'uniswap/src/config'
import { getUniswapServiceUrls } from 'uniswap/src/constants/urls'

/** Socials/description for a token, as served by `/v1/token-meta`. Every field optional. */
export interface TokenMeta {
  chainId: number
  address: string
  logoUrl?: string
  description?: string
  twitter?: string
  website?: string
  telegram?: string
}

function tokenMetaBaseUrl(): string {
  return getUniswapServiceUrls(config).dataApiBaseUrlV2
}

/**
 * React-Query hook for a token's socials/description. Disabled until a chainId + address are known.
 * A short `staleTime` plus one delayed refetch let the server-side background resolve land.
 */
export function useTokenMeta(chainId: number | undefined, address: string | undefined): UseQueryResult<TokenMeta> {
  return useQuery({
    queryKey: ['hookswap-token-meta', chainId, address?.toLowerCase()],
    enabled: chainId !== undefined && Boolean(address),
    queryFn: async (): Promise<TokenMeta> => {
      const url = `${tokenMetaBaseUrl()}/v1/token-meta?chainId=${chainId}&address=${address}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`token-meta request failed: ${res.status}`)
      }
      const json = (await res.json()) as Partial<TokenMeta>
      return {
        chainId: json.chainId ?? (chainId as number),
        address: json.address ?? (address as string),
        logoUrl: json.logoUrl || undefined,
        description: json.description || undefined,
        twitter: json.twitter || undefined,
        website: json.website || undefined,
        telegram: json.telegram || undefined,
      }
    },
    staleTime: 60_000,
    // One background retry after the server warms its cache, so socials appear without a manual reload.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const d = query.state.data
      const hasAny = d && (d.twitter || d.website || d.telegram || d.description)
      return hasAny ? false : 8_000
    },
  })
}
