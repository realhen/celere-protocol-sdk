import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { VERTIGO_PROGRAM } from "../constants.js";

/** Accounts required by Vertigo’s native `buy` instruction. */
export interface VertigoBuyAccounts {
  readonly pool: Address;
  readonly user: Address;
  readonly poolOwner: Address;
  readonly mintA: Address;
  readonly mintB: Address;
  readonly userA: Address;
  readonly userB: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
}

/**
 * Native arguments for {@link buy}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface VertigoBuyArgs {
  /**
   * Amount of quote asset supplied to the trade, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly amountIn: bigint;
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
  readonly minimumAmountOut: bigint;
}

/** Encodes the native `buy` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Creates a Vertigo buy instruction for a specified input budget.
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
 *   buy,
 *   type VertigoBuyAccounts,
 *   type VertigoBuyArgs,
 * } from "celere-protocol-sdk/instructions/vertigo";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: VertigoBuyAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: VertigoBuyArgs = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = buy(accounts, args);
 * ```
 *
 * @remarks
 * Both assets use classic SPL token accounts. Select the pool’s quote and base accounts
 * consistently with the instruction direction. SOL uses an existing wrapped SOL account.
 *
 * @see {@link VertigoBuyAccounts}
 * @see {@link VertigoBuyArgs}
 */
export function buy(accounts: VertigoBuyAccounts, args: VertigoBuyArgs): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
  });
  return {
    programAddress: VERTIGO_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: accounts.poolOwner, role: AccountRole.READONLY },
      { address: accounts.mintA, role: AccountRole.READONLY },
      { address: accounts.mintB, role: AccountRole.READONLY },
      { address: accounts.userA, role: AccountRole.WRITABLE },
      { address: accounts.userB, role: AccountRole.WRITABLE },
      { address: accounts.vaultA, role: AccountRole.WRITABLE },
      { address: accounts.vaultB, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: VERTIGO_PROGRAM, role: AccountRole.READONLY },
    ],
    data,
  };
}
