// ONE-OFF liquidation-proof setup (NOT part of the keeper service).
//
// Engineers a genuinely liquidatable position on Sepolia so the running keeper can
// prove liquidate() end-to-end, WITHOUT faking anything:
//   1. Reads the live Chainlink mark (answer * 1e10).
//   2. Signs a high-leverage long (t1) + short (t2) pair at matchPrice = live mark
//      (both MARKET orders → no limit-price constraint; passes the H-1 band).
//   3. settleBatch([pair]) from the DEPLOYER (authorized matcher) → opens the pair.
//   4. updatePrice(token, mark * (1 - ADVERSE_BPS/1e4)) from the deployer — an
//      IN-BAND adverse mark (default 200 bps << the 500 bps OracleGuard band) that
//      puts the high-lev long underwater (at 100x, any >0.5% adverse move liquidates).
//   5. Prints the new pairId + canLiquidate() so the keeper can take it from here.
//
// PREREQ (operator, via cast): the market's marketMaxLeverage must be raised to allow
// LEVERAGE_X (the live market caps at 10x; a real liquidation inside the 5% band needs
// ~20x+, so we open at 100x). Restore it after the proof.
//
// Keys are read from mode-600 JSON files; NEVER logged.

import { readFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION, EIP712_ORDER_TYPES } from "../keeperAbi.js";

function req(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
function loadKey(path: string): `0x${string}` {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const obj = Array.isArray(raw) ? raw[0] : raw;
  const k = String(obj.private_key || obj.privateKey || obj.key).replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error(`bad key in ${path}`);
  return `0x${k}` as `0x${string}`;
}

const RPC = (process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org").trim();
const CHAIN_ID = Number(process.env.PERPS_CHAIN_ID || 11155111);
const MARKET = getAddress(req("MARKET") as `0x${string}`);
const COLLATERAL = getAddress(req("COLLATERAL") as `0x${string}`);
const FEED = getAddress((process.env.CHAINLINK_FEED || "0x694AA1769357215DE4FAC081bf1f309aDC325306") as `0x${string}`);
const LEVERAGE_X = BigInt(process.env.LEVERAGE_X || "100");
const SIZE = BigInt(process.env.SIZE || (2n * 10n ** 15n).toString()); // 0.002e18
const ADVERSE_BPS = BigInt(process.env.ADVERSE_BPS || "200");
const GAS_PRICE = BigInt(process.env.KEEPER_GAS_PRICE_WEI || "2000000000");

const LEVERAGE = LEVERAGE_X * 10_000n;

const CHAINLINK_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" } ] },
] as const;

const ORDER_COMPONENTS = [
  { name: "trader", type: "address" }, { name: "token", type: "address" }, { name: "isLong", type: "bool" },
  { name: "size", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "price", type: "uint256" },
  { name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "orderType", type: "uint8" },
] as const;
const MATCHED_PAIR_COMPONENTS = [
  { name: "longOrder", type: "tuple", components: ORDER_COMPONENTS }, { name: "longSignature", type: "bytes" },
  { name: "shortOrder", type: "tuple", components: ORDER_COMPONENTS }, { name: "shortSignature", type: "bytes" },
  { name: "matchPrice", type: "uint256" }, { name: "matchSize", type: "uint256" },
] as const;
const MARKET_ABI = [
  { type: "function", name: "settleBatch", stateMutability: "nonpayable",
    inputs: [{ name: "pairs", type: "tuple[]", components: MATCHED_PAIR_COMPONENTS }], outputs: [] },
  { type: "function", name: "updatePrice", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "price", type: "uint256" }], outputs: [] },
  { type: "function", name: "nextPairId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canLiquidate", stateMutability: "view", inputs: [{ name: "pairId", type: "uint256" }],
    outputs: [{ name: "liquidateLong", type: "bool" }, { name: "liquidateShort", type: "bool" }] },
  { type: "function", name: "marketMaxLeverage", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const pub = createPublicClient({ transport: http(RPC) });

const deployer = privateKeyToAccount(loadKey(req("DEPLOYER_KEY_FILE")));
const t1 = privateKeyToAccount(loadKey(req("T1_KEY_FILE"))); // long
const t2 = privateKeyToAccount(loadKey(req("T2_KEY_FILE"))); // short
const deployerWallet = createWalletClient({ account: deployer, transport: http(RPC) });

async function mark1e18(): Promise<bigint> {
  const r = (await pub.readContract({ address: FEED, abi: CHAINLINK_ABI, functionName: "latestRoundData" })) as readonly [bigint, bigint, bigint, bigint, bigint];
  if (r[1] <= 0n) throw new Error("chainlink answer <= 0");
  return r[1] * 10n ** 10n;
}
async function nonceOf(who: `0x${string}`): Promise<bigint> {
  return (await pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "nonces", args: [who] })) as bigint;
}
async function signOrder(acct: typeof t1, isLong: boolean, price: bigint, nonce: bigint) {
  const message = {
    trader: acct.address, token: COLLATERAL, isLong, size: SIZE, leverage: LEVERAGE, price,
    deadline: BigInt(Math.floor(Date.now() / 1000)) + 600n, nonce, orderType: 0, // MARKET
  };
  const signature = await acct.signTypedData({
    domain: { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId: CHAIN_ID, verifyingContract: MARKET },
    types: EIP712_ORDER_TYPES as any, primaryType: "Order", message,
  });
  return { order: message, signature };
}

async function main() {
  const cap = (await pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "marketMaxLeverage" })) as bigint;
  if (LEVERAGE > cap) throw new Error(`marketMaxLeverage=${cap} < requested leverage=${LEVERAGE}; raise it first (setMarketMaxLeverage)`);

  const mark = await mark1e18();
  console.log(JSON.stringify({ step: "mark", chainlinkMark_1e18: mark.toString() }));

  const n1 = await nonceOf(t1.address);
  const n2 = await nonceOf(t2.address);
  const long = await signOrder(t1, true, mark, n1);
  const short = await signOrder(t2, false, mark, n2);

  const pair = {
    longOrder: long.order, longSignature: long.signature,
    shortOrder: short.order, shortSignature: short.signature,
    matchPrice: mark, matchSize: SIZE,
  };

  // Open the pair (deployer = authorized matcher).
  const { request } = await pub.simulateContract({
    account: deployer, address: MARKET, abi: MARKET_ABI, functionName: "settleBatch", args: [[pair]] as any,
  });
  const openHash: Hash = await deployerWallet.writeContract({ ...(request as any), gasPrice: GAS_PRICE });
  const openRcpt = await pub.waitForTransactionReceipt({ hash: openHash });
  const nextId = (await pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "nextPairId" })) as bigint;
  const pairId = nextId - 1n;
  console.log(JSON.stringify({ step: "open", settleBatchTx: openHash, status: openRcpt.status, newPairId: pairId.toString() }));

  // Push an in-band adverse mark → the high-lev long goes underwater.
  const adverse = (mark * (10_000n - ADVERSE_BPS)) / 10_000n;
  const { request: upReq } = await pub.simulateContract({
    account: deployer, address: MARKET, abi: MARKET_ABI, functionName: "updatePrice", args: [COLLATERAL, adverse],
  });
  const upHash: Hash = await deployerWallet.writeContract({ ...(upReq as any), gasPrice: GAS_PRICE });
  const upRcpt = await pub.waitForTransactionReceipt({ hash: upHash });
  const can = (await pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "canLiquidate", args: [pairId] })) as readonly [boolean, boolean];
  console.log(JSON.stringify({
    step: "adverseMark", updatePriceTx: upHash, status: upRcpt.status,
    adverseMark_1e18: adverse.toString(), adverseBps: ADVERSE_BPS.toString(),
    canLiquidate: { long: can[0], short: can[1] }, pairId: pairId.toString(),
  }));
  console.log(JSON.stringify({ step: "done", handoff: "keeper service should now liquidate pairId " + pairId.toString() }));
}

main().catch((e) => { console.error("[forceLiquidation] " + (e?.shortMessage || e?.message || e)); process.exit(1); });
