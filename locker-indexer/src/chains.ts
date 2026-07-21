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

// Canonical Multicall3 — same address on every EVM chain (incl. all HookSwap
// chains + Sepolia). Passed explicitly because clients are created transport-only
// (no `chain`), so viem cannot infer a multicall address.
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
