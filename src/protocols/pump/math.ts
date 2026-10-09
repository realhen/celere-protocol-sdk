import {
  assertAmount,
  ceilDiv,
  maximumInput,
  minimumOutput,
} from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import type { SwapFee, SwapQuote, SwapRequest } from "../../core/types.js";
import type { PumpCurve, PumpFees } from "./state.js";

/** Caller-observed inventory and global charge needed to price synthetic migration. */
export interface PumpQuoteOptions {
  readonly baseVaultBalance: bigint;
  readonly migrationFee: bigint;
  /** Enabled only for native v3 buys and multi-hop curve instructions. */
  readonly allowSynthetic?: boolean;
  /** Native multi-hop consumes the entire last budget even if it buys zero extra atoms. */
  readonly route?: boolean;
}

function insufficientLiquidity(): never {
  fail({
    code: "INSUFFICIENT_LIQUIDITY",
    protocol: "pump",
    message: "Swap exceeds the available Pump curve or synthetic pool liquidity",
  });
}

function feesFor(amount: bigint, rates: PumpFees, curve: PumpCurve): readonly SwapFee[] {
  return [
    {
      kind: "trade",
      mint: curve.quoteMint,
      amount: ceilDiv(amount * rates.protocolBps, 10_000n),
    },
    {
      kind: "creator",
      mint: curve.quoteMint,
      amount: ceilDiv(amount * rates.creatorBps, 10_000n),
    },
  ];
}
function totalFees(fees: readonly SwapFee[]): bigint {
  return fees.reduce((sum, fee) => sum + fee.amount, 0n);
}
function buyNet(budget: bigint, rates: PumpFees, curve: PumpCurve) {
  let net = (budget * 10_000n) / (10_000n + rates.protocolBps + rates.creatorBps);
  const fees = feesFor(net, rates, curve);
  const cost = net + totalFees(fees);
  if (cost > budget) net -= cost - budget;
  return { net, fees };
}
function curveCost(curve: PumpCurve, tokens: bigint): bigint {
  if (tokens >= curve.virtualTokens) insufficientLiquidity();
  return (tokens * curve.virtualSol) / (curve.virtualTokens - tokens) + 1n;
}
function futurePool(curve: PumpCurve, curveNet: bigint, options?: PumpQuoteOptions) {
  if (!options?.allowSynthetic) insufficientLiquidity();
  const base = options.baseVaultBalance - curve.realTokens;
  const quote = curve.realSol + curveNet - options.migrationFee;
  if (base <= 0n || quote <= 0n) insufficientLiquidity();
  return { base, quote };
}
function combineFees(
  first: readonly SwapFee[],
  second: readonly SwapFee[],
): readonly SwapFee[] {
  return first.map((fee, index) => ({
    ...fee,
    amount: fee.amount + second[index]!.amount,
  }));
}

/**
 * Price native Pump instructions against immutable observations using atomic integer arithmetic.
 * @remarks V3 completion prices each leg separately and charges each leg's rounded fees.
 * `expectedAmountIn` can be smaller than an exact-input budget if its final tail buys no token atom.
 * Route callers supply the route's effective fee mask and set `route` to match its consume-all contract.
 */
export function quotePump(
  request: SwapRequest,
  curve: PumpCurve,
  rates: PumpFees,
  isBuy: boolean,
  options?: PumpQuoteOptions,
): SwapQuote {
  if (request.amount.kind === "exactOut") {
    if (!isBuy)
      fail({
        code: "UNSUPPORTED_SWAP_MODE",
        protocol: "pump",
        mode: "exactOut",
        message: "Pump sells have no native exact-output instruction",
      });
    const amountOut = request.amount.amountOut;
    const curveTokens = amountOut < curve.realTokens ? amountOut : curve.realTokens;
    const net = curveCost(curve, curveTokens);
    let fees = feesFor(net, rates, curve);
    let expectedAmountIn = net + totalFees(fees);
    if (amountOut > curve.realTokens) {
      const pool = futurePool(curve, net, options);
      const extra = amountOut - curve.realTokens;
      if (extra >= pool.base) insufficientLiquidity();
      const poolNet = ceilDiv(pool.quote * extra, pool.base - extra);
      const poolFees = feesFor(poolNet, rates, curve);
      expectedAmountIn += poolNet + totalFees(poolFees);
      fees = combineFees(fees, poolFees);
    }
    assertAmount(expectedAmountIn, "expectedAmountIn");
    return {
      kind: "exactOut",
      amountOut,
      expectedAmountOut: amountOut,
      expectedAmountIn,
      maximumAmountIn: maximumInput(expectedAmountIn, request.slippageBps),
      fees,
    };
  }
  const amountIn = request.amount.amountIn;
  let expectedAmountIn = amountIn;
  let expectedAmountOut: bigint;
  let fees: readonly SwapFee[];
  if (isBuy) {
    const input = buyNet(amountIn, rates, curve);
    if (input.net <= 1n) insufficientLiquidity();
    fees = input.fees;
    expectedAmountOut =
      ((input.net - 1n) * curve.virtualTokens) / (curve.virtualSol + input.net - 1n);
    if (expectedAmountOut > curve.realTokens) {
      const net = curveCost(curve, curve.realTokens);
      const pool = futurePool(curve, net, options);
      fees = feesFor(net, rates, curve);
      const curveTotal = net + totalFees(fees);
      const left = amountIn - curveTotal;
      const poolInput =
        left > 0n
          ? buyNet(left, rates, curve)
          : { net: 0n, fees: feesFor(0n, rates, curve) };
      const extra =
        poolInput.net > 1n
          ? ((poolInput.net - 1n) * pool.base) / (pool.quote + poolInput.net - 1n)
          : 0n;
      expectedAmountOut = curve.realTokens + extra;
      if (extra > 0n || options?.route) fees = combineFees(fees, poolInput.fees);
      else expectedAmountIn = curveTotal;
    }
  } else {
    const gross = (amountIn * curve.virtualSol) / (curve.virtualTokens + amountIn);
    if (gross > curve.realSol) insufficientLiquidity();
    fees = feesFor(gross, rates, curve);
    expectedAmountOut = gross - totalFees(fees);
  }
  if (expectedAmountOut <= 0n) insufficientLiquidity();
  assertAmount(expectedAmountOut, "expectedAmountOut");
  const minimumAmountOut = minimumOutput(expectedAmountOut, request.slippageBps);
  if (minimumAmountOut === 0n)
    fail({
      code: "INVALID_REQUEST",
      field: "slippageBps",
      message: "Slippage would permit zero output",
    });
  return {
    kind: "exactIn",
    amountIn,
    expectedAmountIn,
    expectedAmountOut,
    minimumAmountOut,
    fees,
  };
}
