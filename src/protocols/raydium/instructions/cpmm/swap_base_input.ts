import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_CPMM_PROGRAM } from "../../constants.js";

/** Accounts required by Raydium CPMM’s native `swap_base_input` instruction. */
export interface RaydiumCpmmSwapBaseInputAccounts {
  readonly owner: Address;
  readonly authority: Address;
  readonly ammConfig: Address;
  readonly pool: Address;
  readonly inputTokenAccount: Address;
  readonly outputTokenAccount: Address;
  readonly inputVault: Address;
  readonly outputVault: Address;
  readonly inputTokenProgram: Address;
  readonly outputTokenProgram: Address;
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly observationState: Address;
}

/**
 * Native arguments for {@link swap_base_input}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumCpmmSwapBaseInputArgs {
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

/** Encodes the native `swap_base_input` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Creates a Raydium CPMM swap instruction for a specified input budget.
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
 *   swap_base_input,
 *   type RaydiumCpmmSwapBaseInputAccounts,
 *   type RaydiumCpmmSwapBaseInputArgs,
 * } from "celere-protocol-sdk/instructions/raydium-cpmm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumCpmmSwapBaseInputAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RaydiumCpmmSwapBaseInputArgs = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = swap_base_input(accounts, args);
 * ```
 *
 * @remarks
 * Select direction with the input/output mints, vaults and token programs. Token
 * accounts must be prepared before execution; SOL uses an existing wrapped SOL account.
 *
 * @see {@link RaydiumCpmmSwapBaseInputAccounts}
 * @see {@link RaydiumCpmmSwapBaseInputArgs}
 */
export function swap_base_input(
  accounts: RaydiumCpmmSwapBaseInputAccounts,
  args: RaydiumCpmmSwapBaseInputArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([143, 190, 90, 218, 196, 30, 51, 222]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
  });
  return {
    programAddress: RAYDIUM_CPMM_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.ammConfig, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.outputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.inputVault, role: AccountRole.WRITABLE },
      { address: accounts.outputVault, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenProgram, role: AccountRole.READONLY },
      { address: accounts.outputTokenProgram, role: AccountRole.READONLY },
      { address: accounts.inputMint, role: AccountRole.READONLY },
      { address: accounts.outputMint, role: AccountRole.READONLY },
      { address: accounts.observationState, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
