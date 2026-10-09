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
import { SUGAR_PROGRAM } from "../constants.js";

/** Identifies Sugar’s native `buy_exact_out` instruction. */
const DISCRIMINATOR = new Uint8Array([24, 211, 116, 40, 105, 3, 153, 56]);
/** Encodes the native `buy_exact_out` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["bondingCurveBump", getU8Encoder()],
  ["solVaultBump", getU8Encoder()],
  ["maxSolAmountInput", getU64Encoder()],
  ["tokensOutput", getU64Encoder()],
]);

/** Accounts required by Sugar’s native `buy_exact_out` instruction. */
export interface SugarBuyExactOutAccounts {
  readonly state: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly solVault: Address;
  readonly tokenVault: Address;
  readonly userTokenAccount: Address;
  readonly payer: Address;
  readonly receiver: Address;
  readonly feeReceiver: Address;
  readonly tokenProgram: Address;
  readonly associatedTokenProgram: Address;
  readonly systemProgram: Address;
  readonly rent: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/**
 * Native arguments for {@link buy_exact_out}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface SugarBuyExactOutArgs {
  /**
   * PDA bump returned when deriving the supplied bonding-curve address.
   *
   * Pass the bump from that specific derivation, as an integer from 0 through 255. Do not
   * use a guessed constant or reuse a bump from another pool; construction does not verify
   * the seeds.
   */
  readonly bondingCurveBump: number;
  /**
   * PDA bump returned when deriving the supplied SOL-vault address.
   *
   * Pass the bump from that specific derivation, as an integer from 0 through 255. Do not
   * use a guessed constant or reuse a bump from another pool; construction does not verify
   * the seeds.
   */
  readonly solVaultBump: number;
  /**
   * Maximum acceptable native SOL input, in lamports. For example, `1_000_000_000n` means
   * 1 SOL.
   *
   * Increase the required input from a quote for the requested output by your chosen
   * slippage tolerance, rounding up in atomic units. A quote of `1_000_000_000n` with a 1%
   * tolerance gives `1_010_000_000n`. Include applicable trading fees in that input quote;
   * transaction fees and rent remain separate SOL costs.
   *
   * Zero is a zero spending limit, not an unlimited-input sentinel.
   */
  readonly maxSolAmountInput: bigint;
  /**
   * Requested base token output, in base-token atomic units. For example, `500_000_000n`
   * means 500 tokens when the base mint has six decimals.
   *
   * Quote the input required for this output, then set the maximum-input argument from
   * that quote and your chosen tolerance. This value is not a price or a slippage
   * percentage.
   */
  readonly tokensOutput: bigint;
}

/**
 * Creates a Sugar buy instruction for a requested output amount.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range. A PDA bump
 * outside the unsigned 8-bit range also throws.
 * On-chain account, balance, price, and slippage failures occur during execution, not
 * during construction.
 *
 * @example
 * Build an output-target trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data. This demonstrates encoding the
 * historical interface, not a successful trade against the disabled deployment.
 *
 * ```ts
 * import {
 *   buy_exact_out,
 *   type SugarBuyExactOutAccounts,
 *   type SugarBuyExactOutArgs,
 * } from "celere-protocol-sdk/instructions/sugar";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: SugarBuyExactOutAccounts;
 * // Use the bumps returned by the corresponding PDA derivations.
 * declare const bumps: Pick<SugarBuyExactOutArgs, "bondingCurveBump" | "solVaultBump">;
 *
 * const amountOut = 500_000_000n; // 500 base tokens with six decimals.
 * const quotedAmountIn = 1_000_000_000n; // Hypothetical quote: 1 SOL.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const maximumAmountIn =
 *   (quotedAmountIn * (10_000n + slippageBps) + 9_999n) / 10_000n;
 *
 * const args: SugarBuyExactOutArgs = {
 *   bondingCurveBump: bumps.bondingCurveBump,
 *   solVaultBump: bumps.solVaultBump,
 *   maxSolAmountInput: maximumAmountIn,
 *   tokensOutput: amountOut,
 * };
 *
 * const instruction = buy_exact_out(accounts, args);
 * ```
 *
 * @remarks
 * This preserves Sugar’s historical instruction interface. The deployment checked by
 * this repository rejects all calls with Custom(1); successful construction is not
 * evidence of an executable trade. Supply the PDA bumps obtained from the matching curve
 * and SOL-vault derivations. SOL amounts are native lamports.
 *
 * @see {@link SugarBuyExactOutAccounts}
 * @see {@link SugarBuyExactOutArgs}
 */
export function buy_exact_out(
  accounts: SugarBuyExactOutAccounts,
  args: SugarBuyExactOutArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    bondingCurveBump: args.bondingCurveBump,
    solVaultBump: args.solVaultBump,
    maxSolAmountInput: args.maxSolAmountInput,
    tokensOutput: args.tokensOutput,
  });
  return {
    programAddress: SUGAR_PROGRAM,
    accounts: [
      { address: accounts.state, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.solVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenVault, role: AccountRole.WRITABLE },
      { address: accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.receiver, role: AccountRole.READONLY },
      { address: accounts.feeReceiver, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.associatedTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.rent, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
