import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSVAR_INSTRUCTIONS_ADDRESS } from "@solana/sysvars";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  getU32Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { HEAVEN_PROGRAM, HEAVEN_ORACLE_PROGRAM, HEAVEN_SOL_PRICE } from "../constants.js";

/** Accounts required by Heaven’s native `buy` instruction. */
export interface HeavenBuyAccounts {
  readonly tokenAProgram: Address;
  readonly tokenBProgram: Address;
  readonly pool: Address;
  readonly user: Address;
  readonly tokenAMint: Address;
  readonly tokenBMint: Address;
  readonly userTokenA: Address;
  readonly userTokenB: Address;
  readonly tokenAVault: Address;
  readonly tokenBVault: Address;
  readonly protocolConfig: Address;
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
export interface HeavenBuyArgs {
  /**
   * Amount of quote asset supplied to the trade, in quote-asset atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL on a SOL-paired market; `10_000_000n` means 10
   * USDC with six decimals.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * Despite its name, this is the exact-input buy budget, not an exact-output maximum. The
   * debit is from the wrapped SOL token account.
   */
  readonly maximumSolSpend: bigint;
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
  ["maximumSolSpend", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
  ["eventDataLength", getU32Encoder()],
]);
/**
 * Creates a Heaven buy instruction for a specified input budget.
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
 *   type HeavenBuyAccounts,
 *   type HeavenBuyArgs,
 * } from "celere-protocol-sdk/instructions/heaven";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: HeavenBuyAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: HeavenBuyArgs = {
 *   maximumSolSpend: amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = buy(accounts, args);
 * ```
 *
 * @remarks
 * SOL is represented by wrapped SOL in SPL token accounts. Fund those accounts before
 * execution; this builder does not wrap or unwrap SOL. The native event-data string is
 * fixed to empty.
 *
 * @see {@link HeavenBuyAccounts}
 * @see {@link HeavenBuyArgs}
 */
export function buy(accounts: HeavenBuyAccounts, args: HeavenBuyArgs): Instruction {
  return {
    programAddress: HEAVEN_PROGRAM,
    accounts: [
      { address: accounts.tokenAProgram, role: AccountRole.READONLY },
      { address: accounts.tokenBProgram, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tokenAMint, role: AccountRole.READONLY },
      { address: accounts.tokenBMint, role: AccountRole.READONLY },
      { address: accounts.userTokenA, role: AccountRole.WRITABLE },
      { address: accounts.userTokenB, role: AccountRole.WRITABLE },
      { address: accounts.tokenAVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenBVault, role: AccountRole.WRITABLE },
      { address: accounts.protocolConfig, role: AccountRole.WRITABLE },
      { address: SYSVAR_INSTRUCTIONS_ADDRESS, role: AccountRole.READONLY },
      { address: HEAVEN_ORACLE_PROGRAM, role: AccountRole.READONLY },
      { address: HEAVEN_SOL_PRICE, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator: new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]),
      maximumSolSpend: args.maximumSolSpend,
      minimumAmountOut: args.minimumAmountOut,
      eventDataLength: 0,
    }),
  };
}
