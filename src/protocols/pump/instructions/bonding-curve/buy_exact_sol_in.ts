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
import { PUMP_PROGRAM } from "../../constants.js";

/** Identifies Pump bonding curve’s native `buy_exact_sol_in` instruction. */
const DISCRIMINATOR = new Uint8Array([56, 252, 116, 8, 158, 223, 205, 95]);
/** Encodes the native `buy_exact_sol_in` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["spendableSolIn", getU64Encoder()],
  ["minTokensOut", getU64Encoder()],
  ["trackVolume", getU8Encoder()],
  ["partialFill", getU8Encoder()],
]);

/** Accounts required by Pump bonding curve’s native `buy_exact_sol_in` instruction. */
export interface PumpBuyExactSolInAccounts {
  readonly global: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly associatedBondingCurve: Address;
  readonly associatedUser: Address;
  readonly user: Address;
  readonly systemProgram: Address;
  readonly tokenProgram: Address;
  readonly creatorVault: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly globalVolumeAccumulator: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly feeProgram: Address;
  readonly bondingCurveV2: Address;
  readonly buybackFeeRecipient: Address;
}

/**
 * Native arguments for {@link buy_exact_sol_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpBuyExactSolInArgs {
  /**
   * Amount of native SOL supplied to the trade, in lamports. For example, `1_000_000_000n`
   * means 1 SOL.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * This budget includes Pump trading fees.
   */
  readonly spendableSolIn: bigint;
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
  readonly minTokensOut: bigint;
}

/**
 * Creates a Pump bonding curve buy instruction for a specified input budget.
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
 *   buy_exact_sol_in,
 *   type PumpBuyExactSolInAccounts,
 *   type PumpBuyExactSolInArgs,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpBuyExactSolInAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpBuyExactSolInArgs = {
 *   spendableSolIn: amountIn,
 *   minTokensOut: minimumAmountOut,
 * };
 *
 * const instruction = buy_exact_sol_in(accounts, args);
 * ```
 *
 * @remarks
 * This is the legacy SOL-only instruction. SOL moves as native lamports; prepare the
 * user’s base-token account before execution. The native trackVolume and partialFill
 * flags are fixed to false.
 *
 * @see {@link PumpBuyExactSolInAccounts}
 * @see {@link PumpBuyExactSolInArgs}
 */
export function buy_exact_sol_in(
  accounts: PumpBuyExactSolInAccounts,
  args: PumpBuyExactSolInArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    spendableSolIn: args.spendableSolIn,
    minTokensOut: args.minTokensOut,
    trackVolume: 0,
    partialFill: 0,
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
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.creatorVault, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.globalVolumeAccumulator, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.feeProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurveV2, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
