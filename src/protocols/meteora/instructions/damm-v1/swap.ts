import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METEORA_DAMM_V1_PROGRAM, METEORA_VAULT_PROGRAM } from "../../constants.js";

/** Identifies Meteora DAMM v1’s native `swap` instruction. */
const discriminator = Uint8Array.of(248, 198, 158, 145, 225, 117, 135, 200);
/** Encodes the native `swap` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/** Accounts required by Meteora DAMM v1’s native `swap` instruction. */
export interface MeteoraDammV1SwapAccounts {
  readonly pool: Address;
  readonly userSourceToken: Address;
  readonly userDestinationToken: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
  readonly tokenVaultA: Address;
  readonly tokenVaultB: Address;
  readonly vaultLpMintA: Address;
  readonly vaultLpMintB: Address;
  readonly vaultLpTokenA: Address;
  readonly vaultLpTokenB: Address;
  readonly protocolTokenFee: Address;
  readonly user: Address;
}
/**
 * Native arguments for {@link swap}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface MeteoraDammV1SwapArgs {
  /**
   * Amount of input token supplied to the trade, in input-token atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL when wrapped SOL is the input mint.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   */
  readonly amountIn: bigint;
  /**
   * Minimum acceptable output token output, in output-token atomic units. For example,
   * `500_000_000n` means 500 tokens when the output mint has six decimals.
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

/**
 * Creates a Meteora DAMM v1 swap instruction for a specified input budget.
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
 *   swap,
 *   type MeteoraDammV1SwapAccounts,
 *   type MeteoraDammV1SwapArgs,
 * } from "celere-protocol-sdk/instructions/meteora-damm-v1";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: MeteoraDammV1SwapAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: MeteoraDammV1SwapArgs = {
 *   amountIn,
 *   minimumAmountOut,
 * };
 *
 * const instruction = swap(accounts, args);
 * ```
 *
 * @remarks
 * Select direction with the supplied source and destination token accounts. Validate the
 * pool, vault share accounts and their backing before execution. SOL uses an existing
 * wrapped SOL account.
 *
 * @see {@link MeteoraDammV1SwapAccounts}
 * @see {@link MeteoraDammV1SwapArgs}
 */
export function swap(
  accounts: MeteoraDammV1SwapAccounts,
  args: MeteoraDammV1SwapArgs,
): Instruction {
  return {
    programAddress: METEORA_DAMM_V1_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userSourceToken, role: AccountRole.WRITABLE },
      { address: accounts.userDestinationToken, role: AccountRole.WRITABLE },
      { address: accounts.vaultA, role: AccountRole.WRITABLE },
      { address: accounts.vaultB, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultA, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultB, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpMintA, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpMintB, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpTokenA, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpTokenB, role: AccountRole.WRITABLE },
      { address: accounts.protocolTokenFee, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: METEORA_VAULT_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
    }),
  };
}
