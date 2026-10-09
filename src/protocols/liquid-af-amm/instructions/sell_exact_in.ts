import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Instruction,
} from "@solana/kit";
import {
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_EVENTS_PROGRAM,
} from "../../liquid-af/constants.js";
import { LIQUID_AF_AMM_PROGRAM } from "../constants.js";
import type { LiquidAfAmmSwapAccounts } from "./accounts.js";

/**
 * Native arguments for {@link sell_exact_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface LiquidAfAmmSellExactInArgs {
  /**
   * Amount of base token supplied to the trade, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly amountIn: bigint;
  /**
   * Minimum acceptable quote asset output, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `1_000_000_000n` with a 1% tolerance gives
   * `990_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   */
  readonly minimumAmountOut: bigint;
}

/** Encodes the native `sell_exact_in` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Creates a LiquidAF AMM sell instruction for a specified input budget.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range.
 * On-chain account, balance, price, and slippage failures occur during execution, not
 * during construction.
 *
 * @example
 * Build an input-budget trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data.
 *
 * ```ts
 * import {
 *   sell_exact_in,
 *   type LiquidAfAmmSwapAccounts,
 *   type LiquidAfAmmSellExactInArgs,
 * } from "celere-protocol-sdk/instructions/liquid-af-amm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: LiquidAfAmmSwapAccounts;
 *
 * const amountIn = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: LiquidAfAmmSellExactInArgs = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = sell_exact_in(accounts, args);
 * ```
 *
 * @remarks
 * Both assets use token accounts. Fund wrapped SOL before executing a SOL-paired swap.
 * An omitted oracle account uses the Anchor program-ID sentinel.
 *
 * @see {@link LiquidAfAmmSwapAccounts}
 * @see {@link LiquidAfAmmSellExactInArgs}
 */
export function sell_exact_in(
  accounts: LiquidAfAmmSwapAccounts,
  args: LiquidAfAmmSellExactInArgs,
): Instruction {
  return {
    programAddress: LIQUID_AF_AMM_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userBaseAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.observationState, role: AccountRole.WRITABLE },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.protocolFeeVault, role: AccountRole.WRITABLE },
      { address: accounts.feeVault, role: AccountRole.READONLY },
      { address: accounts.feeVaultTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.buybackVault, role: AccountRole.WRITABLE },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.creator, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.userProperties, role: AccountRole.WRITABLE },
      { address: accounts.globalAmmVolume, role: AccountRole.WRITABLE },
      { address: accounts.tokenVolume, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.cashbackConfig, role: AccountRole.READONLY },
      { address: LIQUID_AF_STATE_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.stateEventsCpiAuthority, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.cpiAuthority, role: AccountRole.READONLY },
      { address: LIQUID_AF_EVENTS_PROGRAM, role: AccountRole.READONLY },
      {
        address: accounts.oraclePriceFeed ?? LIQUID_AF_AMM_PROGRAM,
        role: AccountRole.READONLY,
      },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([149, 39, 222, 155, 211, 124, 152, 26]),
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
    }),
  };
}
