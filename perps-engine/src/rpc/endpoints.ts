// SINGLE SOURCE OF TRUTH for HookSwapPerps RPC endpoints.
//
// Policy (Reggie, 2026-08-02): PUBLIC RPCs ONLY — no Alchemy, no keyed providers
// anywhere in the perps stack. Each chain gets an ORDERED list of public endpoints;
// the failover transport (./failover.ts) tries index 0 first and advances on failure.
//
// Every list below was live-tested. Do NOT add endpoints casually: an RPC that
// answers HTTP 200 with WRONG/partial data is far more dangerous than one that is
// simply down (see BLACKLISTED_RPCS).
//
// Env overrides: every resolver in this tree accepts a COMMA-SEPARATED list, so a
// single URL still works and a list works too, e.g.
//   SEPOLIA_RPC_URL="https://a.example,https://b.example"
//   PERPS_RPC_4663="https://rpc.mainnet.chain.robinhood.com"
// Env-supplied endpoints are placed FIRST; the built-in list is appended as extra
// fallbacks (deduped). Set PERPS_RPC_STRICT=1 to use ONLY the env-supplied list.

/**
 * Ordered public RPC endpoints per chain. Index 0 is tried first.
 * Live-validated 2026-08-02 unless noted.
 */
export const PUBLIC_RPCS: Record<number, readonly string[]> = {
  // Ethereum mainnet — carried over from the previous oracle/rpc.ts default
  // (used only by Uniswap-mainnet oracle routes; not a perps settlement chain).
  1: ["https://ethereum-rpc.publicnode.com"],

  // BSC (PancakeSwap oracle routes only, not a perps settlement chain).
  // Carried over from the previous oracle/rpc.ts default; NOT part of the
  // 2026-08-02 validated sweep.
  56: ["https://bsc-dataseed.binance.org"],

  // XLayer
  196: [
    "https://xlayer.drpc.org",
    "https://196.rpc.thirdweb.com",
    "https://rpc.xlayer.tech",
    "https://xlayerrpc.okx.com",
  ],

  // Stable
  988: [
    "https://stable-mainnet.rpc.sentio.xyz",
    "https://rpc.stable.xyz",
    "https://stable.drpc.org",
  ],

  // HyperEVM — the official rpc.hyperliquid.xyz endpoint is LAST on purpose: it
  // rate-limits hard, so it is a last resort rather than the primary.
  999: [
    "https://hyperliquid.drpc.org",
    "https://rpc.hyperlend.finance",
    "https://hyperliquid.rpc.blxrbdn.com",
    "https://hyperliquid-json-rpc.stakely.io",
    "https://999.rpc.thirdweb.com",
    "https://rpc.hyperliquid.xyz/evm",
  ],

  // Tempo
  4217: [
    "https://rpc.tempo.xyz",
    "https://rpc.mainnet.tempo.xyz",
    "https://tempo.drpc.org",
  ],

  // MegaETH
  4326: [
    "https://mainnet.megaeth.com/rpc",
    "https://megaeth.drpc.org",
    "https://4326.rpc.thirdweb.com",
  ],

  // Robinhood Chain — the LIVE perps settlement chain. Exactly ONE working public
  // endpoint exists; every other candidate is broken (see BLACKLISTED_RPCS).
  // Do NOT add more here without live-validating eth_call + eth_chainId + a real
  // contract read against a known market.
  4663: ["https://rpc.mainnet.chain.robinhood.com"],

  // Ink
  57073: [
    "https://ink.gateway.tenderly.co",
    "https://rpc-qnd.inkonchain.com",
    "https://ink.drpc.org",
    "https://rpc-gel.inkonchain.com",
    "https://57073.rpc.thirdweb.com",
  ],

  // Sepolia — MANDATORY first-validation chain.
  11155111: [
    "https://sepolia.drpc.org",
    "https://sepolia.gateway.tenderly.co",
    "https://11155111.rpc.thirdweb.com",
  ],
};

/**
 * ⛔ NEVER USE. These endpoints answer HTTP 200 with WRONG data, so a naive health
 * check (eth_chainId / "did it respond?") PASSES and the failover logic never
 * advances — the worst possible failure mode. Any URL here is stripped from every
 * resolved list, including env-supplied ones.
 */
export const BLACKLISTED_RPCS: Readonly<Record<string, string>> = {
  // Returns the correct chainId, but EVERY other JSON-RPC method replies
  // "does not exist" — a chainId-only health check passes. This is the trap.
  "https://robinhood.drpc.org":
    "correct eth_chainId but all other methods 'does not exist' — naive health checks PASS",
  // Rate-limits by returning {"result": null} with NO "error" field, so a 429 is
  // indistinguishable from a legitimately-empty result.
  "https://robinhoodchain.blockscout.com/api/eth-rpc":
    "429 surfaces as result:null with no error field — silent wrong answer",
  // eth_getLogs silently returns incomplete log sets.
  "https://megaeth.blockscout.com/api/eth-rpc": "silently drops logs from eth_getLogs",
  // 403 on eth_getLogs and on archive eth_call.
  "https://ethereum-sepolia-rpc.publicnode.com":
    "403 on eth_getLogs and archive eth_call",
};

/** Normalize for blacklist comparison (trailing slash / case insensitive host). */
function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

const BLACKLIST_KEYS = new Set(Object.keys(BLACKLISTED_RPCS).map(normalizeUrl));

/** True when `url` is on the blacklist (HTTP-200-with-wrong-data endpoints). */
export function isBlacklistedRpc(url: string): boolean {
  return BLACKLIST_KEYS.has(normalizeUrl(url));
}

/** Human-readable reason a URL is blacklisted, or "" when it is not. */
export function blacklistReason(url: string): string {
  const key = Object.keys(BLACKLISTED_RPCS).find((k) => normalizeUrl(k) === normalizeUrl(url));
  return key ? BLACKLISTED_RPCS[key] : "";
}

/**
 * Split one config/env value into URLs. Accepts a single URL, a comma-separated
 * (or whitespace/semicolon-separated) list, or an array. Non-http values are dropped.
 */
export function parseRpcList(value: string | readonly string[] | undefined | null): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[,\s;]+/);
  const out: string[] = [];
  for (const item of raw) {
    const u = String(item || "").trim();
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) continue;
    out.push(u.replace(/\/+$/, ""));
  }
  return out;
}

/** Read an env var as an RPC list (comma-separated or single URL). */
export function rpcListFromEnv(name: string | undefined | null): string[] {
  if (!name) return [];
  return parseRpcList(process.env[name]);
}

export interface ResolveRpcListOptions {
  /**
   * Ordered candidate sources, highest precedence first. Each entry may be a
   * single URL, a comma-separated list, or an array. Undefined/empty entries are
   * skipped.
   */
  sources?: (string | readonly string[] | undefined | null)[];
  /**
   * When true, do NOT append the built-in PUBLIC_RPCS list after the supplied
   * sources. Defaults to the PERPS_RPC_STRICT env flag.
   */
  strict?: boolean;
}

/**
 * Resolve the ordered endpoint list for a chain.
 *
 * Order = [ ...every URL from `sources` (in the order given) , ...PUBLIC_RPCS[chainId] ],
 * deduped (first occurrence wins) and blacklist-filtered.
 *
 * Throws when nothing survives — an empty list is a config bug, and silently
 * returning "" is exactly the failure that left MegaETH/Tempo broken before.
 */
export function resolveRpcList(chainId: number, opts: ResolveRpcListOptions = {}): string[] {
  const strict =
    opts.strict ?? /^(1|true|yes|on)$/i.test((process.env.PERPS_RPC_STRICT || "").trim());

  const candidates: string[] = [];
  for (const src of opts.sources ?? []) candidates.push(...parseRpcList(src));
  const supplied = candidates.length;
  if (!strict || supplied === 0) candidates.push(...(PUBLIC_RPCS[chainId] ?? []));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of candidates) {
    const k = normalizeUrl(u);
    if (seen.has(k)) continue;
    seen.add(k);
    if (isBlacklistedRpc(u)) {
      console.warn(
        `[rpc] chain=${chainId} DROPPED blacklisted endpoint ${u} — ${blacklistReason(u)}`,
      );
      continue;
    }
    out.push(u);
  }

  if (out.length === 0) {
    throw new Error(
      `no usable RPC endpoint for chainId ${chainId}: add it to PUBLIC_RPCS in ` +
        `src/rpc/endpoints.ts, or set PERPS_RPC_${chainId} (comma-separated list allowed)`,
    );
  }
  return out;
}
