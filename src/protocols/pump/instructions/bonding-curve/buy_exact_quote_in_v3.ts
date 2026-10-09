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

/** Identifies Pump’s native `buy_exact_quote_in_v3` instruction. */
const DISCRIMINATOR = new Uint8Array([225, 247, 80, 30, 213, 179, 132, 136]);
/** Encodes the native buy arguments and the instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["spendableQuoteIn", getU64Encoder()],
  ["minTokensOut", getU64Encoder()],
  ["partialFill", getU8Encoder()],
]);

/** Accounts required by Pump’s native `buy_exact_quote_in_v3` instruction. */
export interface PumpBuyExactQuoteInV3Accounts {
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
 * Spending budget and minimum acceptable output for {@link buy_exact_quote_in_v3}.
 *
 * Amounts use each asset’s smallest unit, represented as `bigint`. Read the mint’s
 * decimals when converting token quantities; SOL uses lamports. The builder does
 * not convert display amounts, calculate a quote, or choose a slippage tolerance.
 *
 * @remarks
 * Both values must fit an unsigned 64-bit integer (`0` through `2^64 - 1`).
 * Encoding a value successfully does not guarantee that the on-chain trade succeeds.
 */
export interface PumpBuyExactQuoteInV3Args {
  /**
   * Quote-asset budget for the purchase, including Pump trading fees.
   *
   * For a SOL-paired market, `1_000_000_000n` means 1 SOL. For a USDC-paired
   * market with six decimals, `10_000_000n` means 10 USDC. This is the amount
   * being spent, not the number of base tokens being purchased.
   *
   * Transaction fees and any account-creation rent are additional SOL costs.
   * At curve completion, a remainder too small to purchase one more atomic
   * token unit can remain unspent.
   */
  readonly spendableQuoteIn: bigint;
  /**
   * Fewest base-token atomic units the purchase may return.
   *
   * Set this from a quote for the same {@link PumpBuyExactQuoteInV3Args.spendableQuoteIn} budget, reduced
   * by your chosen slippage tolerance. If that quote is 500 tokens with six
   * decimals, a 1% tolerance gives `495_000_000n` (495 tokens).
   *
   * The program rejects the trade if total output is below this threshold.
   * For a buy crossing curve completion, it applies to the combined curve and
   * synthetic-migration output. A zero threshold provides no minimum-output
   * protection; it does not ask the builder to calculate a minimum for you.
   */
  readonly minTokensOut: bigint;
}

/**
 * Creates a Pump bonding-curve buy instruction for a specified quote-asset budget.
 *
 * Spend SOL or the market’s quote token to receive base tokens, subject to the
 * minimum output supplied in {@link PumpBuyExactQuoteInV3Args.minTokensOut}.
 * Accounts and amounts are supplied by the caller; this function performs no
 * fetching, address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Quote budget and minimum base-token output, in atomic units.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range.
 * On-chain account, balance, and slippage failures occur during execution,
 * not during construction.
 *
 * @example
 * Build a 1 SOL buy with a 1% output tolerance. Assume the caller’s quote for
 * this budget is 500 base tokens and the base mint has six decimals; these
 * numbers illustrate the calculation and are not a live market quote.
 *
 * ```ts
 * import {
 *   buy_exact_quote_in_v3,
 *   type PumpBuyExactQuoteInV3Accounts,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve the accounts using your application's account data.
 * declare const accounts: PumpBuyExactQuoteInV3Accounts;
 *
 * const spendableQuoteIn = 1_000_000_000n; // 1 SOL, including trading fees.
 * const quotedTokensOut = 500n * 10n ** 6n; // 500 tokens with six decimals.
 * const slippageBps = 100n; // 1%; 10,000 basis points = 100%.
 * const minTokensOut = (quotedTokensOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const instruction = buy_exact_quote_in_v3(accounts, {
 *   spendableQuoteIn,
 *   minTokensOut, // 495_000_000n: at least 495 tokens.
 * });
 * ```
 *
 * @remarks
 * This builder encodes the native `partialFill` flag as `false`. On standard
 * curves, a buy that finishes the curve may continue against the prospective
 * migrated pool’s reserves. The minimum output covers both portions.
 *
 * Prepare the required token accounts before executing the trade. For native
 * SOL markets, quote ATAs are unused placeholders and need not exist; spending
 * uses the user’s lamports. The base-user token account must exist, as must the
 * buyback recipient’s quote ATA for token-paired markets.
 *
 * @see {@link PumpBuyExactQuoteInV3Accounts}
 * @see {@link PumpBuyExactQuoteInV3Args}
 */
export function buy_exact_quote_in_v3(
  accounts: PumpBuyExactQuoteInV3Accounts,
  args: PumpBuyExactQuoteInV3Args,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    spendableQuoteIn: args.spendableQuoteIn,
    minTokensOut: args.minTokensOut,
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
