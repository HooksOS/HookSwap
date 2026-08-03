// Per-chain viem PublicClient factory for the oracle adapters — MULTI-RPC failover.
//
// The per-chain endpoint LISTS live in ONE place for the whole perps stack:
//   ../src/rpc/endpoints.ts  (PUBLIC_RPCS + the blacklist)
// and the failover transport lives in ../src/rpc/failover.ts. This module used to
// carry its own single-URL DEFAULT_RPCS map, which drifted out of sync and shipped
// EMPTY STRINGS for MegaETH (4326) and Tempo (4217) — any oracle route touching
// those chains threw. Both are now populated from the shared table.
//
// RPC resolution order for a chainId N (each source may be ONE url or a
// COMMA-SEPARATED list):
//   1. env PERPS_RPC_<N>   (e.g. PERPS_RPC_11155111="https://a,https://b")
//   2. PUBLIC_RPCS[N]      (validated public endpoints, ordered)
// Blacklisted endpoints (HTTP 200 + wrong data) are stripped from both.

import { type PublicClient } from "viem";
import { PUBLIC_RPCS, resolveRpcList } from "../src/rpc/endpoints.js";
import { createFailoverPublicClient } from "../src/rpc/failover.js";

/**
 * BACK-COMPAT view of the old single-URL map: chainId -> the PRIMARY (index 0)
 * public endpoint. Prefer `resolveRpcUrls()`; this only exists for callers that
 * still want one string. MegaETH/Tempo are no longer empty.
 */
export const DEFAULT_RPCS: Record<number, string> = Object.fromEntries(
  Object.entries(PUBLIC_RPCS).map(([id, urls]) => [Number(id), urls[0] ?? ""]),
) as Record<number, string>;

/** Ordered endpoint list for a chain (env override first, then the public list). */
export function resolveRpcUrls(chainId: number): string[] {
  return resolveRpcList(chainId, { sources: [process.env[`PERPS_RPC_${chainId}`]] });
}

/**
 * BACK-COMPAT: the PRIMARY endpoint only. Callers that need resilience should use
 * `clientFor()` (which fails over across the whole list) rather than this.
 */
export function resolveRpcUrl(chainId: number): string {
  return resolveRpcUrls(chainId)[0];
}

const clients = new Map<number, PublicClient>();

/** Cached PublicClient per chain, with automatic multi-endpoint read failover. */
export function clientFor(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const client = createFailoverPublicClient(chainId, resolveRpcUrls(chainId), `oracle/${chainId}`);
  clients.set(chainId, client);
  return client;
}
