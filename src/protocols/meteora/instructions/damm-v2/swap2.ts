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
import { METEORA_DAMM_V2_PROGRAM } from "../../constants.js";

/** Identifies Meteora DAMM v2’s native `swap2` instruction. */
const discriminator = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);
/** Encodes the native `swap2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["swapMode", getU8Encoder()],
]);

/** Accounts required by Meteora DAMM v2’s native `swap2` instruction. */
export interface MeteoraDammV2Swap2Accounts {
  readonly poolAuthority: Address;
  readonly pool: Address;
  readonly userInputToken: Address;
  readonly userOutputToken: Address;
  readonly tokenVaultA: Address;
  readonly tokenVaultB: Address;
  readonly tokenMintA: Address;
  readonly tokenMintB: Address;
  readonly payer: Address;
  readonly tokenProgramA: Address;
  readonly tokenProgramB: Address;
  readonly eventAuthority: Address;
}
/**
 * Native arguments for {@link swap2}.
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
export interface MeteoraDammV2Swap2Args {
  /**
   * Specified swap amount in atomic units of the asset selected by swapMode.
   *
   * With swapMode = 0 or 1, this is the input amount (for example, `1_000_000_000n` for 1
   * wrapped SOL). With swapMode = 2, it is the requested output (for example,
   * `500_000_000n` for 500 tokens with six decimals). Read both mints’ decimals; changing
   * mode also changes this field’s unit.
   */
  readonly amount: bigint;
  /**
   * Slippage bound in atomic units of the asset opposite to amount.
   *
   * With swapMode = 0 or 1, supply the minimum output, using the recipient’s quoted output
   * after applicable fees and rounding down: `500_000_000n` quoted output with 1%
   * tolerance becomes `495_000_000n`.
   *
   * With swapMode = 2, supply the maximum input, including applicable trading fees and
   * rounding up: `1_000_000_000n` quoted input with 1% tolerance becomes `1_010_000_000n`.
   * Zero disables a positive output floor in input mode, but is a zero spending cap in
   * output mode.
   */
  readonly otherAmountThreshold: bigint;
  /**
   * Native amount interpretation: 0 spends the specified input, 1 permits a partial input
   * fill, and 2 requests the specified output.
   *
   * Use 0 with an input amount and minimum output; use 2 with an output amount and maximum
   * input. With 1, the program may consume less input, so evaluate the execution result
   * rather than assuming the entire budget was spent.
   */
  readonly swapMode: 0 | 1 | 2;
}

/**
 * Creates a Meteora DAMM v2 swap instruction with caller-selected amount interpretation.
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
 *   swap2,
 *   type MeteoraDammV2Swap2Accounts,
 *   type MeteoraDammV2Swap2Args,
 * } from "celere-protocol-sdk/instructions/meteora-damm-v2";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MeteoraDammV2Swap2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MeteoraDammV2Swap2Args = {
 *   amount: amountIn,
 *   otherAmountThreshold: minimumAmountOut,
 *   swapMode: 0,
 * };
 *
 * const instruction = swap2(accounts, args);
 * ```
 *
 * @remarks
 * The referral account is fixed to the program-ID sentinel. Select direction with the
 * supplied input and output token accounts. SOL uses an existing wrapped SOL account.
 *
 * @see {@link MeteoraDammV2Swap2Accounts}
 * @see {@link MeteoraDammV2Swap2Args}
 */
export function swap2(
  accounts: MeteoraDammV2Swap2Accounts,
  args: MeteoraDammV2Swap2Args,
): Instruction {
  return {
    programAddress: METEORA_DAMM_V2_PROGRAM,
    accounts: [
      { address: accounts.poolAuthority, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userInputToken, role: AccountRole.WRITABLE },
      { address: accounts.userOutputToken, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultA, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultB, role: AccountRole.WRITABLE },
      { address: accounts.tokenMintA, role: AccountRole.READONLY },
      { address: accounts.tokenMintB, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.READONLY_SIGNER },
      { address: accounts.tokenProgramA, role: AccountRole.READONLY },
      { address: accounts.tokenProgramB, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amount: args.amount,
      otherAmountThreshold: args.otherAmountThreshold,
      swapMode: args.swapMode,
    }),
  };
}
