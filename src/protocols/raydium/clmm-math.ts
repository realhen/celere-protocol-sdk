/**
 * Bigint adaptation of raydium-io/raydium-clmm's Apache-2.0 Rust tick, liquidity,
 * sqrt-price, and swap arithmetic, revision ed1eb41519d5355755f7df52b43fa9610938b60b.
 * See NOTICE.md. No Raydium JavaScript SDK implementation is included.
 */
import { ceilDiv } from "../../core/amounts.js";

export const CLMM_Q64 = 1n << 64n;
export const CLMM_MIN_TICK = -443636;
export const CLMM_MAX_TICK = 443636;
export const CLMM_MIN_SQRT_PRICE = 4295048016n;
export const CLMM_MAX_SQRT_PRICE = 79226673521066979257578248091n;
const FEE_DENOMINATOR = 1_000_000n;
const FACTORS = [
  0xfffcb933bd6fb800n,
  0xfff97272373d4000n,
  0xfff2e50f5f657000n,
  0xffe5caca7e10f000n,
  0xffcb9843d60f7000n,
  0xff973b41fa98e800n,
  0xff2ea16466c9b000n,
  0xfe5dee046a9a3800n,
  0xfcbe86c7900bb000n,
  0xf987a7253ac65800n,
  0xf3392b0822bb6000n,
  0xe7159475a2caf000n,
  0xd097f3bdfd2f2000n,
  0xa9f746462d9f8000n,
  0x70d869a156f31c00n,
  0x31be135f97ed3200n,
  0x9aa508b5b85a500n,
  0x5d6af8dedc582cn,
  0x2216e584f5fan,
];

/** Convert a validated Raydium tick to the program's Q64.64 sqrt price. */
export function clmmSqrtPriceAtTick(tick: number): bigint {
  const absolute = Math.abs(tick);
  let ratio = CLMM_Q64;
  for (let bit = 0; bit < FACTORS.length; bit++) {
    if ((absolute & (1 << bit)) !== 0) ratio = (ratio * FACTORS[bit]!) >> 64n;
  }
  return tick > 0 ? ((1n << 128n) - 1n) / ratio : ratio;
}

function deltas(
  first: bigint,
  second: bigint,
  liquidity: bigint,
  zeroForOne: boolean,
): { input: bigint; output: bigint } {
  const low = first < second ? first : second;
  const high = first > second ? first : second;
  const token0Numerator = (liquidity << 64n) * (high - low);
  const token0Denominator = low * high;
  const token1Numerator = liquidity * (high - low);
  return zeroForOne
    ? {
        input: ceilDiv(token0Numerator, token0Denominator),
        output: token1Numerator / CLMM_Q64,
      }
    : {
        input: ceilDiv(token1Numerator, CLMM_Q64),
        output: token0Numerator / token0Denominator,
      };
}

/**
 * Quote one static input-fee step up to an initialized tick or global price limit.
 * @remarks All amounts are atomic; inputs and fees round up, outputs round down.
 * The caller validates prices and positive liquidity before invoking this function.
 */
export function clmmSwapStep(
  price: bigint,
  target: bigint,
  liquidity: bigint,
  remaining: bigint,
  feeRate: bigint,
  exactIn: boolean,
  zeroForOne: boolean,
): { price: bigint; input: bigint; output: bigint; fee: bigint } {
  const available = exactIn
    ? (remaining * (FEE_DENOMINATOR - feeRate)) / FEE_DENOMINATOR
    : remaining;
  const targetAmounts = deltas(price, target, liquidity, zeroForOne);
  let next = target;
  if (available < (exactIn ? targetAmounts.input : targetAmounts.output)) {
    const numerator = liquidity << 64n;
    if (exactIn) {
      next = zeroForOne
        ? ceilDiv(numerator * price, numerator + available * price)
        : price + (available << 64n) / liquidity;
    } else {
      next = zeroForOne
        ? price - ceilDiv(available << 64n, liquidity)
        : ceilDiv(numerator * price, numerator - available * price);
    }
  }
  const amounts =
    next === target ? targetAmounts : deltas(price, next, liquidity, zeroForOne);
  const output = !exactIn && amounts.output > remaining ? remaining : amounts.output;
  const fee =
    exactIn && next !== target
      ? remaining - amounts.input
      : ceilDiv(amounts.input * feeRate, FEE_DENOMINATOR - feeRate);
  return { price: next, input: amounts.input, output, fee };
}
