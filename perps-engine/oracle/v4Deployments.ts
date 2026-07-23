// v4 StateView / PoolManager fallback table, keyed per (protocol, chainId).
//
// Config is ALWAYS authoritative: a V4Source may carry its own `stateView` /
// `poolManager` and that wins. This table is only the fallback for the shipped
// HookSwap chains so a market entry can omit the addresses. It is NOT guessed —
// every address is copied verbatim from the canonical per-chain deployment map
// `trading-api-adapter/src/chains.ts` (`v4StateView` / `v4PoolManager`), which
// is HookSwap's own v4 deploy on the L2s and the canonical Uniswap v4 periphery
// on Sepolia. Chains/protocols not listed here (e.g. Uniswap v4 on Ethereum
// mainnet, PancakeSwap v4/Infinity on BSC) MUST supply addresses via config;
// absent both, the adapter returns { ok:false, reason:"STATEVIEW_UNKNOWN" } —
// never a fabricated price.

import { getAddress, type Address } from "viem";
import type { V4SourceType } from "./types";

export interface V4ChainDeployment {
  stateView: Address;
  poolManager?: Address;
}

// protocol -> chainId -> { stateView, poolManager }.
const RAW: Record<V4SourceType, Record<number, { stateView: string; poolManager?: string }>> = {
  // HookSwap's OWN v4 deploy on the HookSwap L2s (source: chains.ts v4StateView/v4PoolManager).
  "hook-v4": {
    4326: {
      stateView: "0x726f84e1dfb8d375a365e0808282f40d52d3e4e8",
      poolManager: "0xacb7e78fa05d562e0a5d3089ec896d57d057d38e",
    }, // MegaETH
    4663: {
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    }, // Robinhood
    57073: {
      stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
      poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
    }, // Ink
    196: {
      stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
      poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
    }, // XLayer
    4217: {
      stateView: "0x21b954fba3f5ddebe77ef2d47a3100c066908b2a",
      poolManager: "0x33620f62c5b9b2086dd6b62f4a297a9f30347029",
    }, // Tempo
  },
  // Canonical Uniswap v4 periphery (source: chains.ts). Only Sepolia is wired
  // in the adapter's canonical map today; add mainnet/L2 entries here as needed.
  "uniswap-v4": {
    11155111: {
      stateView: "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c",
      poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    }, // Sepolia (canonical Uniswap v4)
  },
  // PancakeSwap v4 / Infinity on BSC — addresses not tracked here yet; supply via
  // config (source.stateView) until added. Empty = honest { ok:false } fallback.
  "pancake-v4": {},
};

/** Resolve the fallback v4 deployment for a (protocol, chainId), if known. */
export function getV4Deployment(protocol: V4SourceType, chainId: number): V4ChainDeployment | undefined {
  const raw = RAW[protocol]?.[chainId];
  if (!raw) return undefined;
  return {
    stateView: getAddress(raw.stateView),
    poolManager: raw.poolManager ? getAddress(raw.poolManager) : undefined,
  };
}
