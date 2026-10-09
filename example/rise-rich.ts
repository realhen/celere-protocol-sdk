import {
  buy_with_exact_cash_in,
  type RiseRichBuyExactCashInAccounts,
  type RiseRichBuyExactCashInArgs,
} from "celere-protocol-sdk/instructions/rise-rich";
import type { Instruction } from "@solana/kit";

/**
 * Builds an illustrative Rise Rich instruction from caller-resolved accounts.
 *
 * The amounts and quote below are hypothetical. Replace them with atomic amounts and a
 * quote for your market before using the instruction. Account fetching, wallet
 * management and submission belong to the caller. The optional floor raise is disabled.
 *
 * @param accounts - Accounts resolved and validated by your application.
 * @returns An unsigned instruction for the illustrated trade.
 * @throws Synchronously if the native arguments cannot be encoded.
 *
 * @example
 * Call buildExample(accounts) after resolving the accounts for your market.
 */
export function buildExample(accounts: RiseRichBuyExactCashInAccounts): Instruction {
  const amountIn = 1_000_000_000n; // 1 wrapped SOL.
  const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
  const slippageBps = 100n; // 1%; chosen by the caller.
  const minimumAmountOut = (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;

  const args: RiseRichBuyExactCashInArgs = {
    cashIn: amountIn,
    minTokenOut: minimumAmountOut,
    newShoulderEnd: 0n,
    floorIncreaseRatio: new Uint8Array(16),
    maxNewFloor: new Uint8Array(16),
    maxAreaShrinkageToleranceUnits: 0n,
    minLiqRatio: new Uint8Array(16),
  };

  return buy_with_exact_cash_in(accounts, args);
}
