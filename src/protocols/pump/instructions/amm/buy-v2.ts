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

const DISCRIMINATOR = new Uint8Array([184, 23, 238, 97, 103, 197, 211, 61]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["baseAmountOut", getU64Encoder()],
  ["maxQuoteAmountIn", getU64Encoder()],
]);

/** Ordered account addresses for the native `buy_v2` instruction. */
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

/** Atomic native amounts for `buy_v2`; the caller validates state and limits. */
export interface PumpAmmBuyV2Args {
  /** Exact base-token output in atomic units. */
  readonly baseAmountOut: bigint;
  /** Maximum quote-token input including fees, in atomic units. */
  readonly maxQuoteAmountIn: bigint;
}

/**
 * Build the native `buy_v2` instruction without account discovery or validation.
 * @remarks
 * - Bytes 0–7: discriminator (8 bytes).
 * - Bytes 8–15: `baseAmountOut` (u64 little endian).
 * - Bytes 16–23: `maxQuoteAmountIn` (u64 little endian).
 * Total data length: 24 bytes.
 * Both assets use SPL token accounts; wrapped SOL funding remains caller-owned.
 * Callers validate account identities, PDAs, state, amounts and execution limits.
 * @throws Synchronous codec errors if an argument cannot be encoded.
 */
export function getPumpAmmBuyV2Instruction(
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
