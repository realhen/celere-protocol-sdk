import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_AMM_PROGRAM } from "../../constants.js";

/** Identifies PumpSwap’s native `buy_exact_quote_in_v2` instruction. */
const DISCRIMINATOR = new Uint8Array([194, 171, 28, 70, 104, 77, 91, 47]);
/** Encodes the native `buy_exact_quote_in_v2` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["spendableQuoteIn", getU64Encoder()],
  ["minBaseAmountOut", getU64Encoder()],
]);

/** Accounts required by PumpSwap’s native `buy_exact_quote_in_v2` instruction. */
export interface PumpAmmBuyExactQuoteInV2Accounts {
  readonly pool: Address;
  readonly user: Address;
  readonly globalConfig: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly userBaseTokenAccount: Address;
  readonly userQuoteTokenAccount: Address;
  readonly poolBaseTokenAccount: Address;
  readonly poolQuoteTokenAccount: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly systemProgram: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly buybackFeeRecipient: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link buy_exact_quote_in_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpAmmBuyExactQuoteInV2Args {
  /**
   * Amount of quote asset supplied to the trade, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * This budget includes PumpSwap trading fees.
   */
  readonly spendableQuoteIn: bigint;
  /**
   * Minimum acceptable base token output, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `500_000_000n` with a 1% tolerance gives
   * `495_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   */
  readonly minBaseAmountOut: bigint;
}

/**
 * Creates a PumpSwap buy instruction for a specified input budget.
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
 *   buy_exact_quote_in_v2,
 *   type PumpAmmBuyExactQuoteInV2Accounts,
 *   type PumpAmmBuyExactQuoteInV2Args,
 * } from "celere-protocol-sdk/instructions/pump-amm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpAmmBuyExactQuoteInV2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpAmmBuyExactQuoteInV2Args = {
 *   spendableQuoteIn: amountIn,
 *   minBaseAmountOut: minimumAmountOut,
 * };
 *
 * const instruction = buy_exact_quote_in_v2(accounts, args);
 * ```
 *
 * @remarks
 * Both assets use SPL token accounts. Fund wrapped SOL before executing a SOL-paired
 * swap; this builder does not wrap or unwrap SOL.
 *
 * @see {@link PumpAmmBuyExactQuoteInV2Accounts}
 * @see {@link PumpAmmBuyExactQuoteInV2Args}
 */
export function buy_exact_quote_in_v2(
  accounts: PumpAmmBuyExactQuoteInV2Accounts,
  args: PumpAmmBuyExactQuoteInV2Args,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    spendableQuoteIn: args.spendableQuoteIn,
    minBaseAmountOut: args.minBaseAmountOut,
  });
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.userBaseTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.poolBaseTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.poolQuoteTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
