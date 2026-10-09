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

/** Identifies PumpSwap’s native `sell_v2` instruction. */
const DISCRIMINATOR = new Uint8Array([93, 246, 130, 60, 231, 233, 64, 178]);
/** Encodes the native `sell_v2` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["baseAmountIn", getU64Encoder()],
  ["minQuoteAmountOut", getU64Encoder()],
]);

/** Accounts required by PumpSwap’s native `sell_v2` instruction. */
export interface PumpAmmSellV2Accounts {
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
 * Native arguments for {@link sell_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpAmmSellV2Args {
  /**
   * Amount of base token supplied to the trade, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly baseAmountIn: bigint;
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
  readonly minQuoteAmountOut: bigint;
}

/**
 * Creates a PumpSwap sell instruction for a specified input budget.
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
 *   sell_v2,
 *   type PumpAmmSellV2Accounts,
 *   type PumpAmmSellV2Args,
 * } from "celere-protocol-sdk/instructions/pump-amm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpAmmSellV2Accounts;
 *
 * const amountIn = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpAmmSellV2Args = {
 *   baseAmountIn: amountIn,
 *   minQuoteAmountOut: minimumAmountOut,
 * };
 *
 * const instruction = sell_v2(accounts, args);
 * ```
 *
 * @remarks
 * Both assets use SPL token accounts. Fund wrapped SOL before executing a SOL-paired
 * swap; this builder does not wrap or unwrap SOL.
 *
 * @see {@link PumpAmmSellV2Accounts}
 * @see {@link PumpAmmSellV2Args}
 */
export function sell_v2(
  accounts: PumpAmmSellV2Accounts,
  args: PumpAmmSellV2Args,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    baseAmountIn: args.baseAmountIn,
    minQuoteAmountOut: args.minQuoteAmountOut,
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
