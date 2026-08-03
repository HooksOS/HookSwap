/**
 * One-shot TAKER — the counterparty half of a live perps trade.
 *
 * The market-maker bot posts a resting BID and ASK around the oracle mark but is
 * deliberately non-crossing, so its own two orders never match each other (the
 * engine has no self-trade prevention). Completing a real trade therefore needs a
 * second party that crosses one side. This script is that party: it deposits
 * collateral, signs ONE EIP-712 LIMIT order that crosses the bot's resting quote,
 * and posts it. The engine matches and settles on-chain.
 *
 * Direction: a taker LONG crosses the resting ASK (matchPrice = ask). We price
 * slightly THROUGH the ask so the cross is unambiguous rather than depending on
 * an exact tie.
 *
 * Run (inside the perps container, so the key never leaves the box):
 *   TAKER_KEY_ENV=RH_MATCHER_PRIVATE PERPS_CHAIN_ID=4663 MARKET=0x… \
 *   PERPS_RPC_URL=… node_modules/.bin/tsx bot/takerOnce.ts
 */
import { formatEther, getAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION, EIP712_ORDER_TYPES, PERP_MARKET_ABI } from "../src/abis.js";
import { resolveRpcList } from "../src/rpc/endpoints.js";
import { createFailoverPublicClient, createFailoverWalletClient } from "../src/rpc/failover.js";

// The market ABI exposes no `collateralToken()`; the engine's /markets is the
// source of truth for a market's collateral (same as the bot's resolveCollateral).
const DEPOSIT_ETH_ABI = [
  { type: "function", name: "depositETH", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

function req(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const CHAIN_ID = Number(req("PERPS_CHAIN_ID"));
const MARKET = getAddress(req("MARKET") as `0x${string}`);
// PERPS_RPC_URL accepts a comma-separated list; anything missing is topped up from
// the validated public list for CHAIN_ID (../src/rpc/endpoints.ts). Optional now —
// the built-in list is used when it is unset.
const RPC_URLS = resolveRpcList(CHAIN_ID, { sources: [process.env.PERPS_RPC_URL] });
const ENGINE_URL = (process.env.ENGINE_URL || "http://hookswap-perps-engine:4110").replace(/\/+$/, "");
// The key is read from whichever env var holds it — never passed on the CLI.
const KEY = req(process.env.TAKER_KEY_ENV || "RH_MATCHER_PRIVATE");
const SIZE = BigInt(process.env.TAKER_SIZE || "500000000000000"); // 0.0005e18
const LEVERAGE = BigInt(process.env.TAKER_LEVERAGE_X || "2") * 10_000n;
const DEPOSIT_ETH = process.env.TAKER_DEPOSIT_ETH || "0.002";

const account = privateKeyToAccount((KEY.startsWith("0x") ? KEY : `0x${KEY}`) as `0x${string}`);
const publicClient = createFailoverPublicClient(CHAIN_ID, RPC_URLS, `taker/${CHAIN_ID}`);
const walletClient = createFailoverWalletClient(account, CHAIN_ID, RPC_URLS, `taker/${CHAIN_ID}`);

const log = (m: string): void => console.log(`${new Date().toISOString()} ${m}`);

async function engine(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text — an HTML error page must not crash the run */
  }
  return { status: res.status, body: parsed };
}

async function main(): Promise<void> {
  log(`[taker] account=${account.address} market=${MARKET} chainId=${CHAIN_ID}`);

  // -- collateral -----------------------------------------------------------
  const mk = await engine("GET", "/markets");
  if (!Array.isArray(mk.body)) {
    throw new Error("GET /markets did not return an array");
  }
  const entry = mk.body.find((x: any) => getAddress(x.market) === MARKET);
  if (!entry) {
    throw new Error(`market ${MARKET} not in engine /markets`);
  }
  const collateral = getAddress(entry.collateral) as `0x${string}`;
  log(`[taker] collateral=${collateral}`);

  const [availBefore, lockedBefore] = (await publicClient.readContract({
    address: MARKET,
    abi: PERP_MARKET_ABI,
    functionName: "getUserBalance",
    args: [account.address],
  })) as [bigint, bigint];
  const balBefore = availBefore;
  log(`[taker] collateral before: available=${formatEther(availBefore)} locked=${formatEther(lockedBefore)}`);

  if (balBefore < parseEther(DEPOSIT_ETH)) {
    const want = parseEther(DEPOSIT_ETH) - balBefore;
    log(`[taker] depositETH(${formatEther(want)})…`);
    const hash = await walletClient.writeContract({
      address: MARKET,
      abi: DEPOSIT_ETH_ABI,
      functionName: "depositETH",
      value: want,
      chain: null,
      account,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    log(`[taker] deposit tx=${hash} status=${rcpt.status} block=${rcpt.blockNumber}`);
  }

  // -- find the bot's resting ASK ------------------------------------------
  const book = await engine("GET", `/orders?market=${MARKET}`);
  if (book.status !== 200 || !Array.isArray(book.body)) {
    throw new Error(`cannot read book: ${book.status} ${JSON.stringify(book.body).slice(0, 200)}`);
  }
  // The engine serialises direction as `side: "long" | "short"` (NOT an isLong
  // boolean — that is the request shape, not the response shape). A resting ASK is
  // side === "short": the maker is short, so a taker LONG crosses it.
  const asks = book.body.filter((o: any) => o?.side === "short" && o?.status === "open");
  if (asks.length === 0) {
    throw new Error("no resting ASK to cross — is the maker bot quoting?");
  }
  // Cheapest ask is the one a taker LONG would hit.
  asks.sort((a: any, b: any) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1));
  const ask = asks[0];
  const askPrice = BigInt(ask.price);
  log(`[taker] resting ASK price=${formatEther(askPrice)} size=${formatEther(BigInt(ask.remaining ?? ask.size))} id=${ask.orderId}`);

  // Price 0.5% THROUGH the ask so the cross is unambiguous.
  const limitPrice = (askPrice * 10_050n) / 10_000n;

  // The engine requires order.nonce == the trader's CURRENT on-chain nonce (it is a
  // replay guard, not a unique id) — a timestamp is rejected outright.
  const onchainNonce = (await publicClient.readContract({
    address: MARKET,
    abi: PERP_MARKET_ABI,
    functionName: "nonces",
    args: [account.address],
  })) as bigint;
  log(`[taker] on-chain nonce=${onchainNonce}`);

  const message = {
    trader: account.address,
    token: collateral,
    isLong: true, // taker LONG crosses the resting ASK
    size: SIZE,
    leverage: LEVERAGE,
    price: limitPrice,
    deadline: BigInt(Math.floor(Date.now() / 1000)) + 600n,
    nonce: onchainNonce,
    orderType: 1, // LIMIT
  };
  const signature = await account.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: MARKET,
    },
    types: EIP712_ORDER_TYPES as any,
    primaryType: "Order",
    message,
  });

  const ser = {
    trader: message.trader,
    token: message.token,
    isLong: message.isLong,
    size: message.size.toString(),
    leverage: message.leverage.toString(),
    price: message.price.toString(),
    deadline: message.deadline.toString(),
    nonce: message.nonce.toString(),
    orderType: message.orderType,
  };
  log(`[taker] posting LONG @ ${formatEther(limitPrice)} size=${formatEther(SIZE)}…`);
  const res = await engine("POST", "/orders", { market: MARKET, order: ser, signature });
  log(`[taker] engine ${res.status}: ${JSON.stringify(res.body).slice(0, 700)}`);

  const [availAfter, lockedAfter] = (await publicClient.readContract({
    address: MARKET,
    abi: PERP_MARKET_ABI,
    functionName: "getUserBalance",
    args: [account.address],
  })) as [bigint, bigint];
  log(`[taker] collateral after: available=${formatEther(availAfter)} locked=${formatEther(lockedAfter)}`);
}

main().catch((e) => {
  console.error("[taker] FAILED:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
