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

/** Identifies Sugar’s native `buy_exact_in` instruction. */
const DISCRIMINATOR = new Uint8Array([250, 234, 13, 123, 213, 156, 19, 236]);
/** Encodes the native `buy_exact_in` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["bondingCurveBump", getU8Encoder()],
  ["solVaultBump", getU8Encoder()],
  ["solAmountInput", getU64Encoder()],
  ["minTokensOutput", getU64Encoder()],
]);

/** Accounts required by Sugar’s native `buy_exact_in` instruction. */
export interface SugarBuyExactInAccounts {
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
 * Native arguments for {@link buy_exact_in}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface SugarBuyExactInArgs {
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
   * Amount of native SOL supplied to the trade, in lamports. For example, `1_000_000_000n`
   * means 1 SOL.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly solAmountInput: bigint;
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
  readonly minTokensOutput: bigint;
}

/**
 * Creates a Sugar buy instruction for a specified input budget.
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
 * Build an input-budget trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data. This demonstrates encoding the
 * historical interface, not a successful trade against the disabled deployment.
 *
 * ```ts
 * import {
 *   buy_exact_in,
 *   type SugarBuyExactInAccounts,
 *   type SugarBuyExactInArgs,
 * } from "celere-protocol-sdk/instructions/sugar";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: SugarBuyExactInAccounts;
 * // Use the bumps returned by the corresponding PDA derivations.
 * declare const bumps: Pick<SugarBuyExactInArgs, "bondingCurveBump" | "solVaultBump">;
 *
 * const amountIn = 1_000_000_000n; // 1 SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: SugarBuyExactInArgs = {
 *   bondingCurveBump: bumps.bondingCurveBump,
 *   solVaultBump: bumps.solVaultBump,
 *   solAmountInput: amountIn,
 *   minTokensOutput: minimumAmountOut,
 * };
 *
 * const instruction = buy_exact_in(accounts, args);
 * ```
 *
 * @remarks
 * This preserves Sugar’s historical instruction interface. The deployment checked by
 * this repository rejects all calls with Custom(1); successful construction is not
 * evidence of an executable trade. Supply the PDA bumps obtained from the matching curve
 * and SOL-vault derivations. SOL amounts are native lamports.
 *
 * @see {@link SugarBuyExactInAccounts}
 * @see {@link SugarBuyExactInArgs}
 */
export function buy_exact_in(
  accounts: SugarBuyExactInAccounts,
  args: SugarBuyExactInArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    bondingCurveBump: args.bondingCurveBump,
    solVaultBump: args.solVaultBump,
    solAmountInput: args.solAmountInput,
    minTokensOutput: args.minTokensOutput,
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
