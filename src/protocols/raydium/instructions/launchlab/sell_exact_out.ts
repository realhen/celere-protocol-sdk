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

/** Accounts required by Raydium LaunchLab’s native `sell_exact_out` instruction. */
export interface RaydiumLaunchlabSellExactOutAccounts {
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
 * Native arguments for {@link sell_exact_out}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RaydiumLaunchlabSellExactOutArgs {
  /**
   * Requested quote asset output, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Quote the input required for this output, then set the maximum-input argument from
   * that quote and your chosen tolerance. This value is not a price or a slippage
   * percentage.
   */
  readonly amountOut: bigint;
  /**
   * Maximum acceptable base token input, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Increase the required input from a quote for the requested output by your chosen
   * slippage tolerance, rounding up in atomic units. A quote of `500_000_000n` with a 1%
   * tolerance gives `505_000_000n`. Include applicable trading fees in that input quote;
   * transaction fees and rent remain separate SOL costs.
   *
   * Zero is a zero spending limit, not an unlimited-input sentinel.
   */
  readonly maximumAmountIn: bigint;
}

/** Encodes the native `sell_exact_out` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountOut", getU64Encoder()],
  ["maximumAmountIn", getU64Encoder()],
  ["shareFeeRate", getU64Encoder()],
]);

/**
 * Creates a Raydium LaunchLab sell instruction for a requested output amount.
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
 *   sell_exact_out,
 *   type RaydiumLaunchlabSellExactOutAccounts,
 *   type RaydiumLaunchlabSellExactOutArgs,
 * } from "celere-protocol-sdk/instructions/raydium-launchlab";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RaydiumLaunchlabSellExactOutAccounts;
 *
 * const amountOut = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountIn = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: RaydiumLaunchlabSellExactOutArgs = {
 *   amountOut,
 *   maximumAmountIn,
 * };
 *
 * const instruction = sell_exact_out(accounts, args);
 * ```
 *
 * @remarks
 * Native shareFeeRate is fixed to zero. Referral/share-fee recipients are not supported
 * by this builder. SOL uses an existing wrapped SOL account.
 *
 * @see {@link RaydiumLaunchlabSellExactOutAccounts}
 * @see {@link RaydiumLaunchlabSellExactOutArgs}
 */
export function sell_exact_out(
  accounts: RaydiumLaunchlabSellExactOutAccounts,
  args: RaydiumLaunchlabSellExactOutArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([95, 200, 71, 34, 8, 9, 11, 166]),
    amountOut: args.amountOut,
    maximumAmountIn: args.maximumAmountIn,
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
