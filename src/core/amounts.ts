import { fail } from "./errors.js";

/** Maximum integer encodable in a native SPL-token amount. */
export const U64_MAX = (1n << 64n) - 1n;

/** Validate a positive atomic amount; fractional JavaScript numbers are never accepted. */
export function assertAmount(amount: bigint, field: string): void {
  if (typeof amount !== "bigint" || amount <= 0n || amount > U64_MAX)
    fail({
      code: "INVALID_REQUEST",
      message: "Amount must be a positive u64 bigint",
      field,
    });
}

/**
 * Validate integral basis points. A 100% slippage tolerance is deliberately unsupported.
 * @throws BuildFailure for nonintegral values or values outside 0 through 9999.
 */
export function basisPoints(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= 10_000)
    fail({
      code: "INVALID_REQUEST",
      message: "Slippage must be an integer from 0 through 9999 basis points",
      field: "slippageBps",
    });
  return value;
}

/** Round a required payment upward in integer arithmetic. Denominator must be positive. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n)
    fail({
      code: "INVALID_REQUEST",
      message: "Invalid division operands",
      field: "amount",
    });
  return (numerator + denominator - 1n) / denominator;
}

/** Round an exact-input minimum output down. */
export function minimumOutput(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - basisPoints(slippageBps))) / 10_000n;
}

/** Round an exact-output maximum input up, rejecting u64 overflow. */
export function maximumInput(amount: bigint, slippageBps: number): bigint {
  const result = ceilDiv(amount * BigInt(10_000 + basisPoints(slippageBps)), 10_000n);
  assertAmount(result, "maximumAmountIn");
  return result;
}
