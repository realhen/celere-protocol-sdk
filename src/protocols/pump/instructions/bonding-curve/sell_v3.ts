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

const DISCRIMINATOR = new Uint8Array([28, 146, 222, 119, 38, 196, 105, 213]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["minSolOutput", getU64Encoder()],
]);

/** Ordered native `sell_v3` accounts; quote ATAs are unused placeholders for native SOL. */
export interface PumpSellV3Accounts {
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

/** Native `sell_v3` atomic amounts. */
export interface PumpSellV3Args {
  /** Exact base-token input in atomic units. */
  readonly amount: bigint;
  /** Minimum net quote output in atomic quote units. */
  readonly minSolOutput: bigint;
}

/**
 * Build `sell_v3` without fetching, deriving addresses, or validating market state.
 * @remarks
 * - Bytes 0–7: discriminator.
 * - Bytes 8–15: `amount` (u64 little endian).
 * - Bytes 16–23: `minSolOutput` (u64 little endian).
 * Total length: 24 bytes. Protocol and creator fees remain on the curve.
 * The buyback quote ATA must exist for token-quoted markets; this instruction never creates it.
 * @throws Synchronous codec errors when amounts cannot be encoded.
 */
export function sell_v3(accounts: PumpSellV3Accounts, args: PumpSellV3Args): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amount: args.amount,
    minSolOutput: args.minSolOutput,
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
