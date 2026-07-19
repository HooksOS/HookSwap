// Local smoke test: sign two crossing orders (real EIP-712) against a live
// Sepolia market and drive them through the running engine's HTTP API.
// Usage: BASE=http://localhost:4100 tsx scripts/smoke.ts

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  EIP712_ORDER_TYPES,
} from "../src/abis.js";

const BASE = process.env.BASE || "http://localhost:4100";
const CHAIN_ID = Number(process.env.PERPS_CHAIN_ID || 11155111);

async function j(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
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

async function signOrder(pk: `0x${string}`, market: `0x${string}`, order: any) {
  const account = privateKeyToAccount(pk);
  const signature = await account.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: market,
    },
    types: EIP712_ORDER_TYPES as any,
    primaryType: "Order",
    message: order,
  });
  return signature;
}

async function main() {
  const health = await j("GET", "/health");
  console.log("HEALTH:", JSON.stringify(health.body));
  const markets = await j("GET", "/markets");
  console.log("MARKETS:", markets.body.length, "->", JSON.stringify(markets.body[0]));

  const m = markets.body[0];
  const market = m.market as `0x${string}`;
  const token = m.collateral as `0x${string}`; // use collateral as the price token for the demo

  const longPk = generatePrivateKey();
  const shortPk = generatePrivateKey();
  const longAcct = privateKeyToAccount(longPk);
  const shortAcct = privateKeyToAccount(shortPk);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const size = 10n ** 18n; // 1.0
  const leverage = 50000n; // 5x (*1e4)
  const price = 2000n * 10n ** 18n; // 2000 * 1e18

  // Fresh random traders -> on-chain nonce is 0.
  const longOrder = {
    trader: longAcct.address,
    token,
    isLong: true,
    size,
    leverage,
    price,
    deadline,
    nonce: 0n,
    orderType: 1, // LIMIT
  };
  const shortOrder = {
    trader: shortAcct.address,
    token,
    isLong: false,
    size,
    leverage,
    price, // same price -> crosses
    deadline,
    nonce: 0n,
    orderType: 1,
  };

  const longSig = await signOrder(longPk, market, longOrder);
  const shortSig = await signOrder(shortPk, market, shortOrder);

  // Serialize bigints for JSON transport (strings accepted by the parser).
  const ser = (o: any) => ({ ...o, size: o.size.toString(), leverage: o.leverage.toString(), price: o.price.toString(), deadline: o.deadline.toString(), nonce: o.nonce.toString() });

  const r1 = await j("POST", "/orders", { market, order: ser(longOrder), signature: longSig });
  console.log("\nPOST long ->", r1.status, JSON.stringify(r1.body));

  const ob1 = await j("GET", `/orderbook?market=${market}`);
  console.log("ORDERBOOK after long:", JSON.stringify(ob1.body));

  const r2 = await j("POST", "/orders", { market, order: ser(shortOrder), signature: shortSig });
  console.log("\nPOST short (should MATCH) ->", r2.status);
  console.log(JSON.stringify(r2.body, null, 2));

  const trades = await j("GET", `/trades?market=${market}&limit=5`);
  console.log("\nTRADES:", JSON.stringify(trades.body.trades?.map((t: any) => ({ matchPrice: t.matchPrice, matchSize: t.matchSize, settled: t.settled, reason: t.reason, txHash: t.txHash })), null, 2));

  const ob2 = await j("GET", `/orderbook?market=${market}`);
  console.log("ORDERBOOK after match:", JSON.stringify(ob2.body));

  // Wrong-signature rejection check.
  const badSig = await signOrder(shortPk, market, longOrder); // signed by the wrong key
  const r3 = await j("POST", "/orders", { market, order: ser({ ...longOrder, trader: longAcct.address }), signature: badSig });
  console.log("\nBAD-SIG POST (should 400):", r3.status, JSON.stringify(r3.body));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
