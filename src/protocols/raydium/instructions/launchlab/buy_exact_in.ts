import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_LAUNCHLAB_PROGRAM } from "../../constants.js";

/** Accounts required by Raydium LaunchLab’s native `buy_exact_in` instruction. */
export interface RaydiumLaunchlabBuyExactInAccounts {
  readonly owner: Address;
  readonly authority: Address;
  readonly config: Address;
  readonly platform: Address;
  readonly pool: Address;
  readonly userBase: Address;
  readonly userQuote: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly eventAuthority: Address;
  readonly platformFeeVault: Address;
  readonly creatorFeeVault: Address;
}

/**
 * Native arguments for {@link buy_exact_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumLaunchlabBuyExactInArgs {
  /**
   * Amount of quote asset supplied to the trade, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * See the instruction’s execution caveat below; the native buy is not a full-fill
   * guarantee.
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
   *
   * See the instruction’s execution caveat below; the native buy is not a full-fill
   * guarantee.
   */
  readonly minimumAmountOut: bigint;
}

/** Encodes the native `buy_exact_in` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
  ["shareFeeRate", getU64Encoder()],
]);

/**
 * Creates a Raydium LaunchLab buy instruction for a specified input budget.
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
 *   buy_exact_in,
 *   type RaydiumLaunchlabBuyExactInAccounts,
 *   type RaydiumLaunchlabBuyExactInArgs,
 * } from "celere-protocol-sdk/instructions/raydium-launchlab";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumLaunchlabBuyExactInAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RaydiumLaunchlabBuyExactInArgs = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = buy_exact_in(accounts, args);
 * ```
 *
 * @remarks
 * Native shareFeeRate is fixed to zero. Referral/share-fee recipients are not supported
 * by this builder. SOL uses an existing wrapped SOL account. A buy reaching graduation
 * may consume less input and return less output than the unclipped quote; construction
 * provides no full-fill guarantee.
 *
 * @see {@link RaydiumLaunchlabBuyExactInAccounts}
 * @see {@link RaydiumLaunchlabBuyExactInArgs}
 */
export function buy_exact_in(
  accounts: RaydiumLaunchlabBuyExactInAccounts,
  args: RaydiumLaunchlabBuyExactInArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([250, 234, 13, 123, 213, 156, 19, 236]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
    shareFeeRate: 0n,
  });
  return {
    programAddress: RAYDIUM_LAUNCHLAB_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.platform, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userBase, role: AccountRole.WRITABLE },
      { address: accounts.userQuote, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: RAYDIUM_LAUNCHLAB_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.platformFeeVault, role: AccountRole.WRITABLE },
      { address: accounts.creatorFeeVault, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
