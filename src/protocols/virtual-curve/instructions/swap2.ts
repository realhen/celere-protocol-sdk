import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
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
import { VIRTUAL_CURVE_PROGRAM, VIRTUAL_CURVE_AUTHORITY } from "../constants.js";
const discriminator = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["swapMode", getU8Encoder()],
]);
/** Native swap2 accounts for classic SPL pools, without referral or special fee accounts. */
export interface VirtualCurveSwap2Accounts {
  readonly config: Address;
  readonly pool: Address;
  readonly inputTokenAccount: Address;
  readonly outputTokenAccount: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly payer: Address;
  readonly eventAuthority: Address;
}
/** Token amounts are atomic units, with the direction determined by the input account. */
export interface VirtualCurveSwap2Args {
  /** Input for mode 0; desired output for mode 2. */
  readonly amount: bigint;
  /** Minimum output for mode 0; maximum input for mode 2. */
  readonly otherAmountThreshold: bigint;
  /** Native full-fill exact input or exact output; partial-fill mode is excluded. */
  readonly swapMode: 0 | 2;
}
/**
 * Build native DBC swap2 without deriving or validating caller-owned accounts.
 * @remarks Data: [0,8) discriminator, [8,16) amount u64, [16,24) threshold u64,
 * [24,25) mode u8. All integers are little-endian. Referral uses the program-ID
 * sentinel; no dynamic trailing accounts are included. Caller validates state and limits.
 * @throws Synchronous codec errors for out-of-range amounts.
 */
export function swap2(
  accounts: VirtualCurveSwap2Accounts,
  args: VirtualCurveSwap2Args,
): Instruction {
  return {
    programAddress: VIRTUAL_CURVE_PROGRAM,
    accounts: [
      { address: VIRTUAL_CURVE_AUTHORITY, role: AccountRole.READONLY },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.outputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.payer, role: AccountRole.READONLY_SIGNER },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: VIRTUAL_CURVE_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: VIRTUAL_CURVE_PROGRAM, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amount: args.amount,
      otherAmountThreshold: args.otherAmountThreshold,
      swapMode: args.swapMode,
    }),
  };
}
