import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RISE_RICH_PROGRAM } from "../constants.js";
/** Identifies Rise Rich’s native `sell_with_exact_token_in` instruction. */
const DISCRIMINATOR = new Uint8Array([27, 141, 98, 109, 197, 168, 104, 84]);
/** Encodes the native `sell_with_exact_token_in` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["tokenIn", getU64Encoder()],
  ["minCashOut", getU64Encoder()],
]);

/** Accounts required by Rise Rich’s native `sell_with_exact_token_in` instruction. */
export interface RiseRichSellExactTokenInAccounts {
  readonly seller: Address;
  readonly tenant: Address;
  readonly market: Address;
  readonly cashEscrow: Address;
  readonly mayTenant: Address;
  readonly mayMarketGroup: Address;
  readonly marketMeta: Address;
  readonly mayMarket: Address;
  readonly mintToken: Address;
  readonly mintMain: Address;
  readonly tokenSrc: Address;
  readonly mainDst: Address;
  readonly liqVaultMain: Address;
  readonly revEscrowGroup: Address;
  readonly revEscrowTenant: Address;
  readonly tokenProgramMain: Address;
  readonly tokenProgram: Address;
  readonly mayflowerProgram: Address;
  readonly mayLogAccount: Address;
  readonly creatorEscrow: Address;
  readonly teamEscrow: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link sell_with_exact_token_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RiseRichSellExactTokenInArgs {
  /**
   * Amount of base token supplied to the trade, in base-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the base mint has six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly tokenIn: bigint;
  /**
   * Minimum acceptable quote asset output, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Reduce the output from a quote for the same input by your chosen slippage tolerance,
   * rounding down in atomic units. A quote of `1_000_000_000n` with a 1% tolerance gives
   * `990_000_000n`. Use the output the recipient would receive after applicable trading
   * fees.
   *
   * Zero supplies no positive minimum-output protection; it does not request an automatic
   * quote.
   */
  readonly minCashOut: bigint;
}

/**
 * Creates a Rise Rich sell instruction for a specified input budget.
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
 *   sell_with_exact_token_in,
 *   type RiseRichSellExactTokenInAccounts,
 *   type RiseRichSellExactTokenInArgs,
 * } from "celere-protocol-sdk/instructions/rise-rich";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RiseRichSellExactTokenInAccounts;
 *
 * const amountIn = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountOut = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RiseRichSellExactTokenInArgs = {
 *   tokenIn: amountIn,
 *   minCashOut: minimumAmountOut,
 * };
 *
 * const instruction = sell_with_exact_token_in(accounts, args);
 * ```
 *
 * @remarks
 * Cash is the market’s collateral token, supplied through a token account. For WSOL
 * collateral, fund wrapped SOL before execution. The caller must validate market
 * permissions, curve state and any floor-raise controls.
 *
 * @see {@link RiseRichSellExactTokenInAccounts}
 * @see {@link RiseRichSellExactTokenInArgs}
 */
export function sell_with_exact_token_in(
  accounts: RiseRichSellExactTokenInAccounts,
  args: RiseRichSellExactTokenInArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    tokenIn: args.tokenIn,
    minCashOut: args.minCashOut,
  });
  return {
    programAddress: RISE_RICH_PROGRAM,
    accounts: [
      { address: accounts.seller, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tenant, role: AccountRole.WRITABLE },
      { address: accounts.market, role: AccountRole.WRITABLE },
      { address: accounts.cashEscrow, role: AccountRole.WRITABLE },
      { address: accounts.mayTenant, role: AccountRole.READONLY },
      { address: accounts.mayMarketGroup, role: AccountRole.READONLY },
      { address: accounts.marketMeta, role: AccountRole.READONLY },
      { address: accounts.mayMarket, role: AccountRole.WRITABLE },
      { address: accounts.mintToken, role: AccountRole.WRITABLE },
      { address: accounts.mintMain, role: AccountRole.READONLY },
      { address: accounts.tokenSrc, role: AccountRole.WRITABLE },
      { address: accounts.mainDst, role: AccountRole.WRITABLE },
      { address: accounts.liqVaultMain, role: AccountRole.WRITABLE },
      { address: accounts.revEscrowGroup, role: AccountRole.WRITABLE },
      { address: accounts.revEscrowTenant, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgramMain, role: AccountRole.READONLY },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.mayflowerProgram, role: AccountRole.READONLY },
      { address: accounts.mayLogAccount, role: AccountRole.WRITABLE },
      { address: accounts.creatorEscrow, role: AccountRole.WRITABLE },
      { address: accounts.teamEscrow, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
