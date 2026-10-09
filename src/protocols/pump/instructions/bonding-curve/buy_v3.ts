import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_PROGRAM } from "../../constants.js";

/** Identifies Pump bonding curve’s native `buy_v3` instruction. */
const DISCRIMINATOR = new Uint8Array([7, 5, 29, 196, 245, 23, 101, 80]);
/** Encodes the native `buy_v3` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["maxSolCost", getU64Encoder()],
  ["partialFill", getU8Encoder()],
]);

/** Accounts required by Pump bonding curve’s native `buy_v3` instruction. */
export interface PumpBuyV3Accounts {
  readonly global: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly bondingCurve: Address;
  readonly associatedBaseBondingCurve: Address;
  readonly associatedQuoteBondingCurve: Address;
  readonly user: Address;
  readonly associatedBaseUser: Address;
  readonly associatedQuoteUser: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly buybackFeeRecipient: Address;
  readonly systemProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link buy_v3}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpBuyV3Args {
  /**
   * Requested base token output, in base-token atomic units. For example, `500_000_000n`
   * means 500 tokens when the base mint has six decimals.
   *
   * Quote the input required for this output, then set the maximum-input argument from
   * that quote and your chosen tolerance. This value is not a price or a slippage
   * percentage.
   */
  readonly amount: bigint;
  /**
   * Maximum acceptable quote asset input, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 SOL on a SOL-paired curve; `10_000_000n` means 10 USDC with
   * six decimals.
   *
   * Increase the required input from a quote for the requested output by your chosen
   * slippage tolerance, rounding up in atomic units. A quote of `1_000_000_000n` with a 1%
   * tolerance gives `1_010_000_000n`. Include applicable trading fees in that input quote;
   * transaction fees and rent remain separate SOL costs.
   *
   * Zero is a zero spending limit, not an unlimited-input sentinel.
   *
   * Despite the native SOL-oriented name, this field uses the market’s quote asset:
   * lamports for native SOL or atomic token units for a token-quoted market.
   */
  readonly maxSolCost: bigint;
}

/**
 * Creates a Pump bonding curve buy instruction for a requested output amount.
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
 *   buy_v3,
 *   type PumpBuyV3Accounts,
 *   type PumpBuyV3Args,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpBuyV3Accounts;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: PumpBuyV3Args = {
 *   amount: amountOut,
 *   maxSolCost: maximumAmountIn,
 * };
 *
 * const instruction = buy_v3(accounts, args);
 * ```
 *
 * @remarks
 * For native SOL markets, quote ATAs are unused placeholders; the program spends or
 * credits lamports. For token-quoted markets, prepare the quote token accounts,
 * including the buyback recipient’s quote ATA. Protocol and creator fees remain accrued
 * on the curve until swept. The native partialFill flag is fixed to false. A completing
 * buy on a standard curve may continue against the prospective migrated pool; the amount
 * and limit cover both portions.
 *
 * @see {@link PumpBuyV3Accounts}
 * @see {@link PumpBuyV3Args}
 */
export function buy_v3(accounts: PumpBuyV3Accounts, args: PumpBuyV3Args): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    maxSolCost: args.maxSolCost,
    partialFill: 0,
  });
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedBaseBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.associatedBaseUser, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteUser, role: AccountRole.WRITABLE },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
