import {
  assertAmount,
  ceilDiv,
  maximumInput,
  minimumOutput,
} from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import type { SwapFee, SwapQuote, SwapRequest } from "../../core/types.js";
import { NATIVE_SOL_MINT, type PumpCurve, type PumpFees } from "./state.js";

function insufficientLiquidity(): never {
  fail({
    code: "INSUFFICIENT_LIQUIDITY",
    protocol: "pump",
    message: "Swap exceeds the supported bonding curve liquidity",
  });
}

function feesFor(amount: bigint, rates: PumpFees) {
  return [
    {
      kind: "trade" as const,
      mint: NATIVE_SOL_MINT,
      amount: ceilDiv(amount * rates.protocolBps, 10_000n),
    },
    {
      kind: "creator" as const,
      mint: NATIVE_SOL_MINT,
      amount: ceilDiv(amount * rates.creatorBps, 10_000n),
    },
  ];
}

/** Mirrors the native Pump buy, buy_exact_sol_in and sell integer contracts; no inverse execution modes. */
export function quotePump(
  request: SwapRequest,
  curve: PumpCurve,
  rates: PumpFees,
  isBuy: boolean,
): SwapQuote {
  if (request.amount.kind === "exactOut") {
    if (!isBuy)
      fail({
        code: "UNSUPPORTED_SWAP_MODE",
        protocol: "pump",
        mode: "exactOut",
        message:
          "Pump token-to-SOL swaps have no supported native exact-output instruction",
      });
    const amountOut = request.amount.amountOut;
    if (amountOut > curve.realTokens || amountOut >= curve.virtualTokens)
      insufficientLiquidity();
    const netSol =
      (amountOut * curve.virtualSol) / (curve.virtualTokens - amountOut) + 1n;
    const fees = feesFor(netSol, rates);
    const expectedAmountIn = netSol + fees.reduce((sum, fee) => sum + fee.amount, 0n);
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
  let netSol: bigint;
  let expectedAmountOut: bigint;
  let fees: readonly SwapFee[];
  if (isBuy) {
    netSol = (amountIn * 10_000n) / (10_000n + rates.protocolBps + rates.creatorBps);
    fees = feesFor(netSol, rates);
    const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0n);
    if (netSol + totalFees > amountIn) netSol -= netSol + totalFees - amountIn;
    if (netSol <= 1n) insufficientLiquidity();
    expectedAmountOut =
      ((netSol - 1n) * curve.virtualTokens) / (curve.virtualSol + netSol - 1n);
    if (expectedAmountOut > curve.realTokens) insufficientLiquidity();
  } else {
    netSol = (amountIn * curve.virtualSol) / (curve.virtualTokens + amountIn);
    if (netSol > curve.realSol) insufficientLiquidity();
    fees = feesFor(netSol, rates);
    expectedAmountOut = netSol - fees.reduce((sum, fee) => sum + fee.amount, 0n);
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
    expectedAmountIn: amountIn,
    expectedAmountOut,
    minimumAmountOut,
    fees,
  };
}
