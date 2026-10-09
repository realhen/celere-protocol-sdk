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

const DISCRIMINATOR = new Uint8Array([7, 5, 29, 196, 245, 23, 101, 80]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["maxSolCost", getU64Encoder()],
  ["partialFill", getU8Encoder()],
]);

/** Ordered native `buy_v3` accounts; quote ATAs are unused placeholders for native SOL. */
export interface PumpBuyV3Accounts {
  readonly global: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly bondingCurve: Address;
  readonly associatedBaseBondingCurve: Address;
  readonly associatedQuoteBondingCurve: Address;
  readonly user: Address;
  readonly associatedBaseUser: Address;
  readonly associatedQuoteUser: Address;
  readonly userVolumeAccumulator: Address;
  readonly feeConfig: Address;
  readonly buybackFeeRecipient: Address;
  readonly systemProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/** Native `buy_v3` atomic amounts. */
export interface PumpBuyV3Args {
  /** Exact base-token output, including any synthetic migration portion. */
  readonly amount: bigint;
  /** Maximum total quote debit including both fees, in atomic quote units. */
  readonly maxSolCost: bigint;
}

/**
 * Build `buy_v3` without fetching, deriving addresses, or validating market state.
 * @remarks
 * - Bytes 0–7: discriminator.
 * - Bytes 8–15: `amount` (u64 little endian).
 * - Bytes 16–23: `maxSolCost` (u64 little endian).
 * - Byte 24: partial-fill OptionBool fixed to false.
 * Total length: 25 bytes. Protocol and creator fees remain on the curve.
 * The buyback quote ATA must exist for token-quoted markets; this instruction never creates it.
 * @throws Synchronous codec errors when amounts cannot be encoded.
 */
export function getPumpBuyV3Instruction(
  accounts: PumpBuyV3Accounts,
  args: PumpBuyV3Args,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    maxSolCost: args.maxSolCost,
    partialFill: 0,
  });
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedBaseBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.associatedBaseUser, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteUser, role: AccountRole.WRITABLE },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
