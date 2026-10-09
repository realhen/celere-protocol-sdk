import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
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
import { METEORA_DBC_PROGRAM, METEORA_DBC_AUTHORITY } from "../constants.js";
/** Identifies Meteora DBC’s native `swap2` instruction. */
const discriminator = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);
/** Encodes the native `swap2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["swapMode", getU8Encoder()],
]);
/** Accounts required by Meteora DBC’s native `swap2` instruction. */
export interface MeteoraDbcSwap2Accounts {
  readonly config: Address;
  readonly pool: Address;
  readonly inputTokenAccount: Address;
  readonly outputTokenAccount: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly payer: Address;
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
export interface MeteoraDbcSwap2Args {
  /**
   * Specified swap amount in atomic units of the asset selected by swapMode.
   *
   * With swapMode = 0, this is the input amount (for example, `1_000_000_000n` for 1
   * wrapped SOL). With swapMode = 2, it is the requested output (for example,
   * `500_000_000n` for 500 tokens with six decimals). Read both mints’ decimals; changing
   * mode also changes this field’s unit.
   */
  readonly amount: bigint;
  /**
   * Slippage bound in atomic units of the asset opposite to amount.
   *
   * With swapMode = 0, supply the minimum output, using the recipient’s quoted output
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
   * Native amount interpretation: 0 is full-fill exact input; 2 is exact output.
   *
   * Use 0 with an input amount and minimum output, or 2 with an output amount and maximum
   * input. Native partial-fill mode 1 is not exposed by this builder.
   */
  readonly swapMode: 0 | 2;
}
/**
 * Creates a Meteora DBC swap instruction with caller-selected amount interpretation.
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
 *   type MeteoraDbcSwap2Accounts,
 *   type MeteoraDbcSwap2Args,
 * } from "celere-protocol-sdk/instructions/meteora-dbc";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MeteoraDbcSwap2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MeteoraDbcSwap2Args = {
 *   amount: amountIn,
 *   otherAmountThreshold: minimumAmountOut,
 *   swapMode: 0,
 * };
 *
 * const instruction = swap2(accounts, args);
 * ```
 *
 * @remarks
 * This builder exposes full-fill exact input (mode 0) and exact output (mode 2); native
 * partial-fill mode 1 is not exposed. Both token programs are fixed to the classic SPL
 * Token program. The referral account is the program-ID sentinel; no dynamic remaining
 * accounts are appended. SOL uses wrapped SOL.
 *
 * @see {@link MeteoraDbcSwap2Accounts}
 * @see {@link MeteoraDbcSwap2Args}
 */
export function swap2(
  accounts: MeteoraDbcSwap2Accounts,
  args: MeteoraDbcSwap2Args,
): Instruction {
  return {
    programAddress: METEORA_DBC_PROGRAM,
    accounts: [
      { address: METEORA_DBC_AUTHORITY, role: AccountRole.READONLY },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.outputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.READONLY_SIGNER },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: METEORA_DBC_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DBC_PROGRAM, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amount: args.amount,
      otherAmountThreshold: args.otherAmountThreshold,
      swapMode: args.swapMode,
    }),
  };
}
