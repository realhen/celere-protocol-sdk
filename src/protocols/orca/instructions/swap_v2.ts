import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  AccountRole,
  fixEncoderSize,
  getArrayEncoder,
  getBooleanEncoder,
  getBytesEncoder,
  getOptionEncoder,
  getStructEncoder,
  getU8Encoder,
  getU64Encoder,
  getU128Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { WHIRLPOOL_PROGRAM } from "../constants.js";

/** Identifies Orca Whirlpool’s native `swap_v2` instruction. */
const discriminator = Uint8Array.of(43, 4, 237, 11, 26, 201, 30, 98);
/** Encodes the native descriptor for a supplemental account group. */
const remainingAccountsSliceEncoder = getStructEncoder([
  ["accountsType", getU8Encoder()],
  ["length", getU8Encoder()],
]);
/** Encodes the native `swap_v2` arguments and instruction discriminator. */
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["sqrtPriceLimit", getU128Encoder()],
  ["amountSpecifiedIsInput", getBooleanEncoder()],
  ["aToB", getBooleanEncoder()],
  [
    "remainingAccountsInfo",
    getOptionEncoder(
      getStructEncoder([["slices", getArrayEncoder(remainingAccountsSliceEncoder)]]),
    ),
  ],
]);

/** Accounts required by Orca Whirlpool’s native `swap_v2` instruction. */
export interface OrcaSwapV2Accounts {
  readonly tokenProgramA: Address;
  readonly tokenProgramB: Address;
  readonly tokenAuthority: Address;
  readonly whirlpool: Address;
  readonly tokenMintA: Address;
  readonly tokenMintB: Address;
  readonly tokenOwnerAccountA: Address;
  readonly tokenVaultA: Address;
  readonly tokenOwnerAccountB: Address;
  readonly tokenVaultB: Address;
  readonly tickArray0: Address;
  readonly tickArray1: Address;
  readonly tickArray2: Address;
  readonly oracle: Address;
  /** Optional writable tick arrays follow the oracle in native traversal order. */
  readonly supplementalTickArrays?: readonly Address[];
}
/**
 * Native arguments for {@link swap_v2}.
 *
 * Amounts use each asset’s smallest unit as bigint; read the mint’s decimals before
 * converting display quantities. The builder does not quote, convert units, or choose a
 * slippage tolerance.
 *
 * @remarks
 * Amount fields must fit an unsigned 64-bit integer (0 through 2^64 - 1). Mode-specific
 * fields have their own documented meanings. Encoding successfully does not establish
 * that the trade can execute.
 */
export interface OrcaSwapV2Args {
  /**
   * Specified swap amount in atomic units of the asset selected by amountSpecifiedIsInput.
   *
   * With amountSpecifiedIsInput = true, this is the input amount (for example,
   * `1_000_000_000n` for 1 wrapped SOL). With amountSpecifiedIsInput = false, it is the
   * requested output (for example, `500_000_000n` for 500 tokens with six decimals). Read
   * both mints’ decimals; changing mode also changes this field’s unit.
   */
  readonly amount: bigint;
  /**
   * Slippage bound in atomic units of the asset opposite to amount.
   *
   * With amountSpecifiedIsInput = true, supply the minimum output, using the recipient’s
   * quoted output after applicable fees and rounding down: `500_000_000n` quoted output
   * with 1% tolerance becomes `495_000_000n`.
   *
   * With amountSpecifiedIsInput = false, supply the maximum input, including applicable
   * trading fees and rounding up: `1_000_000_000n` quoted input with 1% tolerance becomes
   * `1_010_000_000n`. Zero disables a positive output floor in input mode, but is a zero
   * spending cap in output mode.
   */
  readonly otherAmountThreshold: bigint;
  /**
   * Pool-price boundary in unsigned Q64.64 square-root units, not a token amount or
   * basis-point tolerance.
   *
   * The underlying ratio is token B atomic units per token A atomic unit. For an
   * atomic-unit ratio of 1, the boundary is `1n` << `64n`. A displayed token price must
   * first be adjusted for both mints’ decimals. Use a protocol quote to select a valid
   * directional boundary.
   *
   * Zero selects the native default boundary and rejects incomplete exact-output
   * execution. Exact-input execution may still be partial. Encodable values span 0 through
   * 2^128 - 1; the native program enforces its narrower valid price range.
   */
  readonly sqrtPriceLimit: bigint;
  /**
   * Whether amount specifies the input (true) or requested output (false).
   *
   * With true, otherAmountThreshold is a minimum output. With false, it is a maximum
   * input. This flag selects amount interpretation; it does not select the token
   * direction.
   */
  readonly amountSpecifiedIsInput: boolean;
  /**
   * Whether to spend token A for token B (true) or token B for token A (false).
   *
   * Use the Whirlpool’s on-chain mint ordering, not an alphabetical symbol order. A-to-B
   * decreases the pool price; B-to-A increases it. Any explicit price boundary must lie in
   * the selected direction.
   */
  readonly aToB: boolean;
}

/**
 * Creates a Orca Whirlpool swap instruction with caller-selected amount interpretation.
 *
 * Accounts and arguments are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @param args - Atomic amounts, mode selection and execution bounds chosen by the caller.
 * @returns An unsigned instruction to include in a transaction.
 * @throws Synchronously if an amount is outside the unsigned 64-bit range. An
 * out-of-range unsigned 128-bit price limit also throws. The supplemental array count
 * must fit an unsigned 8-bit integer.
 * On-chain account, balance, price, and slippage failures occur during execution, not
 * during construction.
 *
 * @example
 * Build an input-budget trade with a caller-chosen 1% tolerance. Amounts below
 * illustrate a hypothetical quote, not live market data. This example selects exact
 * input. Assume token A is wrapped SOL and token B has six decimals.
 *
 * ```ts
 * import {
 *   swap_v2,
 *   type OrcaSwapV2Accounts,
 *   type OrcaSwapV2Args,
 * } from "celere-protocol-sdk/instructions/orca";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: OrcaSwapV2Accounts;
 *
 * const amountIn = 1_000_000_000n; // 1 wrapped SOL.
 * const quotedAmountOut = 500_000_000n; // Hypothetical quote: 500 base tokens with six decimals.
 * const slippageBps = 100n; // 1%; chosen by the caller.
 * const minimumAmountOut =
 *   (quotedAmountOut * (10_000n - slippageBps)) / 10_000n;
 *
 * const args: OrcaSwapV2Args = {
 *   amount: amountIn,
 *   otherAmountThreshold: minimumAmountOut,
 *   sqrtPriceLimit: 0n,
 *   amountSpecifiedIsInput: true,
 *   aToB: true,
 * };
 *
 * const instruction = swap_v2(accounts, args);
 * ```
 *
 * @remarks
 * Supply tick arrays for the swap direction, including any supplemental arrays in native
 * traversal order. This builder adds their native remaining-account metadata, but does
 * not discover arrays or include transfer-hook accounts. Exact-input execution may
 * consume less than the specified input. SOL uses an existing wrapped SOL account.
 *
 * @see {@link OrcaSwapV2Accounts}
 * @see {@link OrcaSwapV2Args}
 */
export function swap_v2(accounts: OrcaSwapV2Accounts, args: OrcaSwapV2Args): Instruction {
  const supplementalTickArrays = accounts.supplementalTickArrays ?? [];
  const remainingAccountsInfo =
    supplementalTickArrays.length === 0
      ? null
      : {
          slices: [{ accountsType: 6, length: supplementalTickArrays.length }],
        };
  return {
    programAddress: WHIRLPOOL_PROGRAM,
    accounts: [
      { address: accounts.tokenProgramA, role: AccountRole.READONLY },
      { address: accounts.tokenProgramB, role: AccountRole.READONLY },
      { address: MEMO_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.tokenAuthority, role: AccountRole.READONLY_SIGNER },
      { address: accounts.whirlpool, role: AccountRole.WRITABLE },
      { address: accounts.tokenMintA, role: AccountRole.READONLY },
      { address: accounts.tokenMintB, role: AccountRole.READONLY },
      { address: accounts.tokenOwnerAccountA, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultA, role: AccountRole.WRITABLE },
      { address: accounts.tokenOwnerAccountB, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultB, role: AccountRole.WRITABLE },
      { address: accounts.tickArray0, role: AccountRole.WRITABLE },
      { address: accounts.tickArray1, role: AccountRole.WRITABLE },
      { address: accounts.tickArray2, role: AccountRole.WRITABLE },
      { address: accounts.oracle, role: AccountRole.WRITABLE },
      ...supplementalTickArrays.map((tickArray) => ({
        address: tickArray,
        role: AccountRole.WRITABLE,
      })),
    ],
    data: dataEncoder.encode({
      discriminator,
      amount: args.amount,
      otherAmountThreshold: args.otherAmountThreshold,
      sqrtPriceLimit: args.sqrtPriceLimit,
      amountSpecifiedIsInput: args.amountSpecifiedIsInput,
      aToB: args.aToB,
      remainingAccountsInfo,
    }),
  };
}
