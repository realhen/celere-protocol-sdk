import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU32Encoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METEORA_DLMM_PROGRAM } from "../../constants.js";

/** Identifies Meteora DLMM’s native `swap2` instruction. */
const discriminator = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);
/** Encodes the native `swap2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
  ["remainingAccountsSliceCount", getU32Encoder()],
]);

/** Accounts required by Meteora DLMM’s native `swap2` instruction. */
export interface MeteoraDlmmSwap2Accounts {
  readonly pool: Address;
  /** Null encodes the program-ID sentinel for an absent bitmap extension. */
  readonly bitmapExtension: Address | null;
  readonly reserveX: Address;
  readonly reserveY: Address;
  readonly userTokenIn: Address;
  readonly userTokenOut: Address;
  readonly tokenMintX: Address;
  readonly tokenMintY: Address;
  readonly oracle: Address;
  readonly sender: Address;
  readonly tokenProgramX: Address;
  readonly tokenProgramY: Address;
  readonly eventAuthority: Address;
  /** Caller supplies bin arrays in native traversal order. */
  readonly binArrays: readonly Address[];
}
/**
 * Native arguments for {@link swap2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface MeteoraDlmmSwap2Args {
  /**
   * Amount of input token supplied to the trade, in input-token atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL when wrapped SOL is the input mint.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly amountIn: bigint;
  /**
   * Minimum acceptable output token output, in output-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the output mint has six decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `500_000_000n` with a 1% tolerance gives
   * `495_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   */
  readonly minimumAmountOut: bigint;
}

/**
 * Creates a Meteora DLMM swap instruction for a specified input budget.
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
 *   swap2,
 *   type MeteoraDlmmSwap2Accounts,
 *   type MeteoraDlmmSwap2Args,
 * } from "celere-protocol-sdk/instructions/meteora-dlmm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MeteoraDlmmSwap2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MeteoraDlmmSwap2Args = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = swap2(accounts, args);
 * ```
 *
 * @remarks
 * Supply writable bin arrays in native traversal order for the requested direction. This
 * builder includes no host-fee or transfer-hook accounts. It does not discover missing
 * arrays. SOL uses an existing wrapped SOL account.
 *
 * @see {@link MeteoraDlmmSwap2Accounts}
 * @see {@link MeteoraDlmmSwap2Args}
 */
export function swap2(
  accounts: MeteoraDlmmSwap2Accounts,
  args: MeteoraDlmmSwap2Args,
): Instruction {
  return {
    programAddress: METEORA_DLMM_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      {
        address: accounts.bitmapExtension ?? METEORA_DLMM_PROGRAM,
        role:
          accounts.bitmapExtension === null ? AccountRole.READONLY : AccountRole.WRITABLE,
      },
      { address: accounts.reserveX, role: AccountRole.WRITABLE },
      { address: accounts.reserveY, role: AccountRole.WRITABLE },
      { address: accounts.userTokenIn, role: AccountRole.WRITABLE },
      { address: accounts.userTokenOut, role: AccountRole.WRITABLE },
      { address: accounts.tokenMintX, role: AccountRole.READONLY },
      { address: accounts.tokenMintY, role: AccountRole.READONLY },
      { address: accounts.oracle, role: AccountRole.WRITABLE },
      { address: METEORA_DLMM_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.sender, role: AccountRole.READONLY_SIGNER },
      { address: accounts.tokenProgramX, role: AccountRole.READONLY },
      { address: accounts.tokenProgramY, role: AccountRole.READONLY },
      { address: MEMO_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DLMM_PROGRAM, role: AccountRole.READONLY },
      ...accounts.binArrays.map((binArray) => ({
        address: binArray,
        role: AccountRole.WRITABLE,
      })),
    ],
    data: dataEncoder.encode({
      discriminator,
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
      remainingAccountsSliceCount: 0,
    }),
  };
}
