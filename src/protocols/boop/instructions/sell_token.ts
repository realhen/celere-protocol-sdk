import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BOOP_PROGRAM } from "../constants.js";
/** Identifies Boop’s native `sell_token` instruction. */
const DISCRIMINATOR = new Uint8Array([109, 61, 40, 187, 230, 176, 135, 174]);
/** Encodes the native `sell_token` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["sellAmount", getU64Encoder()],
  ["amountOutMin", getU64Encoder()],
]);
/** Accounts required by Boop’s native `sell_token` instruction. */
export interface BoopSellTokenAccounts {
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly tradingFeesVault: Address;
  readonly bondingCurveVault: Address;
  readonly bondingCurveSolVault: Address;
  readonly sellerTokenAccount: Address;
  readonly seller: Address;
  readonly recipient: Address;
  readonly config: Address;
}
/**
 * Native arguments for {@link sell_token}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface BoopSellTokenArgs {
  /**
   * Amount of base token supplied to the trade, in base-token atomic units. For example,
   * `500_000_000_000n` means 500 tokens when the base mint has nine decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly sellAmount: bigint;
  /**
   * Minimum acceptable native SOL output, in lamports. For example, `1_000_000_000n` means
   * 1 SOL.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `1_000_000_000n` with a 1% tolerance gives
   * `990_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   */
  readonly amountOutMin: bigint;
}
/**
 * Creates a Boop sell instruction for a specified input budget.
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
 *   sell_token,
 *   type BoopSellTokenAccounts,
 *   type BoopSellTokenArgs,
 * } from "celere-protocol-sdk/instructions/boop";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: BoopSellTokenAccounts;
 *
 * const amountIn = 500_000_000_000n; // 500 base tokens with nine decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: BoopSellTokenArgs = {
 *   sellAmount: amountIn,
 *   amountOutMin: minimumAmountOut,
 * };
 *
 * const instruction = sell_token(accounts, args);
 * ```
 *
 * @remarks
 * SOL moves as native lamports. Prepare the recipient token account before execution.
 *
 * @see {@link BoopSellTokenAccounts}
 * @see {@link BoopSellTokenArgs}
 */
export function sell_token(
  accounts: BoopSellTokenAccounts,
  args: BoopSellTokenArgs,
): Instruction {
  return {
    programAddress: BOOP_PROGRAM,
    accounts: [
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.tradingFeesVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.sellerTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.seller, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.recipient, role: AccountRole.WRITABLE },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: DISCRIMINATOR,
      sellAmount: args.sellAmount,
      amountOutMin: args.amountOutMin,
    }),
  };
}
