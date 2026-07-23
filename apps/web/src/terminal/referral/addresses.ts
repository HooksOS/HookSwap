/**
 * HookSwap Referral Router — deployed addresses per chain.
 *
 * Deployed 2026-07-05 with defaultFeeBps = 30 (0.3%), feeAdmin = deployer.
 * Fee is adjustable on-chain via `setDefaultFeeBps` (owner), capped at 1%.
 * Consumed by the referral dashboard + `?ref=` swap routing (to be built).
 */
import type { UniverseChainId } from 'uniswap/src/features/chains/types'

export type Address = `0x${string}`

/** chainId → HookSwapReferralRouter address. Unset chains have no router yet. */
export const REFERRAL_ROUTER_ADDRESSES: Partial<Record<number, Address>> = {
  196: '0xB5A7BF488f2407479E116f713f116546F67c803b', // XLayer
  4217: '0x0E88A920A522d2e858B5fB0e896F228f4619E0a6', // Tempo
  999: '0x250C3448278F7B71E3e9B641f2EfEb6074820e25', // HyperEVM
  57073: '0x62aE013cb2b232C20094B466C94bb39714eF661E', // Ink
  4663: '0x6d8a0783213B3b06648DB3708a89732af3661005', // Robinhood
  4326: '0xB5A7BF488f2407479E116f713f116546F67c803b', // MegaETH
  11155111: '0xfEb3eA6212761c1891389e77ee5Bf27c3b385E1A', // Sepolia
  988: '0x7EFFe9DD68035f43ad43aE6C31bc1a47Ab4579D0', // Stable (contracts/deployments/stable.json .suite.referralRouter, on-chain code verified)
}

export function getReferralRouter(chainId?: number | UniverseChainId): Address | undefined {
  return chainId ? REFERRAL_ROUTER_ADDRESSES[chainId] : undefined
}
