// Per-chain config: the HookSwapTokenLockerManager address + an RPC endpoint.
//
// Manager addresses are verified against contracts/locker deployments. RPC defaults
// are the public endpoints already used by the HookSwap interface chain-info files
// (packages/uniswap/src/features/chains/evm/info/*.ts). Each RPC is env-overridable
// via LOCKER_RPC_<chainId> (or the friendlier alias listed per chain). A chain whose
// RPC does not respond is reported unreachable — never faked.

export interface ChainConfig {
  chainId: number;
  name: string;
  /** HookSwapTokenLockerManager address on this chain. */
  manager: `0x${string}`;
  /** Resolved RPC URL (env override applied). */
  rpcUrl: string;
}

interface ChainDef {
  chainId: number;
  name: string;
  manager: `0x${string}`;
  defaultRpc: string;
  /** Extra env var names checked (in order) before LOCKER_RPC_<chainId>. */
  rpcEnv: string[];
}

const DEFS: ChainDef[] = [
  {
    chainId: 999,
    name: "HyperEVM",
    manager: "0x7EFFe9DD68035f43ad43aE6C31bc1a47Ab4579D0",
    defaultRpc: "https://rpc.hyperliquid.xyz/evm",
    rpcEnv: ["HYPEREVM_RPC_URL"],
  },
  {
    chainId: 57073,
    name: "Ink",
    manager: "0x86426094d82bC1fd40F0901965b23D30837Dc66b",
    defaultRpc: "https://rpc-gel.inkonchain.com",
    rpcEnv: ["INK_RPC_URL"],
  },
  {
    chainId: 4326,
    name: "MegaETH",
    manager: "0x35dB40f22143651159056285E92c113ECE65E7e2",
    defaultRpc: "https://mainnet.megaeth.com/rpc",
    rpcEnv: ["MEGAETH_RPC_URL"],
  },
  {
    chainId: 196,
    name: "XLayer",
    manager: "0x35dB40f22143651159056285E92c113ECE65E7e2",
    defaultRpc: "https://rpc.xlayer.tech",
    rpcEnv: ["XLAYER_RPC_URL"],
  },
  {
    chainId: 4663,
    name: "Robinhood",
    manager: "0x35dB40f22143651159056285E92c113ECE65E7e2",
    defaultRpc: "https://rpc.mainnet.chain.robinhood.com",
    rpcEnv: ["ROBINHOOD_RPC_URL"],
  },
  {
    chainId: 4217,
    name: "Tempo",
    manager: "0x86426094d82bC1fd40F0901965b23D30837Dc66b",
    defaultRpc: "https://rpc.tempo.xyz",
    rpcEnv: ["TEMPO_RPC_URL"],
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    manager: "0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3",
    defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    rpcEnv: ["SEPOLIA_RPC_URL"],
  },
];

function resolveRpc(def: ChainDef): string {
  for (const name of [...def.rpcEnv, `LOCKER_RPC_${def.chainId}`]) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return def.defaultRpc;
}

/** The active chain set (RPC env overrides applied at load). */
export const CHAINS: ChainConfig[] = DEFS.map((d) => ({
  chainId: d.chainId,
  name: d.name,
  manager: d.manager,
  rpcUrl: resolveRpc(d),
}));

export function chainName(chainId: number): string {
  return CHAINS.find((c) => c.chainId === chainId)?.name ?? `chain-${chainId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Farms: per-chain StakingRewardsFactory address(es). A chain may have MULTIPLE
// factories (e.g. a superseded + a current deploy); the farms indexer calls
// allFarms() on EACH and unions the children. Addresses are lifted verbatim from
// the frontend (apps/web/src/terminal/farms/addresses.ts FARM_FACTORY_ADDRESSES)
// + contracts/deployments/<chain>-suite.json ("stakingRewardsFactory"). No chain
// is invented; a chain absent here honestly reports zero farms.
// ─────────────────────────────────────────────────────────────────────────────
export const FARM_FACTORIES: Record<number, `0x${string}`[]> = {
  // mainnet self-service suite mirrors (frontend addresses.ts)
  4663: ["0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33"], // Robinhood
  999: ["0x8d26aa9d0556fd1483ad630fe9f6e21c168f2e33"], // HyperEVM
  196: ["0x7f91048007b653b088282a73d180541f9c228677"], // XLayer
  4326: ["0xd9d4795f2a12305a12c36455adad011f2d6143ab"], // MegaETH
  57073: ["0x144331bb4c3026d135896cafec3ae3d667f4f376"], // Ink
  4217: ["0x250c3448278f7b71e3e9b641f2efeb6074820e25"], // Tempo
  // Sepolia (11155111) — BOTH the current (security-fixed) factory AND the
  // superseded pre-fix factory carry real test farms → index/union both
  // (contracts/deployments/sepolia-suite.json).
  11155111: [
    "0x144331bb4c3026d135896cafec3ae3d667f4f376",
    "0xb9df9afbcf909a16218285889912820c3f2c6313",
  ],
};

/** Configured farm factories for a chain (possibly several), or [] if none. */
export function farmFactories(chainId: number): `0x${string}`[] {
  return FARM_FACTORIES[chainId] ?? [];
}

// Canonical Multicall3 — same address on every EVM chain (incl. all HookSwap
// chains + Sepolia). Passed explicitly because clients are created transport-only
// (no `chain`), so viem cannot infer a multicall address.
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
