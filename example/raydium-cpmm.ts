import {
  swap_base_input,
  type RaydiumCpmmSwapBaseInputAccounts,
  type RaydiumCpmmSwapBaseInputArgs,
} from "celere-protocol-sdk/instructions/raydium-cpmm";
import type { Instruction } from "@solana/kit";

/**
 * Builds an illustrative Raydium CPMM instruction from caller-resolved accounts.
 *
 * The amounts and quote below are hypothetical. Replace them with atomic amounts and a
 * quote for your market before using the instruction. Account fetching, wallet
 * management and submission belong to the caller.
 *
 * @param accounts - Accounts resolved and validated by your application.
 * @returns An unsigned instruction for the illustrated trade.
 * @throws Synchronously if the native arguments cannot be encoded.
 *
 * @example
 * Call buildExample(accounts) after resolving the accounts for your market.
 */
export function buildExample(accounts: RaydiumCpmmSwapBaseInputAccounts): Instruction {
  const amountIn = 1_000_000_000n; // 1 wrapped SOL.
  const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
  const slippageBps = 100n; // 1%; chosen by the caller.
  const minimumAmountOut = (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;

  const args: RaydiumCpmmSwapBaseInputArgs = {
    amountIn,
    minimumAmountOut,
  };

  return swap_base_input(accounts, args);
}
