// Order parsing, EIP-712 signature recovery, and intake sanity checks.

import { getAddress, recoverTypedDataAddress } from "viem";
import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  EIP712_ORDER_TYPES,
} from "./abis.js";
import { ENV } from "./env.js";
import { OrderType, type Order } from "./types.js";

export class OrderError extends Error {}

function toBig(v: unknown, field: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new OrderError(`order.${field}: expected integer (string/number), got ${JSON.stringify(v)}`);
}

/** Parse + normalize an untrusted JSON order into a typed Order. */
export function parseOrder(raw: any): Order {
  if (!raw || typeof raw !== "object") throw new OrderError("order missing");
  const orderTypeNum = Number(raw.orderType);
  if (orderTypeNum !== 0 && orderTypeNum !== 1) {
    throw new OrderError(`order.orderType must be 0 (MARKET) or 1 (LIMIT)`);
  }
  let trader: `0x${string}`;
  let token: `0x${string}`;
  try {
    trader = getAddress(raw.trader);
    token = getAddress(raw.token);
  } catch {
    throw new OrderError("order.trader / order.token must be valid addresses");
  }
  if (typeof raw.isLong !== "boolean") throw new OrderError("order.isLong must be boolean");

  return {
    trader,
    token,
    isLong: raw.isLong,
    size: toBig(raw.size, "size"),
    leverage: toBig(raw.leverage, "leverage"),
    price: toBig(raw.price, "price"),
    deadline: toBig(raw.deadline, "deadline"),
    nonce: toBig(raw.nonce, "nonce"),
    orderType: orderTypeNum as OrderType,
  };
}

/** EIP-712 domain for a given market (verifyingContract = the market address). */
export function domainFor(market: `0x${string}`) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: ENV.chainId,
    verifyingContract: market,
  } as const;
}

/**
 * Recover the EIP-712 signer over the market's domain and require it == trader.
 * Throws OrderError on mismatch/invalid signature.
 */
export async function verifySigner(
  market: `0x${string}`,
  order: Order,
  signature: `0x${string}`,
): Promise<void> {
  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({
      domain: domainFor(market),
      types: EIP712_ORDER_TYPES,
      primaryType: "Order",
      message: {
        trader: order.trader,
        token: order.token,
        isLong: order.isLong,
        size: order.size,
        leverage: order.leverage,
        price: order.price,
        deadline: order.deadline,
        nonce: order.nonce,
        orderType: order.orderType,
      },
      signature,
    });
  } catch (e: any) {
    throw new OrderError(`signature recovery failed: ${e?.message || e}`);
  }
  if (getAddress(recovered) !== getAddress(order.trader)) {
    throw new OrderError(
      `signer ${recovered} != order.trader ${order.trader} (wrong domain/market or forged)`,
    );
  }
}

/** Basic sanity: deadline in the future, size>0, leverage within the market cap. */
export function sanityCheck(
  order: Order,
  caps: { marketMaxLeverage: bigint; maxLeverageAbs: bigint },
): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (order.deadline <= now) throw new OrderError("order.deadline is in the past");
  if (order.size <= 0n) throw new OrderError("order.size must be > 0");
  if (order.leverage <= 0n) throw new OrderError("order.leverage must be > 0");
  if (order.leverage > caps.maxLeverageAbs) {
    throw new OrderError(
      `order.leverage ${order.leverage} exceeds MAX_LEVERAGE ${caps.maxLeverageAbs}`,
    );
  }
  const cap = caps.marketMaxLeverage === 0n ? caps.maxLeverageAbs : caps.marketMaxLeverage;
  if (order.leverage > cap) {
    throw new OrderError(`order.leverage ${order.leverage} exceeds market cap ${cap}`);
  }
  if (order.orderType === OrderType.LIMIT && order.price <= 0n) {
    throw new OrderError("LIMIT order.price must be > 0");
  }
}

/** Parse the signature hex string. */
export function parseSignature(raw: any): `0x${string}` {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new OrderError("signature must be a 0x-hex string");
  }
  return raw as `0x${string}`;
}
