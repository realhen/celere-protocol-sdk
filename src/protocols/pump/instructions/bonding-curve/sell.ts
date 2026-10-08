import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_PROGRAM } from "../../constants.js";

const DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["minSolOutput", getU64Encoder()],
]);

/** Ordered account addresses for the native `sell` instruction. */
export interface PumpSellAccounts {
  readonly global: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly associatedBondingCurve: Address;
  readonly associatedUser: Address;
  readonly user: Address;
  readonly systemProgram: Address;
  readonly creatorVault: Address;
  readonly tokenProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly feeConfig: Address;
  readonly feeProgram: Address;
  readonly bondingCurveV2: Address;
  readonly buybackFeeRecipient: Address;
}

/** Atomic native amounts for `sell`; the caller validates state and limits. */
export interface PumpSellArgs {
  /** Exact base-token input in atomic token units. */
  readonly amount: bigint;
  /** Minimum native SOL output, in lamports. */
  readonly minSolOutput: bigint;
}

/**
 * Build the native `sell` instruction without account discovery or validation.
 * @remarks
 * - Bytes 0–7: discriminator (8 bytes).
 * - Bytes 8–15: `amount` (u64 little endian).
 * - Bytes 16–23: `minSolOutput` (u64 little endian).
 * Total data length: 24 bytes.
 * Creator vault precedes the token program; the two volume-accumulator accounts are absent.
 * Callers validate account identities, PDAs, state, amounts and execution limits.
 * @throws Synchronous codec errors if an argument cannot be encoded.
 */
export function getPumpSellInstruction(
  accounts: PumpSellAccounts,
  args: PumpSellArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    minSolOutput: args.minSolOutput,
  });
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedUser, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.creatorVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.feeProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurveV2, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
