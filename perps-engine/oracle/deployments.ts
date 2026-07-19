// Reads HookSwap per-chain core deployments from ../../contracts/deployments/*.json
// so oracle routes can resolve HookSwap v2/v3 factories, WETH, and (via CREATE2)
// v2 pair addresses without hardcoding. Only "core" files (with chainId +
// v2Factory/v3Factory + weth9) are loaded; -suite/-lockers/-referral are ignored.

import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export interface HookSwapChainDeployment {
  chain: string;
  chainId: number;
  weth9: Address;
  v2Factory?: Address;
  v2Router02?: Address;
  v2PairInitCodeHash?: Hex;
  v3Factory?: Address;
  poolInitCodeHash?: Hex;
  swapRouter02?: Address;
  universalRouter?: Address;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// perps-engine/oracle -> ../../contracts/deployments
export const DEPLOYMENTS_DIR = join(__dirname, "..", "..", "contracts", "deployments");

let cache: Map<number, HookSwapChainDeployment> | null = null;

/** Load + index all HookSwap core deployment files by chainId. */
export function loadHookSwapDeployments(dir: string = DEPLOYMENTS_DIR): Map<number, HookSwapChainDeployment> {
  if (cache) return cache;
  const map = new Map<number, HookSwapChainDeployment>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    // Skip the ancillary suites; core files are "<chain>.json".
    if (/-(suite|lockers|referral)\.json$/.test(file)) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (typeof j.chainId !== "number" || !j.weth9 || (!j.v2Factory && !j.v3Factory)) continue;
      map.set(j.chainId, {
        chain: j.chain ?? file.replace(/\.json$/, ""),
        chainId: j.chainId,
        weth9: getAddress(j.weth9),
        v2Factory: j.v2Factory ? getAddress(j.v2Factory) : undefined,
        v2Router02: j.v2Router02 ? getAddress(j.v2Router02) : undefined,
        v2PairInitCodeHash: j.v2PairInitCodeHash,
        v3Factory: j.v3Factory ? getAddress(j.v3Factory) : undefined,
        poolInitCodeHash: j.poolInitCodeHash,
        swapRouter02: j.swapRouter02 ? getAddress(j.swapRouter02) : undefined,
        universalRouter: j.universalRouter ? getAddress(j.universalRouter) : undefined,
      });
    } catch {
      // ignore unparseable / non-core files
    }
  }
  cache = map;
  return map;
}

export function getHookSwapChain(chainId: number): HookSwapChainDeployment | undefined {
  return loadHookSwapDeployments().get(chainId);
}

/**
 * Deterministic HookSwap v2 pair address via CREATE2 (canonical UniswapV2 formula):
 *   salt = keccak256(token0, token1) with tokens sorted ascending
 *   addr = create2(factory, salt, v2PairInitCodeHash)
 * Uses the per-chain factory + init-code hash from the deployment file, so it
 * works for the custom HookSwap chains (whose factory is NOT in @uniswap/v2-sdk).
 */
export function computeHookSwapV2Pair(chainId: number, tokenA: Address, tokenB: Address): Address {
  const d = getHookSwapChain(chainId);
  if (!d?.v2Factory || !d.v2PairInitCodeHash) {
    throw new Error(`No v2Factory/initCodeHash for chainId ${chainId} in deployments`);
  }
  const [token0, token1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const salt = keccak256(encodePacked(["address", "address"], [token0, token1]));
  return getCreate2Address({ from: d.v2Factory, salt, bytecodeHash: d.v2PairInitCodeHash });
}
