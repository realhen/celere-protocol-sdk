import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { MOONSHOT_PROGRAM } from "../constants.js";

/** Identifies Moonshot / Moonit’s native `sell` instruction. */
const DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);
/** Encodes the native `sell` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["tokenAmount", getU64Encoder()],
  ["collateralAmount", getU64Encoder()],
  ["fixedSide", getU8Encoder()],
  ["slippageBps", getU64Encoder()],
]);

/** Accounts required by Moonshot / Moonit’s native `sell` instruction. */
export interface MoonshotSellAccounts {
  readonly sender: Address;
  readonly senderTokenAccount: Address;
  readonly curveAccount: Address;
  readonly curveTokenAccount: Address;
  readonly dexFee: Address;
  readonly helioFee: Address;
  readonly mint: Address;
  readonly configAccount: Address;
  readonly tokenProgram: Address;
  readonly associatedTokenProgram: Address;
  readonly systemProgram: Address;
}

/**
 * Native arguments for {@link sell}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Mode-specific
 * fields have their own documented meanings. Encoding successfully does not establish
 * that the trade can execute.
 */
export interface MoonshotSellArgs {
  /**
   * Base-token quantity in atomic units; `500_000_000_000n` means 500 tokens with nine
   * decimals.
   *
   * For fixedSide = 0, this is the exact input. For fixedSide = 1, this is the maximum
   * input, including trading fees and rounded up.
   *
   * Apply your tolerance to the unfixed side before calling the builder. For a 1%
   * tolerance, a `500_000_000_000n` quote becomes `495_000_000_000n` as an output minimum or
   * `505_000_000_000n` as an input maximum. Native slippage is already fixed to zero by this
   * builder.
   */
  readonly tokenAmount: bigint;
  /**
   * Native SOL quantity in lamports; `1_000_000_000n` means 1 SOL.
   *
   * For fixedSide = 0, this is the minimum output, calculated from the recipient’s net
   * output quote and rounded down. For fixedSide = 1, this is the requested output.
   *
   * Apply your tolerance to the unfixed side before calling the builder. For a 1%
   * tolerance, a `1_000_000_000n` quote becomes `990_000_000n` as an output minimum or
   * `1_010_000_000n` as an input maximum. Native slippage is already fixed to zero by this
   * builder.
   */
  readonly collateralAmount: bigint;
  /**
   * Selects the amount fixed by the trade: 0 fixes input and 1 fixes output.
   *
   * For a buy, input is SOL and output is the base token. For a sell, input is the base
   * token and output is SOL. The other amount must already contain the caller’s
   * minimum-output or maximum-input bound.
   */
  readonly fixedSide: 0 | 1;
}

/**
 * Creates a Moonshot / Moonit sell instruction with caller-selected amount
 * interpretation.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts, mode selection and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range.
 * On-chain account, balance, price, and slippage failures occur during execution, not
 * during construction.
 *
 * @example
 * Build an input-budget trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data. This example selects exact
 * input.
 *
 * ```ts
 * import {
 *   sell,
 *   type MoonshotSellAccounts,
 *   type MoonshotSellArgs,
 * } from "celere-protocol-sdk/instructions/moonshot";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MoonshotSellAccounts;
 *
 * const amountIn = 500_000_000_000n; // 500 base tokens with nine decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MoonshotSellArgs = {
 *   tokenAmount: amountIn,
 *   collateralAmount: minimumAmountOut,
 *   fixedSide: 0,
 * };
 *
 * const instruction = sell(accounts, args);
 * ```
 *
 * @remarks
 * The collateral is native SOL, not a wrapped token-account debit. Native slippageBps is
 * fixed to zero: the amount on the unfixed side must already include the caller’s
 * tolerance and rounding. No second slippage adjustment is applied.
 *
 * @see {@link MoonshotSellAccounts}
 * @see {@link MoonshotSellArgs}
 */
export function sell(
  accounts: MoonshotSellAccounts,
  args: MoonshotSellArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    tokenAmount: args.tokenAmount,
    collateralAmount: args.collateralAmount,
    fixedSide: args.fixedSide,
    slippageBps: 0n,
  });
  return {
    programAddress: MOONSHOT_PROGRAM,
    accounts: [
      { address: accounts.sender, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.senderTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.curveAccount, role: AccountRole.WRITABLE },
      { address: accounts.curveTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.dexFee, role: AccountRole.WRITABLE },
      { address: accounts.helioFee, role: AccountRole.WRITABLE },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.configAccount, role: AccountRole.READONLY },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.associatedTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
    ],
    data,
  };
}
