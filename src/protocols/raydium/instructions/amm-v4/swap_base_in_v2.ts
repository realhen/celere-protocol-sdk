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

/** Accounts required by Raydium AMM v4’s native `swap_base_in_v2` instruction. */
export interface RaydiumAmmV4SwapBaseInV2Accounts {
  readonly pool: Address;
  readonly authority: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly owner: Address;
}

/**
 * Native arguments for {@link swap_base_in_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumAmmV4SwapBaseInV2Args {
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

/** Encodes the native `swap_base_in_v2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["tag", getU8Encoder()],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Creates a Raydium AMM v4 swap instruction for a specified input budget.
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
 *   swap_base_in_v2,
 *   type RaydiumAmmV4SwapBaseInV2Accounts,
 *   type RaydiumAmmV4SwapBaseInV2Args,
 * } from "celere-protocol-sdk/instructions/raydium-amm-v4";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumAmmV4SwapBaseInV2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RaydiumAmmV4SwapBaseInV2Args = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = swap_base_in_v2(accounts, args);
 * ```
 *
 * @remarks
 * This is the vault-based v2 swap instruction, not an orderbook settlement workflow. The
 * caller supplies the matching pool vaults and source/destination token accounts. SOL
 * uses an existing wrapped SOL account.
 *
 * @see {@link RaydiumAmmV4SwapBaseInV2Accounts}
 * @see {@link RaydiumAmmV4SwapBaseInV2Args}
 */
export function swap_base_in_v2(
  accounts: RaydiumAmmV4SwapBaseInV2Accounts,
  args: RaydiumAmmV4SwapBaseInV2Args,
): Instruction {
  const data = dataEncoder.encode({
    tag: 16,
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
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
