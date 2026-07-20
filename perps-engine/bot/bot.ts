// HookSwapPerps standing COUNTERPARTY BOT (Sepolia).
//
// Rests a two-sided quote (a BID and an ASK) on a single perp market, refreshed
// on a fixed interval around the live Chainlink ETH/USD mark. A solo user trading
// from the UI crosses one side of the bot's quote → the matching engine settles it
// on-chain (real PairedPosition). The bot never fabricates a price: the mark is the
// live Chainlink feed; quotes sit inside the OracleGuard H-1 band (±5%).
//
// Signing/domain/ABIs are reused from the engine (../src/abis.js) so the bot's
// EIP-712 orders are byte-identical to what the contract + engine expect.
//
// SECURITY: BOT_PRIVATE_KEY is read from env once and NEVER logged. The bot signs
// orders (off-chain) and sends at most a few on-chain txs (depositETH / top-up).

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  EIP712_CANCEL_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  EIP712_ORDER_TYPES,
  PERP_MARKET_ABI,
} from "../src/abis.js";

// ---- Config (env) ----------------------------------------------------------

function reqEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const CHAIN_ID = Number(process.env.PERPS_CHAIN_ID || 11155111);
const ENGINE_URL = (process.env.ENGINE_URL || "https://perps.hookswap.org").replace(/\/+$/, "");
const RPC_URL = (process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org").trim();
const MARKET = getAddress(reqEnv("MARKET") as `0x${string}`);
// Chainlink ETH/USD on Sepolia (8-decimal answer).
const CHAINLINK_FEED = getAddress(
  (process.env.CHAINLINK_FEED || "0x694AA1769357215DE4FAC081bf1f309aDC325306") as `0x${string}`,
);

// Quote params (all overridable via env).
const SIZE = BigInt(process.env.BOT_SIZE || (2n * 10n ** 15n).toString()); // 0.002e18
const LEVERAGE_X = BigInt(process.env.BOT_LEVERAGE_X || "2");
const LEVERAGE_PRECISION = 10_000n;
const LEVERAGE = LEVERAGE_X * LEVERAGE_PRECISION;
const SPREAD_BPS = BigInt(process.env.BOT_SPREAD_BPS || "10"); // 0.10% off mark each side
const LOOP_MS = Number(process.env.BOT_LOOP_MS || 30_000);
const ORDER_TTL_SECONDS = BigInt(process.env.BOT_ORDER_TTL || "600");

// Collateral management.
const DEPOSIT_ETH = process.env.BOT_DEPOSIT_ETH || "0.03";
const MIN_AVAILABLE = parseEther(process.env.BOT_MIN_AVAILABLE || "0.004"); // top-up floor
const TOPUP_ETH = process.env.BOT_TOPUP_ETH || "0.01";

const CHAINLINK_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

// ---- Clients ---------------------------------------------------------------

const account = privateKeyToAccount(reqEnv("BOT_PRIVATE_KEY") as `0x${string}`);
const publicClient = createPublicClient({ transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

let COLLATERAL: `0x${string}` | null = null; // read from /markets on boot
let depositedOnce = false;
const trackedOrderIds: string[] = [];

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

// ---- Engine HTTP -----------------------------------------------------------

async function engine(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(ENGINE_URL + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: r.status, body: parsed };
}

async function resolveCollateral(): Promise<`0x${string}`> {
  const { body } = await engine("GET", "/markets");
  if (!Array.isArray(body)) throw new Error("GET /markets did not return an array");
  const m = body.find((x: any) => getAddress(x.market) === MARKET);
  if (!m) throw new Error(`market ${MARKET} not found in engine /markets`);
  return getAddress(m.collateral);
}

// ---- On-chain reads/writes -------------------------------------------------

async function markPrice1e18(): Promise<bigint> {
  const res = (await publicClient.readContract({
    address: CHAINLINK_FEED,
    abi: CHAINLINK_ABI,
    functionName: "latestRoundData",
  })) as readonly [bigint, bigint, bigint, bigint, bigint];
  const answer = res[1]; // 8 decimals
  if (answer <= 0n) throw new Error(`chainlink answer <= 0 (${answer})`);
  return answer * 10n ** 10n; // 8 -> 18 decimals
}

async function onchainNonce(): Promise<bigint> {
  return (await publicClient.readContract({
    address: MARKET,
    abi: PERP_MARKET_ABI,
    functionName: "nonces",
    args: [account.address],
  })) as bigint;
}

async function botBalance(): Promise<{ available: bigint; locked: bigint }> {
  const [available, locked] = (await publicClient.readContract({
    address: MARKET,
    abi: PERP_MARKET_ABI,
    functionName: "getUserBalance",
    args: [account.address],
  })) as [bigint, bigint];
  return { available, locked };
}

const DEPOSIT_ETH_ABI = [
  { type: "function", name: "depositETH", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

async function depositETHWei(value: bigint, label: string): Promise<void> {
  const hash = await walletClient.writeContract({
    address: MARKET,
    abi: DEPOSIT_ETH_ABI,
    functionName: "depositETH",
    value,
    chain: null,
    account,
    // Sepolia: legacy gas, keep it cheap/predictable.
    gasPrice: 2_000_000_000n,
  });
  log(`[deposit] ${label} depositETH(${formatEther(value)} ETH) tx=${hash} — waiting…`);
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  log(`[deposit] ${label} mined status=${rcpt.status} block=${rcpt.blockNumber}`);
}

// ---- Order signing ---------------------------------------------------------

async function signAndPost(isLong: boolean, price: bigint, nonce: bigint): Promise<void> {
  const message = {
    trader: account.address,
    token: COLLATERAL!,
    isLong,
    size: SIZE,
    leverage: LEVERAGE,
    price,
    deadline: BigInt(Math.floor(Date.now() / 1000)) + ORDER_TTL_SECONDS,
    nonce,
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
  const { status, body } = await engine("POST", "/orders", { market: MARKET, order: ser, signature });
  if (status !== 200) {
    log(`[post] ${isLong ? "BID" : "ASK"} REJECTED ${status}: ${JSON.stringify(body)}`);
    return;
  }
  if (body.orderId) trackedOrderIds.push(body.orderId);
  log(
    `[post] ${isLong ? "BID" : "ASK"} price=${formatEther(price)} size=${formatEther(SIZE)} ` +
      `nonce=${nonce} -> orderId=${body.orderId} status=${body.status}` +
      (body.fills?.length ? ` FILLS=${body.fills.length}` : ""),
  );
}

async function cancelBotOrders(): Promise<void> {
  trackedOrderIds.length = 0;
  // Cancel EVERY resting order owned by the bot — not just this process's tracked
  // ids. This clears any stale orders left by a prior run (the engine's book is
  // in-memory and survives a bot restart) so the book never ends up crossed.
  const { status, body } = await engine(
    "GET",
    `/orders?market=${MARKET}&trader=${account.address}`,
  );
  if (status !== 200 || !Array.isArray(body)) return;
  for (const o of body) {
    if (!o?.orderId) continue;
    try {
      // DELETE is now authenticated — sign the EIP-712 Cancel proving we own the order.
      const signature = await account.signTypedData({
        domain: {
          name: EIP712_DOMAIN_NAME,
          version: EIP712_DOMAIN_VERSION,
          chainId: CHAIN_ID,
          verifyingContract: MARKET,
        },
        types: EIP712_CANCEL_TYPES as any,
        primaryType: "Cancel",
        message: { orderId: o.orderId, trader: account.address },
      });
      await engine(
        "DELETE",
        `/orders/${encodeURIComponent(o.orderId)}?signature=${signature}`,
      );
    } catch {
      /* already filled/gone — ignore */
    }
  }
}

// ---- Main loop -------------------------------------------------------------

// Best-effort collateral top-up. NEVER throws — a failed deposit must not stop the
// bot from cancelling stale orders and re-quoting. Deposits are wallet-aware: it
// only deposits what the wallet can afford after a small gas reserve.
const GAS_RESERVE = parseEther("0.0006");

async function ensureCollateral(): Promise<void> {
  try {
    const { available, locked } = await botBalance();
    if (available >= MIN_AVAILABLE) return;
    const walletBal = await publicClient.getBalance({ address: account.address });
    if (walletBal <= GAS_RESERVE) {
      log(
        `[collateral] available=${formatEther(available)} locked=${formatEther(locked)} < floor, ` +
          `but wallet ETH ${formatEther(walletBal)} <= gas reserve — quoting with current collateral`,
      );
      return;
    }
    let want = parseEther(DEPOSIT_ETH);
    const affordable = walletBal - GAS_RESERVE;
    if (want > affordable) want = affordable;
    log(`[collateral] available=${formatEther(available)} < floor — depositing ${formatEther(want)} ETH`);
    await depositETHWei(want, "auto");
  } catch (e: any) {
    log(`[collateral] top-up skipped (${e?.shortMessage || e?.message || e}) — quoting with current collateral`);
  }
}

async function loopOnce(): Promise<void> {
  await ensureCollateral();

  const mark = await markPrice1e18();
  // A NORMAL (non-crossed) maker book: bid below mark, ask above mark. This is
  // essential — the engine has NO self-trade prevention, so a crossed book
  // (bid > ask) makes the bot's own two orders match each other. With bid < ask
  // the bot's quotes never cross, yet a user's taker order still crosses the
  // correct side and settles at the bot's (maker) price, inside the H-1 band:
  //   • user SHORT (taker) crosses the resting BID  -> matchPrice = bid  (mark*(1-spread))
  //   • user LONG  (taker) crosses the resting ASK  -> matchPrice = ask  (mark*(1+spread))
  const bid = (mark * (10_000n - SPREAD_BPS)) / 10_000n; // below mark; a user SHORT crosses it
  const ask = (mark * (10_000n + SPREAD_BPS)) / 10_000n; // above mark; a user LONG crosses it

  await cancelBotOrders();
  const nonce = await onchainNonce();

  // Both sides share the current on-chain nonce (the contract's nonce only advances
  // on a settled fill). One user order fills one side; next loop reposts at nonce+1.
  await signAndPost(true, bid, nonce); // BID / long
  await signAndPost(false, ask, nonce); // ASK / short

  const { available, locked } = await botBalance();
  log(
    `[quote] mark=${formatEther(mark)} bid=${formatEther(bid)} ask=${formatEther(ask)} ` +
      `| collateral avail=${formatEther(available)} locked=${formatEther(locked)}`,
  );
}

async function main(): Promise<void> {
  log(`[boot] HookSwapPerps counterparty bot`);
  log(`[boot] engine=${ENGINE_URL} market=${MARKET} bot=${account.address} chainId=${CHAIN_ID}`);
  COLLATERAL = await resolveCollateral();
  log(`[boot] collateral(token)=${COLLATERAL} size=${formatEther(SIZE)} lev=${LEVERAGE_X}x spreadBps=${SPREAD_BPS}`);

  // Loop forever; a single loop failure must not kill the service.
  for (;;) {
    try {
      await loopOnce();
    } catch (e: any) {
      log(`[loop] error: ${e?.message || e}`);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => {
  log(`[fatal] ${e?.message || e}`);
  process.exit(1);
});
