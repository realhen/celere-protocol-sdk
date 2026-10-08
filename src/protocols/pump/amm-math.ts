import {
  assertAmount,
  ceilDiv,
  maximumInput,
  minimumOutput,
} from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import type { SwapQuote, SwapRequest } from "../../core/types.js";
import { AMM_QUOTE_MINT, type PumpAmmFeeRates } from "./amm-state.js";

function insufficientLiquidity(): never {
  fail({
    code: "INSUFFICIENT_LIQUIDITY",
    protocol: "pump-amm",
    message: "Swap exceeds usable Pump AMM reserves or rounds to zero",
  });
}

function fees(amount: bigint, rates: PumpAmmFeeRates) {
  const lp = ceilDiv(amount * rates.lpBps, 10_000n);
  const protocol = ceilDiv(amount * rates.protocolBps, 10_000n);
  const creator = ceilDiv(amount * rates.creatorBps, 10_000n);
  return {
    lp,
    total: lp + protocol + creator,
    breakdown: [
      { kind: "trade" as const, mint: AMM_QUOTE_MINT, amount: lp + protocol },
      { kind: "creator" as const, mint: AMM_QUOTE_MINT, amount: creator },
    ],
  };
}

/** Native v2 integer contracts. Sell exact-output is rejected, never emulated by inverse sizing. */
export function quotePumpAmm(
  request: SwapRequest,
  isBuy: boolean,
  baseReserve: bigint,
  quoteReserve: bigint,
  virtualQuoteReserves: bigint,
  feeBuckets: bigint,
  rates: PumpAmmFeeRates,
): SwapQuote {
  const effectiveQuoteReserve = quoteReserve + virtualQuoteReserves;
  if (baseReserve === 0n || effectiveQuoteReserve <= 0n || feeBuckets > quoteReserve)
    insufficientLiquidity();
  if (request.amount.kind === "exactOut") {
    if (!isBuy)
      fail({
        code: "UNSUPPORTED_SWAP_MODE",
        protocol: "pump-amm",
        mode: "exactOut",
        message:
          "Pump AMM has no supported native base-to-quote exact-output instruction",
      });
    const amountOut = request.amount.amountOut;
    if (amountOut >= baseReserve) insufficientLiquidity();
    const netQuote = ceilDiv(effectiveQuoteReserve * amountOut, baseReserve - amountOut);
    const charged = fees(netQuote, rates);
    const expectedAmountIn = netQuote + charged.total;
    assertAmount(expectedAmountIn, "expectedAmountIn");
    return {
      kind: "exactOut",
      amountOut,
      expectedAmountIn,
      expectedAmountOut: amountOut,
      maximumAmountIn: maximumInput(expectedAmountIn, request.slippageBps),
      fees: charged.breakdown,
    };
  }
  const amountIn = request.amount.amountIn;
  let expectedAmountOut: bigint;
  let charged: ReturnType<typeof fees>;
  if (isBuy) {
    let netQuote =
      (amountIn * 10_000n) /
      (10_000n + rates.lpBps + rates.protocolBps + rates.creatorBps);
    charged = fees(netQuote, rates);
    if (netQuote + charged.total > amountIn) netQuote = amountIn - charged.total;
    if (netQuote <= 1n) insufficientLiquidity();
    expectedAmountOut =
      (baseReserve * (netQuote - 1n)) / (effectiveQuoteReserve + netQuote - 1n);
  } else {
    const grossQuote = (effectiveQuoteReserve * amountIn) / (baseReserve + amountIn);
    charged = fees(grossQuote, rates);
    if (grossQuote - charged.lp > quoteReserve - feeBuckets) insufficientLiquidity();
    expectedAmountOut = grossQuote - charged.total;
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
    fees: charged.breakdown,
  };
}
