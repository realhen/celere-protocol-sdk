import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Instruction,
} from "@solana/kit";
import { WRAPPED_SOL_MINT } from "../../../accounts/tokens.js";
import {
  LIQUID_AF_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_EVENTS_PROGRAM,
} from "../constants.js";
import type { LiquidAfNativeSwapAccounts } from "./accounts.js";

/**
 * Native arguments for {@link sell_exact_out_native}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface LiquidAfSellExactOutNativeArgs {
  /**
   * Requested native SOL output, in lamports. For example, `1_000_000_000n` means 1 SOL.
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

/** Encodes the native `sell_exact_out_native` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountOut", getU64Encoder()],
  ["maximumAmountIn", getU64Encoder()],
]);

/**
 * Creates a LiquidAF curve sell instruction for a requested output amount.
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
 *   sell_exact_out_native,
 *   type LiquidAfNativeSwapAccounts,
 *   type LiquidAfSellExactOutNativeArgs,
 * } from "celere-protocol-sdk/instructions/liquid-af";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: LiquidAfNativeSwapAccounts;
 *
 * const amountOut = 1_000_000_000n; // 1 SOL.
 * const quotedAmountIn = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: LiquidAfSellExactOutNativeArgs = {
 *   amountOut,
 *   maximumAmountIn,
 * };
 *
 * const instruction = sell_exact_out_native(accounts, args);
 * ```
 *
 * @remarks
 * These instructions transfer native SOL. Omitted referral accounts use the Anchor
 * program-ID sentinel. Validate referral relationships and the curve state before
 * execution.
 *
 * @see {@link LiquidAfNativeSwapAccounts}
 * @see {@link LiquidAfSellExactOutNativeArgs}
 */
export function sell_exact_out_native(
  accounts: LiquidAfNativeSwapAccounts,
  args: LiquidAfSellExactOutNativeArgs,
): Instruction {
  return {
    programAddress: LIQUID_AF_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.feeVault, role: AccountRole.WRITABLE },
      { address: accounts.buybackVault, role: AccountRole.WRITABLE },
      {
        address: accounts.creatorReferralVault ?? LIQUID_AF_PROGRAM,
        role: accounts.creatorReferralVault ? AccountRole.WRITABLE : AccountRole.READONLY,
      },
      {
        address: accounts.traderReferralVault ?? LIQUID_AF_PROGRAM,
        role: accounts.traderReferralVault ? AccountRole.WRITABLE : AccountRole.READONLY,
      },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: WRAPPED_SOL_MINT, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.creatorUserProperties, role: AccountRole.READONLY },
      { address: accounts.userProperties, role: AccountRole.WRITABLE },
      { address: accounts.globalCurveVolume, role: AccountRole.WRITABLE },
      { address: accounts.tokenVolume, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.cashbackConfig, role: AccountRole.READONLY },
      { address: LIQUID_AF_STATE_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.stateEventsCpiAuthority, role: AccountRole.READONLY },
      { address: accounts.pythPriceFeed, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.cpiAuthority, role: AccountRole.READONLY },
      { address: LIQUID_AF_EVENTS_PROGRAM, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([12, 37, 246, 175, 240, 13, 94, 159]),
      amountOut: args.amountOut,
      maximumAmountIn: args.maximumAmountIn,
    }),
  };
}
