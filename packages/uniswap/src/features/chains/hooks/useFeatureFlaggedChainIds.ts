import { FeatureFlags, getFeatureFlag, useFeatureFlag } from '@universe/gating'
import { useMemo } from 'react'
import { CHAIN_ROLLOUT_FLAGS } from 'uniswap/src/features/chains/chainFeatureFlags'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { filterChainIdsByFeatureFlag } from 'uniswap/src/features/chains/utils'

function buildChainRolloutFlagMap(getFlagStatus: (flag: FeatureFlags) => boolean): {
  [key in UniverseChainId]?: boolean
} {
  const result: { [key in UniverseChainId]?: boolean } = {}
  for (const [chainId, flag] of Object.entries(CHAIN_ROLLOUT_FLAGS)) {
    result[Number(chainId) as UniverseChainId] = getFlagStatus(flag)
  }
  return result
}

export const getFeatureFlaggedChainIds = createGetFeatureFlaggedChainIds((flag) =>
  // HookSwap: Arc Testnet and Stable are force-enabled (do not depend on a Statsig gate).
  flag === FeatureFlags.ArcTestnet || flag === FeatureFlags.Stable ? true : getFeatureFlag(flag),
)

// Used to feature flag chains. If a chain is not included in the object, it is considered enabled by default.
export function useFeatureFlaggedChainIds(): UniverseChainId[] {
  const arcStatus = useFeatureFlag(FeatureFlags.Arc)
  const lineaStatus = useFeatureFlag(FeatureFlags.Linea)

  return useMemo(
    () =>
      createGetFeatureFlaggedChainIds((flag) => {
        switch (flag) {
          case FeatureFlags.Arc:
            return arcStatus
          case FeatureFlags.ArcTestnet:
            // HookSwap: Arc Testnet is force-enabled (does not depend on a Statsig gate).
            return true
          case FeatureFlags.Stable:
            // HookSwap: Stable is force-enabled (does not depend on a Statsig gate).
            return true
          case FeatureFlags.Linea:
            return lineaStatus
          default:
            return false
        }
      })(),
    [arcStatus, lineaStatus],
  )
}

export function createGetFeatureFlaggedChainIds(
  getFlagStatus: (flag: FeatureFlags) => boolean,
): () => UniverseChainId[] {
  return () => filterChainIdsByFeatureFlag(buildChainRolloutFlagMap(getFlagStatus))
}
