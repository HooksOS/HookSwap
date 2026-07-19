// Per-chain viem PublicClient factory for the oracle adapters.
//
// RPC resolution order for a chainId N:
//   1. env PERPS_RPC_<N>              (e.g. PERPS_RPC_11155111=...)
//   2. DEFAULT_RPCS[N]               (public fallbacks below)
// Custom HookSwap chains keep their public RPCs until dedicated nodes exist
// (mirrors the trading-api-adapter resolveRpcUrl policy).

import { createPublicClient, http, type PublicClient } from "viem";

// Public fallback RPCs (override via PERPS_RPC_<chainId> in prod).
export const DEFAULT_RPCS: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com", // Sepolia (validate FIRST)
  4663: "https://rpc.mainnet.chain.robinhood.com", // Robinhood
  999: "https://rpc.hyperliquid.xyz/evm", // HyperEVM
  57073: "https://rpc-gel.inkonchain.com", // Ink
  196: "https://rpc.xlayer.tech", // XLayer
  4326: "", // MegaETH — set PERPS_RPC_4326
  4217: "", // Tempo — set PERPS_RPC_4217
  56: "https://bsc-dataseed.binance.org", // BSC (PancakeSwap)
  1: "https://ethereum-rpc.publicnode.com", // Ethereum mainnet (Uniswap)
};

const clients = new Map<number, PublicClient>();

export function resolveRpcUrl(chainId: number): string {
  const fromEnv = process.env[`PERPS_RPC_${chainId}`];
  const url = (fromEnv && fromEnv.trim()) || DEFAULT_RPCS[chainId] || "";
  if (!url) throw new Error(`No RPC for chainId ${chainId}; set PERPS_RPC_${chainId}`);
  return url;
}

/** Cached PublicClient per chain. */
export function clientFor(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const client = createPublicClient({ transport: http(resolveRpcUrl(chainId)) });
  clients.set(chainId, client);
  return client;
}
