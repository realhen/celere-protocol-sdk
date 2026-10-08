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

const DISCRIMINATOR = new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["maxSolCost", getU64Encoder()],
  ["trackVolume", getU8Encoder()],
  ["partialFill", getU8Encoder()],
]);

/** Ordered account addresses for the native `buy` instruction. */
export interface PumpBuyAccounts {
  readonly global: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly associatedBondingCurve: Address;
  readonly associatedUser: Address;
  readonly user: Address;
  readonly systemProgram: Address;
  readonly tokenProgram: Address;
  readonly creatorVault: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly globalVolumeAccumulator: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly feeProgram: Address;
  readonly bondingCurveV2: Address;
  readonly buybackFeeRecipient: Address;
}

/** Atomic native amounts for `buy`; the caller validates state and limits. */
export interface PumpBuyArgs {
  /** Exact base-token output in atomic token units. */
  readonly amount: bigint;
  /** Maximum native SOL input, in lamports. */
  readonly maxSolCost: bigint;
}

/**
 * Build the native `buy` instruction without account discovery or validation.
 * @remarks
 * - Bytes 0–7: discriminator (8 bytes).
 * - Bytes 8–15: `amount` (u64 little endian).
 * - Bytes 16–23: `maxSolCost` (u64 little endian).
 * - Byte 24: `trackVolume` (u8).
 * - Byte 25: `partialFill` (u8).
 * Total data length: 26 bytes.
 * Both OptionBool fields are single-byte tuple values, not Borsh options; tracking and partial fill are fixed to false.
 * Callers validate account identities, PDAs, state, amounts and execution limits.
 * @throws Synchronous codec errors if an argument cannot be encoded.
 */
export function getPumpBuyInstruction(
  accounts: PumpBuyAccounts,
  args: PumpBuyArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    maxSolCost: args.maxSolCost,
    trackVolume: 0,
    partialFill: 0,
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
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.creatorVault, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.globalVolumeAccumulator, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.feeProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurveV2, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
