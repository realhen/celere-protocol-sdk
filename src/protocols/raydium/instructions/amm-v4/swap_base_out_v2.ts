import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_AMM_V4_PROGRAM } from "../../constants.js";

/** Accounts required by Raydium AMM v4’s native `swap_base_out_v2` instruction. */
export interface RaydiumAmmV4SwapBaseOutV2Accounts {
  readonly pool: Address;
  readonly authority: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly owner: Address;
}

/**
 * Native arguments for {@link swap_base_out_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumAmmV4SwapBaseOutV2Args {
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

/** Encodes the native `swap_base_out_v2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["tag", getU8Encoder()],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
]);

/**
 * Creates a Raydium AMM v4 swap instruction for a requested output amount.
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
 *   swap_base_out_v2,
 *   type RaydiumAmmV4SwapBaseOutV2Accounts,
 *   type RaydiumAmmV4SwapBaseOutV2Args,
 * } from "celere-protocol-sdk/instructions/raydium-amm-v4";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumAmmV4SwapBaseOutV2Accounts;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: RaydiumAmmV4SwapBaseOutV2Args = {
 *   maximumAmountIn,
 *   amountOut,
 * };
 *
 * const instruction = swap_base_out_v2(accounts, args);
 * ```
 *
 * @remarks
 * This is the vault-based v2 swap instruction, not an orderbook settlement workflow. The
 * caller supplies the matching pool vaults and source/destination token accounts. SOL
 * uses an existing wrapped SOL account.
 *
 * @see {@link RaydiumAmmV4SwapBaseOutV2Accounts}
 * @see {@link RaydiumAmmV4SwapBaseOutV2Args}
 */
export function swap_base_out_v2(
  accounts: RaydiumAmmV4SwapBaseOutV2Accounts,
  args: RaydiumAmmV4SwapBaseOutV2Args,
): Instruction {
  const data = dataEncoder.encode({
    tag: 17,
    maximumAmountIn: args.maximumAmountIn,
    amountOut: args.amountOut,
  });
  return {
    programAddress: RAYDIUM_AMM_V4_PROGRAM,
    accounts: [
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.vault0, role: AccountRole.WRITABLE },
      { address: accounts.vault1, role: AccountRole.WRITABLE },
      { address: accounts.userInput, role: AccountRole.WRITABLE },
      { address: accounts.userOutput, role: AccountRole.WRITABLE },
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
