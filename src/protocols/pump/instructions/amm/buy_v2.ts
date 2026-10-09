import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_AMM_PROGRAM } from "../../constants.js";

/** Identifies PumpSwap’s native `buy_v2` instruction. */
const DISCRIMINATOR = new Uint8Array([184, 23, 238, 97, 103, 197, 211, 61]);
/** Encodes the native `buy_v2` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["baseAmountOut", getU64Encoder()],
  ["maxQuoteAmountIn", getU64Encoder()],
]);

/** Accounts required by PumpSwap’s native `buy_v2` instruction. */
export interface PumpAmmBuyV2Accounts {
  readonly pool: Address;
  readonly user: Address;
  readonly globalConfig: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly userBaseTokenAccount: Address;
  readonly userQuoteTokenAccount: Address;
  readonly poolBaseTokenAccount: Address;
  readonly poolQuoteTokenAccount: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly systemProgram: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly buybackFeeRecipient: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link buy_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpAmmBuyV2Args {
  /**
   * Requested base token output, in base-token atomic units. For example, `500_000_000n`
   * means 500 tokens when the base mint has six decimals.
   *
   * Quote the input required for this output, then set the maximum-input argument from
   * that quote and your chosen tolerance. This value is not a price or a slippage
   * percentage.
   */
  readonly baseAmountOut: bigint;
  /**
   * Maximum acceptable quote asset input, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Increase the required input from a quote for the requested output by your chosen
   * slippage tolerance, rounding up in atomic units. A quote of `1_000_000_000n` with a 1%
   * tolerance gives `1_010_000_000n`. Include applicable trading fees in that input quote;
   * transaction fees and rent remain separate SOL costs.
   *
   * Zero is a zero spending limit, not an unlimited-input sentinel.
   */
  readonly maxQuoteAmountIn: bigint;
}

/**
 * Creates a PumpSwap buy instruction for a requested output amount.
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
 *   buy_v2,
 *   type PumpAmmBuyV2Accounts,
 *   type PumpAmmBuyV2Args,
 * } from "celere-protocol-sdk/instructions/pump-amm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpAmmBuyV2Accounts;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 wrapped SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: PumpAmmBuyV2Args = {
 *   baseAmountOut: amountOut,
 *   maxQuoteAmountIn: maximumAmountIn,
 * };
 *
 * const instruction = buy_v2(accounts, args);
 * ```
 *
 * @remarks
 * Both assets use SPL token accounts. Fund wrapped SOL before executing a SOL-paired
 * swap; this builder does not wrap or unwrap SOL.
 *
 * @see {@link PumpAmmBuyV2Accounts}
 * @see {@link PumpAmmBuyV2Args}
 */
export function buy_v2(
  accounts: PumpAmmBuyV2Accounts,
  args: PumpAmmBuyV2Args,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    baseAmountOut: args.baseAmountOut,
    maxQuoteAmountIn: args.maxQuoteAmountIn,
  });
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.userBaseTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.poolBaseTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.poolQuoteTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
