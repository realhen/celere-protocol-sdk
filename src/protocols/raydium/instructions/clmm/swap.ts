import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  getU128Encoder,
  getU8Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_CLMM_PROGRAM } from "../../constants.js";

/** Accounts required by Raydium CLMM’s native `swap` instruction. */
export interface RaydiumClmmSwapAccounts {
  readonly owner: Address;
  readonly config: Address;
  readonly pool: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly inputVault: Address;
  readonly outputVault: Address;
  readonly observation: Address;
  readonly tickArrayBitmap: Address;
  /** Writable remaining tick arrays in native traversal order, before the bitmap. */
  readonly tickArrays: readonly Address[];
}

/**
 * Native arguments for {@link swap}.
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
export interface RaydiumClmmSwapArgs {
  /**
   * Specified swap amount in atomic units of the asset selected by isBaseInput.
   *
   * With isBaseInput = true, this is the input amount (for example, `1_000_000_000n` for 1
   * wrapped SOL). With isBaseInput = false, it is the requested output (for example,
   * `500_000_000n` for 500 tokens with six decimals). Read both mints’ decimals; changing
   * mode also changes this field’s unit.
   */
  readonly amount: bigint;
  /**
   * Slippage bound in atomic units of the asset opposite to amount.
   *
   * With isBaseInput = true, supply the minimum output, using the recipient’s quoted
   * output after applicable fees and rounding down: `500_000_000n` quoted output with 1%
   * tolerance becomes `495_000_000n`.
   *
   * With isBaseInput = false, supply the maximum input, including applicable trading fees
   * and rounding up: `1_000_000_000n` quoted input with 1% tolerance becomes
   * `1_010_000_000n`. Zero disables a positive output floor in input mode, but is a zero
   * spending cap in output mode.
   */
  readonly otherAmountThreshold: bigint;
  /**
   * Pool-price boundary in unsigned Q64.64 square-root units, not a token amount or
   * basis-point tolerance.
   *
   * The underlying ratio is token 1 atomic units per token 0 atomic unit. For an
   * atomic-unit ratio of 1, the boundary is `1n` << `64n`. A displayed token price must
   * first be adjusted for both mints’ decimals. Use a protocol quote to select a valid
   * directional boundary.
   *
   * Zero requires the native program to fill the entire specified amount. An explicit
   * nonzero boundary can stop execution before the full amount is exchanged. Encodable
   * values span 0 through 2^128 - 1; the native program enforces its narrower valid price
   * range.
   */
  readonly sqrtPriceLimitX64: bigint;
  /**
   * Whether amount specifies the input (true) or requested output (false).
   *
   * With true, otherAmountThreshold is a minimum output. With false, it is a maximum
   * input. This flag selects amount interpretation; it does not select the token
   * direction.
   */
  readonly isBaseInput: boolean;
}

/** Encodes the native `swap` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["sqrtPriceLimitX64", getU128Encoder()],
  ["isBaseInput", getU8Encoder()],
]);

/**
 * Creates a Raydium CLMM swap instruction with caller-selected amount interpretation.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts, mode selection and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range. An
 * out-of-range unsigned 128-bit price limit also throws.
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
 *   swap,
 *   type RaydiumClmmSwapAccounts,
 *   type RaydiumClmmSwapArgs,
 * } from "celere-protocol-sdk/instructions/raydium-clmm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumClmmSwapAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RaydiumClmmSwapArgs = {
 *   amount: amountIn,
 *   otherAmountThreshold: minimumAmountOut,
 *   sqrtPriceLimitX64: 0n,
 *   isBaseInput: true,
 * };
 *
 * const instruction = swap(accounts, args);
 * ```
 *
 * @remarks
 * Supply the bitmap extension and tick arrays for the requested traversal. Direction
 * follows the supplied input/output vaults. The caller validates price limits and
 * account state; this builder does not discover tick arrays. SOL uses an existing
 * wrapped SOL account.
 *
 * @see {@link RaydiumClmmSwapAccounts}
 * @see {@link RaydiumClmmSwapArgs}
 */
export function swap(
  accounts: RaydiumClmmSwapAccounts,
  args: RaydiumClmmSwapArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([248, 198, 158, 145, 225, 117, 135, 200]),
    amount: args.amount,
    otherAmountThreshold: args.otherAmountThreshold,
    sqrtPriceLimitX64: args.sqrtPriceLimitX64,
    isBaseInput: args.isBaseInput ? 1 : 0,
  });
  return {
    programAddress: RAYDIUM_CLMM_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userInput, role: AccountRole.WRITABLE },
      { address: accounts.userOutput, role: AccountRole.WRITABLE },
      { address: accounts.inputVault, role: AccountRole.WRITABLE },
      { address: accounts.outputVault, role: AccountRole.WRITABLE },
      { address: accounts.observation, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ...accounts.tickArrays.map((address) => ({
        address,
        role: AccountRole.WRITABLE,
      })),
      { address: accounts.tickArrayBitmap, role: AccountRole.READONLY },
    ],
    data,
  };
}
