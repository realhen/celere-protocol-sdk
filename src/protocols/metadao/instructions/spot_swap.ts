import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU8Encoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METADAO_PROGRAM } from "../constants.js";

/** Accounts required by MetaDAO’s native `spot_swap` instruction. */
export interface MetadaoSpotSwapAccounts {
  readonly dao: Address;
  readonly userBaseAccount: Address;
  readonly userQuoteAccount: Address;
  readonly ammBaseVault: Address;
  readonly ammQuoteVault: Address;
  readonly user: Address;
  readonly eventAuthority: Address;
}

/**
 * Native arguments for {@link spot_swap}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface MetadaoSpotSwapArgs {
  /**
   * Input amount in atomic units of the token selected by direction.
   *
   * For a buy, spend quote tokens: `1_000_000_000n` means 1 wrapped SOL on a SOL-paired
   * market. For a sell, spend base tokens: `500_000_000n` means 500 base tokens with six
   * decimals. Obtain a quote for this same input and direction; network fees and rent are
   * separate SOL costs.
   */
  readonly amountIn: bigint;
  /**
   * Trade direction: "buy" spends quote tokens for base tokens; "sell" spends base tokens
   * for quote tokens.
   *
   * This changes the mint used by amountIn and minimumAmountOut. Keep the supplied user
   * accounts and pool vaults consistent with that direction.
   */
  readonly direction: "buy" | "sell";
  /**
   * Minimum output in atomic units of the token received: base tokens for a buy, quote
   * tokens for a sell.
   *
   * Reduce the recipient’s net output quote for the same input and direction by the chosen
   * tolerance, rounding down. A quote of `500_000_000n` base units with 1% tolerance gives
   * `495_000_000n` for a buy. A sell quoted at `1_000_000_000n` quote units gives a
   * `990_000_000n` minimum. Zero supplies no positive output floor and does not request an
   * automatic quote.
   */
  readonly minimumAmountOut: bigint;
}

/** Encodes the native `spot_swap` arguments and instruction discriminator. */
const spotSwapEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["inputAmount", getU64Encoder()],
  ["swapType", getU8Encoder()],
  ["minOutputAmount", getU64Encoder()],
]);

/**
 * Creates a MetaDAO swap instruction for a specified input budget.
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
 *   spot_swap,
 *   type MetadaoSpotSwapAccounts,
 *   type MetadaoSpotSwapArgs,
 * } from "celere-protocol-sdk/instructions/metadao";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MetadaoSpotSwapAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MetadaoSpotSwapArgs = {
 *   amountIn,
 *   direction: "buy",
 *   minimumAmountOut,
 * };
 *
 * const instruction = spot_swap(accounts, args);
 * ```
 *
 * @remarks
 * This is the Futarchy v0.6 spot-market instruction. The caller must verify that the
 * supplied market state allows the requested spot swap; construction does not validate
 * futarchy or conditional-market state.
 *
 * @see {@link MetadaoSpotSwapAccounts}
 * @see {@link MetadaoSpotSwapArgs}
 */
export function spot_swap(
  accounts: MetadaoSpotSwapAccounts,
  args: MetadaoSpotSwapArgs,
): Instruction {
  return {
    programAddress: METADAO_PROGRAM,
    accounts: [
      { address: accounts.dao, role: AccountRole.WRITABLE },
      { address: accounts.userBaseAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteAccount, role: AccountRole.WRITABLE },
      { address: accounts.ammBaseVault, role: AccountRole.WRITABLE },
      { address: accounts.ammQuoteVault, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METADAO_PROGRAM, role: AccountRole.READONLY },
    ],
    data: spotSwapEncoder.encode({
      discriminator: new Uint8Array([167, 97, 12, 231, 237, 78, 166, 251]),
      inputAmount: args.amountIn,
      swapType: args.direction === "buy" ? 0 : 1,
      minOutputAmount: args.minimumAmountOut,
    }),
  };
}
