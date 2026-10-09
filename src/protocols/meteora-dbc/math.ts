/** Bigint adaptation of Meteora's MIT DBC SDK curve math; see NOTICE.md. */
import { ceilDiv, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
const Q128 = 1n << 128n;
const U128_MAX = Q128 - 1n;
/** Piecewise curve upper boundary in Q64.64 and its raw u128 liquidity. */
export interface CurvePoint {
  readonly sqrtPrice: bigint;
  readonly liquidity: bigint;
}
function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "meteora-dbc", message });
}
function deltaBase(
  low: bigint,
  high: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const numerator = liquidity * (high - low),
    denominator = high * low;
  return roundUp ? ceilDiv(numerator, denominator) : numerator / denominator;
}
function deltaQuote(
  low: bigint,
  high: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const numerator = liquidity * (high - low);
  return roundUp ? ceilDiv(numerator, Q128) : numerator / Q128;
}
function nextPrice(
  price: bigint,
  liquidity: bigint,
  amount: bigint,
  baseToQuote: boolean,
  exactInput: boolean,
): bigint {
  if (baseToQuote && exactInput) {
    const product = amount * price,
      denominator = liquidity + product;
    if (product > U128_MAX || denominator > U128_MAX)
      insufficient("DBC input exceeds the qualified native u128 price calculation");
    return ceilDiv(liquidity * price, denominator);
  }
  if (!baseToQuote && exactInput) return price + (amount * Q128) / liquidity;
  if (baseToQuote) return price - ceilDiv(amount * Q128, liquidity);
  const denominator = liquidity - amount * price;
  if (denominator <= 0n) insufficient("DBC output exhausts the active liquidity segment");
  return ceilDiv(liquidity * price, denominator);
}
/**
 * Traverse the native piecewise curve using round-up payments and round-down credits.
 * @remarks Amount is curve input for exact input or curve output for exact output;
 * fees are handled by the adapter. Throws a structured liquidity error on partial fill.
 */
export function calculateCurveSwap(
  points: readonly CurvePoint[],
  startPrice: bigint,
  migrationPrice: bigint,
  price: bigint,
  amount: bigint,
  baseToQuote: boolean,
  exactInput: boolean,
): { readonly input: bigint; readonly output: bigint; readonly nextPrice: bigint } {
  let left = amount,
    total = 0n,
    current = price;
  const indexes = Array.from({ length: points.length }, (_, i) =>
    baseToQuote ? points.length - 1 - i : i,
  );
  for (const index of indexes) {
    const point = points[index]!;
    const lower = index === 0 ? startPrice : points[index - 1]!.sqrtPrice;
    const target = baseToQuote
      ? lower
      : exactInput && point.sqrtPrice > migrationPrice
        ? migrationPrice
        : point.sqrtPrice;
    if (baseToQuote ? target >= current : target <= current) continue;
    const low = baseToQuote ? target : current,
      high = baseToQuote ? current : target;
    const maximum =
      baseToQuote === exactInput
        ? deltaBase(low, high, point.liquidity, exactInput)
        : deltaQuote(low, high, point.liquidity, exactInput);
    if (left < maximum) {
      const next = nextPrice(current, point.liquidity, left, baseToQuote, exactInput);
      if (next < low || next > high)
        insufficient("DBC rounded price exceeds the active segment");
      const nextLow = baseToQuote ? next : current,
        nextHigh = baseToQuote ? current : next;
      total +=
        baseToQuote === exactInput
          ? deltaQuote(nextLow, nextHigh, point.liquidity, !exactInput)
          : deltaBase(nextLow, nextHigh, point.liquidity, !exactInput);
      current = next;
      left = 0n;
      break;
    }
    left -= maximum;
    total +=
      baseToQuote === exactInput
        ? deltaQuote(low, high, point.liquidity, !exactInput)
        : deltaBase(low, high, point.liquidity, !exactInput);
    current = target;
    if (left === 0n || (!baseToQuote && current >= migrationPrice)) break;
  }
  if (
    left !== 0n ||
    current < startPrice ||
    current > migrationPrice ||
    total === 0n ||
    total > U64_MAX
  )
    insufficient(
      "DBC curve cannot fully fill the requested swap before its price or migration boundary",
    );
  return {
    input: exactInput ? amount : total,
    output: exactInput ? total : amount,
    nextPrice: current,
  };
}
