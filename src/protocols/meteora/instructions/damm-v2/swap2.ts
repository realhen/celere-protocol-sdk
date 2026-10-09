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
import { METEORA_DAMM_V2_PROGRAM } from "../../constants.js";

const discriminator = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["swapMode", getU8Encoder()],
]);

/** Native DAMM v2 accounts, with the optional referral token account omitted. */
export interface MeteoraDammV2Swap2Accounts {
  readonly poolAuthority: Address;
  readonly pool: Address;
  readonly userInputToken: Address;
  readonly userOutputToken: Address;
  readonly tokenVaultA: Address;
  readonly tokenVaultB: Address;
  readonly tokenMintA: Address;
  readonly tokenMintB: Address;
  readonly payer: Address;
  readonly tokenProgramA: Address;
  readonly tokenProgramB: Address;
  readonly eventAuthority: Address;
}
/** Raw native mode semantics; amounts use atomic token units. */
export interface MeteoraDammV2Swap2Args {
  /** Input amount for modes 0/1, desired output for mode 2. */
  readonly amount: bigint;
  /** Minimum output for modes 0/1, maximum input for mode 2. */
  readonly otherAmountThreshold: bigint;
  /** 0: exact input, 1: partial-fill input, 2: exact output. */
  readonly swapMode: 0 | 1 | 2;
}

/**
 * Build native `swap2`; mode selection does not create a different instruction.
 * @remarks Data: [0,8) discriminator; [8,16) amount; [16,24) otherAmountThreshold;
 * [24,25) swapMode. Amount fields are little-endian u64; mode is u8. The referral
 * account is the program-ID sentinel. Caller validates PDAs, state and limits.
 * @throws Synchronous codec errors for values outside the native integer range.
 */
export function swap2(
  accounts: MeteoraDammV2Swap2Accounts,
  args: MeteoraDammV2Swap2Args,
): Instruction {
  return {
    programAddress: METEORA_DAMM_V2_PROGRAM,
    accounts: [
      { address: accounts.poolAuthority, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userInputToken, role: AccountRole.WRITABLE },
      { address: accounts.userOutputToken, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultA, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultB, role: AccountRole.WRITABLE },
      { address: accounts.tokenMintA, role: AccountRole.READONLY },
      { address: accounts.tokenMintB, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.READONLY_SIGNER },
      { address: accounts.tokenProgramA, role: AccountRole.READONLY },
      { address: accounts.tokenProgramB, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amount: args.amount,
      otherAmountThreshold: args.otherAmountThreshold,
      swapMode: args.swapMode,
    }),
  };
}
