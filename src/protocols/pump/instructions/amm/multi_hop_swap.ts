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

/** Identifies PumpSwap’s native `multi_hop_swap` instruction. */
const DISCRIMINATOR = new Uint8Array([43, 100, 73, 19, 233, 246, 111, 148]);
/** Encodes the native `multi_hop_swap` arguments and instruction discriminator. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minAmountOut", getU64Encoder()],
]);

/** Accounts for one caller-selected hop in PumpSwap’s native `multi_hop_swap` instruction. */
export interface PumpAmmMultiHopSwapHopAccounts {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly pool: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
}

/** Accounts required by PumpSwap’s native `multi_hop_swap` instruction. */
export interface PumpAmmMultiHopSwapAccounts {
  readonly user: Address;
  readonly userInTokenAccount: Address;
  readonly userOutTokenAccount: Address;
  readonly globalConfig: Address;
  readonly feeConfig: Address;
  readonly userVolumeAccumulator: Address;
  readonly buybackFeeRecipient: Address;
  readonly tokenProgram: Address;
  readonly token2022Program: Address;
  readonly systemProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly pumpProgram: Address;
  readonly pumpGlobal: Address;
  readonly pumpFeeConfig: Address;
  readonly pumpEventAuthority: Address;
  readonly hops: readonly PumpAmmMultiHopSwapHopAccounts[];
}

/**
 * Native arguments for {@link multi_hop_swap}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Encoding
 * successfully does not establish that the trade can execute.
 */
export interface PumpAmmMultiHopSwapArgs {
  /**
   * Amount of input token supplied to the trade, in input-token atomic units. For example,
   * `1_000_000_000n` means 1 wrapped SOL when wrapped SOL is the input mint.
   *
   * Use a quote for this same input amount and the supplied market state. Trading fees are
   * handled by the native program; transaction fees and account-creation rent are separate
   * SOL costs.
   *
   * This amount applies at the first route input; it is not a per-hop amount.
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
   *
   * This amount applies at the final route output; it is not a per-hop amount.
   */
  readonly minAmountOut: bigint;
}

/**
 * Creates a PumpSwap instruction for a caller-selected route with a specified input
 * budget.
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
 *   multi_hop_swap,
 *   type PumpAmmMultiHopSwapAccounts,
 *   type PumpAmmMultiHopSwapArgs,
 * } from "celere-protocol-sdk/instructions/pump-amm";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpAmmMultiHopSwapAccounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: PumpAmmMultiHopSwapArgs = {
 *   amountIn,
 *   minAmountOut: minimumAmountOut,
 * };
 *
 * const instruction = multi_hop_swap(accounts, args);
 * ```
 *
 * @remarks
 * Supply hops in the route’s execution order. The builder neither chooses a route nor
 * validates its length, mint continuity or supported pool combinations. Both endpoint
 * user token accounts must exist; no intermediate user token accounts are passed. A SOL
 * curve at the currency endpoint transfers native lamports while the WSOL token account
 * is read for its mint. Quote the native route as a whole: its fee treatment differs
 * from chaining standalone swaps.
 *
 * @see {@link PumpAmmMultiHopSwapAccounts}
 * @see {@link PumpAmmMultiHopSwapArgs}
 */
export function multi_hop_swap(
  accounts: PumpAmmMultiHopSwapAccounts,
  args: PumpAmmMultiHopSwapArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amountIn: args.amountIn,
    minAmountOut: args.minAmountOut,
  });
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.userInTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userOutTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.token2022Program, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.pumpProgram, role: AccountRole.READONLY },
      { address: accounts.pumpGlobal, role: AccountRole.READONLY },
      { address: accounts.pumpFeeConfig, role: AccountRole.READONLY },
      { address: accounts.pumpEventAuthority, role: AccountRole.READONLY },
      ...accounts.hops.flatMap((hop) => [
        { address: hop.baseMint, role: AccountRole.READONLY },
        { address: hop.quoteMint, role: AccountRole.READONLY },
        { address: hop.pool, role: AccountRole.WRITABLE },
        { address: hop.baseVault, role: AccountRole.WRITABLE },
        { address: hop.quoteVault, role: AccountRole.WRITABLE },
      ]),
    ],
    data,
  };
}
