import type { RestPriceClient, TokenIdentifier, TokenPriceData } from '@universe/prices'

/**
 * Creates a RestPriceClient.
 *
 * HookSwap dedupe (2026-07): the upstream implementation called
 * DataApiService/GetTokenPrices, which is ONLY registered on Uniswap's entry gateway
 * (entry-gateway.backend-prod.api.uniswap.org/.../DataApiService/GetTokenPrices) — a
 * Uniswap backend, not a HookSwap service. It is stubbed to return an empty price map
 * so no request is ever issued to *.uniswap.org. USD pricing across the HookSwap
 * Terminal comes from HookSwap's own data-api (data.hookswap.org), not this client.
 */
export function createRestPriceClient(_options?: { preferQuotePrices?: boolean }): RestPriceClient {
  return {
    async getTokenPrices(_tokens: TokenIdentifier[]): Promise<Map<string, TokenPriceData>> {
      return new Map<string, TokenPriceData>()
    },
  }
}
