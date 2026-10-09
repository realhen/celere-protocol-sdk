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
import { WRAPPED_SOL_MINT } from "../../../accounts/tokens.js";
import { BOOP_PROGRAM } from "../constants.js";
/** Identifies Boop’s native `buy_token` instruction. */
const DISCRIMINATOR = new Uint8Array([138, 127, 14, 91, 38, 87, 115, 105]);
/** Encodes the native `buy_token` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["buyAmount", getU64Encoder()],
  ["amountOutMin", getU64Encoder()],
]);
/** Accounts required by Boop’s native `buy_token` instruction. */
export interface BoopBuyTokenAccounts {
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly tradingFeesVault: Address;
  readonly bondingCurveVault: Address;
  readonly bondingCurveSolVault: Address;
  readonly recipientTokenAccount: Address;
  readonly buyer: Address;
  readonly config: Address;
  readonly vaultAuthority: Address;
}
/**
 * Native arguments for {@link buy_token}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface BoopBuyTokenArgs {
  /**
   * Amount of native SOL supplied to the trade, in lamports. For example, `1_000_000_000n`
   * means 1 SOL.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * See the instruction’s execution caveat below; the native buy is not a full-fill
   * guarantee.
   */
  readonly buyAmount: bigint;
  /**
   * Minimum acceptable base token output, in base-token atomic units. For example,
   * `500_000_000_000n` means 500 tokens when the base mint has nine decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `500_000_000_000n` with a 1% tolerance gives
   * `495_000_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   *
   * See the instruction’s execution caveat below; the native buy is not a full-fill
   * guarantee.
   */
  readonly amountOutMin: bigint;
}
/**
 * Creates a Boop buy instruction for a specified input budget.
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
 *   buy_token,
 *   type BoopBuyTokenAccounts,
 *   type BoopBuyTokenArgs,
 * } from "celere-protocol-sdk/instructions/boop";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: BoopBuyTokenAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 SOL.
 * const quotedAmountOut = 500_000_000_000n; // Hypothetical quote: 500 base tokens with nine decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: BoopBuyTokenArgs = {
 *   buyAmount: amountIn,
 *   amountOutMin: minimumAmountOut,
 * };
 *
 * const instruction = buy_token(accounts, args);
 * ```
 *
 * @remarks
 * SOL moves as native lamports. Prepare the recipient token account before execution.
 * Graduation can clip the input debit and token output to the remaining curve inventory.
 * This instruction does not guarantee a full fill.
 *
 * @see {@link BoopBuyTokenAccounts}
 * @see {@link BoopBuyTokenArgs}
 */
export function buy_token(
  accounts: BoopBuyTokenAccounts,
  args: BoopBuyTokenArgs,
): Instruction {
  return {
    programAddress: BOOP_PROGRAM,
    accounts: [
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.tradingFeesVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.recipientTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.vaultAuthority, role: AccountRole.READONLY },
      { address: WRAPPED_SOL_MINT, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: DISCRIMINATOR,
      buyAmount: args.buyAmount,
      amountOutMin: args.amountOutMin,
    }),
  };
}
