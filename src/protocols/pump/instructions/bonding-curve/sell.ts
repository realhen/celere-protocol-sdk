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

/** Identifies Pump bonding curve’s native `sell` instruction. */
const DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);
/** Encodes the native `sell` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["minSolOutput", getU64Encoder()],
]);

/** Accounts required by Pump bonding curve’s native `sell` instruction. */
export interface PumpSellAccounts {
  readonly global: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly associatedBondingCurve: Address;
  readonly associatedUser: Address;
  readonly user: Address;
  readonly systemProgram: Address;
  readonly creatorVault: Address;
  readonly tokenProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly feeConfig: Address;
  readonly feeProgram: Address;
  readonly bondingCurveV2: Address;
  readonly buybackFeeRecipient: Address;
}

/**
 * Native arguments for {@link sell}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpSellArgs {
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
 *   sell,
 *   type PumpSellAccounts,
 *   type PumpSellArgs,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpSellAccounts;
 *
 * const amountIn = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpSellArgs = {
 *   amount: amountIn,
 *   minSolOutput: minimumAmountOut,
 * };
 *
 * const instruction = sell(accounts, args);
 * ```
 *
 * @remarks
 * This is the legacy SOL-only instruction. SOL moves as native lamports; prepare the
 * user’s base-token account before execution.
 *
 * @see {@link PumpSellAccounts}
 * @see {@link PumpSellArgs}
 */
export function sell(accounts: PumpSellAccounts, args: PumpSellArgs): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    minSolOutput: args.minSolOutput,
  });
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedUser, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.creatorVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.feeProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurveV2, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
