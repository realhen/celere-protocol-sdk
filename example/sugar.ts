import {
  buy_exact_in,
  type SugarBuyExactInAccounts,
  type SugarBuyExactInArgs,
} from "celere-protocol-sdk/instructions/sugar";
import type { Instruction } from "@solana/kit";

/**
 * Builds an illustrative Sugar instruction from caller-resolved accounts.
 *
 * The amounts and quote below are hypothetical. Replace them with atomic amounts and a
 * quote for your market before using the instruction. Account fetching, wallet
 * management and submission belong to the caller. This historical interface does not
 * execute successfully against the disabled Sugar deployment.
 *
 * @param accounts - Accounts resolved and validated by your application.
 * @param bumps - Bumps returned by the matching PDA derivations.
 * @returns An unsigned instruction for the illustrated trade.
 * @throws Synchronously if the native arguments cannot be encoded.
 *
 * @example
 * Call buildExample(accounts, bumps) after resolving the accounts for your market.
 */
export function buildExample(
  accounts: SugarBuyExactInAccounts,
  bumps: Pick<SugarBuyExactInArgs, "bondingCurveBump" | "solVaultBump">,
): Instruction {
  const amountIn = 1_000_000_000n; // 1 SOL.
  const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
  const slippageBps = 100n; // 1%; chosen by the caller.
  const minimumAmountOut = (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;

  const args: SugarBuyExactInArgs = {
    bondingCurveBump: bumps.bondingCurveBump,
    solVaultBump: bumps.solVaultBump,
    solAmountInput: amountIn,
    minTokensOutput: minimumAmountOut,
  };

  return buy_exact_in(accounts, args);
}
