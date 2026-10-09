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

/** Accounts required by Raydium CPMM’s native `swap_base_output` instruction. */
export interface RaydiumCpmmSwapBaseOutputAccounts {
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
 * Native arguments for {@link swap_base_output}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumCpmmSwapBaseOutputArgs {
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

/** Encodes the native `swap_base_output` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
]);

/**
 * Creates a Raydium CPMM swap instruction for a requested output amount.
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
 *   swap_base_output,
 *   type RaydiumCpmmSwapBaseOutputAccounts,
 *   type RaydiumCpmmSwapBaseOutputArgs,
 * } from "celere-protocol-sdk/instructions/raydium-cpmm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumCpmmSwapBaseOutputAccounts;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: RaydiumCpmmSwapBaseOutputArgs = {
 *   maximumAmountIn,
 *   amountOut,
 * };
 *
 * const instruction = swap_base_output(accounts, args);
 * ```
 *
 * @remarks
 * Select direction with the input/output mints, vaults and token programs. Token
 * accounts must be prepared before execution; SOL uses an existing wrapped SOL account.
 *
 * @see {@link RaydiumCpmmSwapBaseOutputAccounts}
 * @see {@link RaydiumCpmmSwapBaseOutputArgs}
 */
export function swap_base_output(
  accounts: RaydiumCpmmSwapBaseOutputAccounts,
  args: RaydiumCpmmSwapBaseOutputArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([55, 217, 98, 86, 163, 74, 180, 173]),
    maximumAmountIn: args.maximumAmountIn,
    amountOut: args.amountOut,
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
