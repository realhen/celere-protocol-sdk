import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_PROGRAM } from "../../constants.js";

/** Identifies Pump bonding curve’s native `sell_v3` instruction. */
const DISCRIMINATOR = new Uint8Array([28, 146, 222, 119, 38, 196, 105, 213]);
/** Encodes the native `sell_v3` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["minSolOutput", getU64Encoder()],
]);

/** Accounts required by Pump bonding curve’s native `sell_v3` instruction. */
export interface PumpSellV3Accounts {
  readonly global: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly bondingCurve: Address;
  readonly associatedBaseBondingCurve: Address;
  readonly associatedQuoteBondingCurve: Address;
  readonly user: Address;
  readonly associatedBaseUser: Address;
  readonly associatedQuoteUser: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly buybackFeeRecipient: Address;
  readonly systemProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link sell_v3}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpSellV3Args {
  /**
   * Amount of base token supplied to the trade, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly amount: bigint;
  /**
   * Minimum acceptable quote asset output, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 SOL on a SOL-paired curve; `10_000_000n` means 10 USDC with
   * six decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `1_000_000_000n` with a 1% tolerance gives
   * `990_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   *
   * Despite the native SOL-oriented name, this field uses the market’s quote asset:
   * lamports for native SOL or atomic token units for a token-quoted market.
   */
  readonly minSolOutput: bigint;
}

/**
 * Creates a Pump bonding curve sell instruction for a specified input budget.
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
 *   sell_v3,
 *   type PumpSellV3Accounts,
 *   type PumpSellV3Args,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpSellV3Accounts;
 *
 * const amountIn = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpSellV3Args = {
 *   amount: amountIn,
 *   minSolOutput: minimumAmountOut,
 * };
 *
 * const instruction = sell_v3(accounts, args);
 * ```
 *
 * @remarks
 * For native SOL markets, quote ATAs are unused placeholders; the program spends or
 * credits lamports. For token-quoted markets, prepare the quote token accounts,
 * including the buyback recipient’s quote ATA. Protocol and creator fees remain accrued
 * on the curve until swept.
 *
 * @see {@link PumpSellV3Accounts}
 * @see {@link PumpSellV3Args}
 */
export function sell_v3(accounts: PumpSellV3Accounts, args: PumpSellV3Args): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    minSolOutput: args.minSolOutput,
  });
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedBaseBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.associatedBaseUser, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteUser, role: AccountRole.WRITABLE },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
