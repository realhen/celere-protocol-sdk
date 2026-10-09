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
/** Identifies Rise Rich’s native `buy_with_exact_cash_in` instruction. */
const DISCRIMINATOR = new Uint8Array([53, 248, 95, 20, 54, 162, 146, 247]);
/** Encodes the native `buy_with_exact_cash_in` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["cashIn", getU64Encoder()],
  ["minTokenOut", getU64Encoder()],
  ["newShoulderEnd", getU64Encoder()],
  ["floorIncreaseRatio", fixEncoderSize(getBytesEncoder(), 16)],
  ["maxNewFloor", fixEncoderSize(getBytesEncoder(), 16)],
  ["maxAreaShrinkageToleranceUnits", getU64Encoder()],
  ["minLiqRatio", fixEncoderSize(getBytesEncoder(), 16)],
]);

/** Accounts required by Rise Rich’s native `buy_with_exact_cash_in` instruction. */
export interface RiseRichBuyExactCashInAccounts {
  readonly buyer: Address;
  readonly tenant: Address;
  readonly market: Address;
  readonly cashEscrow: Address;
  readonly mayTenant: Address;
  readonly mayMarketGroup: Address;
  readonly marketMeta: Address;
  readonly mayMarket: Address;
  readonly tenantSeed: Address;
  readonly mintToken: Address;
  readonly mintMain: Address;
  readonly tokenDst: Address;
  readonly mainSrc: Address;
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
 * Native arguments for {@link buy_with_exact_cash_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface RiseRichBuyExactCashInArgs {
  /**
   * Amount of quote asset supplied to the trade, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly cashIn: bigint;
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
  readonly minTokenOut: bigint;
  /**
   * New shoulder-end position in the Mayflower curve’s native token coordinate units.
   *
   * Use `0n` to skip the optional floor raise and perform only the purchase. A nonzero
   * value requests a floor raise in the same instruction and must be computed from current
   * curve state; it is not the buy amount or a slippage percentage.
   */
  readonly newShoulderEnd: bigint;
  /**
   * Fractional increase requested for the optional floor raise, serialized as a native
   * Rust Decimal.
   *
   * For example, a decimal value of 0.002 represents a 0.2% increase, not 20 basis points
   * encoded as an integer. Supply the exact 16-byte serialized Decimal from a compatible
   * protocol calculation. With newShoulderEnd = `0n`, use a serialized zero (new
   * Uint8Array(16)).
   */
  readonly floorIncreaseRatio: Uint8Array;
  /**
   * Maximum resulting floor price allowed by the optional floor raise, in the Mayflower
   * market’s native price units.
   *
   * Compute this cap from the same market state as newShoulderEnd and serialize it as a
   * 16-byte Rust Decimal. It is a price cap, not the maximum cash input. With
   * newShoulderEnd = `0n`, a serialized zero (new Uint8Array(16)) is sufficient.
   */
  readonly maxNewFloor: Uint8Array;
  /**
   * Largest permitted reduction in area under the curve during the optional floor raise,
   * in the native curve-area token units.
   *
   * This is a floor-raise constraint, separate from swap slippage. Obtain it from the
   * protocol’s floor-raise calculation; do not substitute basis points or the swap amount.
   * Use `0n` when newShoulderEnd = `0n` skips the raise.
   */
  readonly maxAreaShrinkageToleranceUnits: bigint;
  /**
   * Minimum ratio of liquidity beyond the new shoulder end to liquidity in the shoulder,
   * serialized as a 16-byte Rust Decimal.
   *
   * This constrains the optional floor raise. A decimal zero permits the shoulder to reach
   * supply; positive values require liquidity beyond it. Use the protocol’s floor-raise
   * calculation for an active raise. With newShoulderEnd = `0n`, use a serialized zero
   * (new Uint8Array(16)).
   */
  readonly minLiqRatio: Uint8Array;
}

/**
 * Creates a Rise Rich buy instruction for a specified input budget.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range. Decimal
 * fields with a length other than 16 throw RangeError.
 * On-chain account, balance, price, and slippage failures occur during execution, not
 * during construction.
 *
 * @example
 * Build an input-budget trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data. The optional floor raise is
 * disabled.
 *
 * ```ts
 * import {
 *   buy_with_exact_cash_in,
 *   type RiseRichBuyExactCashInAccounts,
 *   type RiseRichBuyExactCashInArgs,
 * } from "celere-protocol-sdk/instructions/rise-rich";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: RiseRichBuyExactCashInAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: RiseRichBuyExactCashInArgs = {
 *   cashIn: amountIn,
 *   minTokenOut: minimumAmountOut,
 *   newShoulderEnd: 0n,
 *   floorIncreaseRatio: new Uint8Array(16),
 *   maxNewFloor: new Uint8Array(16),
 *   maxAreaShrinkageToleranceUnits: 0n,
 *   minLiqRatio: new Uint8Array(16),
 * };
 *
 * const instruction = buy_with_exact_cash_in(accounts, args);
 * ```
 *
 * @remarks
 * Cash is the market’s collateral token, supplied through a token account. For WSOL
 * collateral, fund wrapped SOL before execution. The caller must validate market
 * permissions, curve state and any floor-raise controls.
 *
 * @see {@link RiseRichBuyExactCashInAccounts}
 * @see {@link RiseRichBuyExactCashInArgs}
 */
export function buy_with_exact_cash_in(
  accounts: RiseRichBuyExactCashInAccounts,
  args: RiseRichBuyExactCashInArgs,
): Instruction {
  if (args.floorIncreaseRatio.length !== 16)
    throw new RangeError("floorIncreaseRatio must contain exactly 16 bytes");
  if (args.maxNewFloor.length !== 16)
    throw new RangeError("maxNewFloor must contain exactly 16 bytes");
  if (args.minLiqRatio.length !== 16)
    throw new RangeError("minLiqRatio must contain exactly 16 bytes");
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    cashIn: args.cashIn,
    minTokenOut: args.minTokenOut,
    newShoulderEnd: args.newShoulderEnd,
    floorIncreaseRatio: args.floorIncreaseRatio,
    maxNewFloor: args.maxNewFloor,
    maxAreaShrinkageToleranceUnits: args.maxAreaShrinkageToleranceUnits,
    minLiqRatio: args.minLiqRatio,
  });
  return {
    programAddress: RISE_RICH_PROGRAM,
    accounts: [
      { address: accounts.buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tenant, role: AccountRole.WRITABLE },
      { address: accounts.market, role: AccountRole.WRITABLE },
      { address: accounts.cashEscrow, role: AccountRole.WRITABLE },
      { address: accounts.mayTenant, role: AccountRole.READONLY },
      { address: accounts.mayMarketGroup, role: AccountRole.READONLY },
      { address: accounts.marketMeta, role: AccountRole.READONLY },
      { address: accounts.mayMarket, role: AccountRole.WRITABLE },
      { address: accounts.tenantSeed, role: AccountRole.READONLY },
      { address: accounts.mintToken, role: AccountRole.WRITABLE },
      { address: accounts.mintMain, role: AccountRole.READONLY },
      { address: accounts.tokenDst, role: AccountRole.WRITABLE },
      { address: accounts.mainSrc, role: AccountRole.WRITABLE },
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
