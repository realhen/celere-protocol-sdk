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

/** Identifies Meteora DLMM’s native `swap_exact_out2` instruction. */
const discriminator = Uint8Array.of(43, 215, 247, 132, 137, 60, 243, 81);
/** Encodes the native `swap_exact_out2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
  ["remainingAccountsSliceCount", getU32Encoder()],
]);

/** Accounts required by Meteora DLMM’s native `swap_exact_out2` instruction. */
export interface MeteoraDlmmSwapExactOut2Accounts {
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
 * Native arguments for {@link swap_exact_out2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface MeteoraDlmmSwapExactOut2Args {
  /**
   * Maximum acceptable input token input, in input-token atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL when wrapped SOL is the input mint.
   *
   * Increase the required input from a quote for the requested output by your chosen
   * slippage tolerance, rounding up in atomic units. A quote of `1_000_000_000n` with a 1%
   * tolerance gives `1_010_000_000n`. Include applicable trading fees in that input quote;
   * transaction fees and rent remain separate SOL costs.
   *
   * Zero is a zero spending limit, not an unlimited-input sentinel.
   */
  readonly maximumAmountIn: bigint;
  /**
   * Requested output token output, in output-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the output mint has six decimals.
   *
   * Quote the input required for this output, then set the maximum-input argument from
   * that quote and your chosen tolerance. This value is not a price or a slippage
   * percentage.
   */
  readonly amountOut: bigint;
}

/**
 * Creates a Meteora DLMM swap instruction for a requested output amount.
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
 * Build an output-target trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data.
 *
 * ```ts
 * import {
 *   swap_exact_out2,
 *   type MeteoraDlmmSwapExactOut2Accounts,
 *   type MeteoraDlmmSwapExactOut2Args,
 * } from "celere-protocol-sdk/instructions/meteora-dlmm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MeteoraDlmmSwapExactOut2Accounts;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: MeteoraDlmmSwapExactOut2Args = {
 *   maximumAmountIn,
 *   amountOut,
 * };
 *
 * const instruction = swap_exact_out2(accounts, args);
 * ```
 *
 * @remarks
 * Supply writable bin arrays in native traversal order for the requested direction. This
 * builder includes no host-fee or transfer-hook accounts. It does not discover missing
 * arrays. SOL uses an existing wrapped SOL account.
 *
 * @see {@link MeteoraDlmmSwapExactOut2Accounts}
 * @see {@link MeteoraDlmmSwapExactOut2Args}
 */
export function swap_exact_out2(
  accounts: MeteoraDlmmSwapExactOut2Accounts,
  args: MeteoraDlmmSwapExactOut2Args,
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
      maximumAmountIn: args.maximumAmountIn,
      amountOut: args.amountOut,
      remainingAccountsSliceCount: 0,
    }),
  };
}
