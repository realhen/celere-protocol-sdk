import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU32Encoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METEORA_DLMM_PROGRAM } from "../../constants.js";

const discriminator = Uint8Array.of(43, 215, 247, 132, 137, 60, 243, 81);
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
  ["remainingAccountsSliceCount", getU32Encoder()],
]);

/** Native DLMM swap accounts; dynamic bin arrays follow the event-program account. */
export interface MeteoraDlmmSwapExactOut2Accounts {
  readonly pool: Address;
  /** Null encodes the program-ID sentinel for an absent bitmap extension. */
  readonly bitmapExtension: Address | null;
  readonly reserveX: Address;
  readonly reserveY: Address;
  readonly userTokenIn: Address;
  readonly userTokenOut: Address;
  readonly tokenMintX: Address;
  readonly tokenMintY: Address;
  readonly oracle: Address;
  readonly sender: Address;
  readonly tokenProgramX: Address;
  readonly tokenProgramY: Address;
  readonly eventAuthority: Address;
  /** Caller supplies bin arrays in native traversal order. */
  readonly binArrays: readonly Address[];
}
/** Amounts use atomic input/output token units. */
export interface MeteoraDlmmSwapExactOut2Args {
  readonly maximumAmountIn: bigint;
  readonly amountOut: bigint;
}

/**
 * Build native `swap_exact_out2` with no host-fee or transfer-hook accounts.
 * @remarks Data: [0,8) discriminator; [8,16) maximumAmountIn; [16,24) amountOut;
 * [24,28) empty remaining-account slice vector length. Integer fields use
 * little-endian u64/u32. Writable bin arrays form the dynamic trailing accounts;
 * they do not add slice metadata. Caller validates PDAs, traversal and limits.
 * @throws Synchronous codec errors for values outside the native integer range.
 */
export function getMeteoraDlmmSwapExactOut2Instruction(
  accounts: MeteoraDlmmSwapExactOut2Accounts,
  args: MeteoraDlmmSwapExactOut2Args,
): Instruction {
  return {
    programAddress: METEORA_DLMM_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      {
        address: accounts.bitmapExtension ?? METEORA_DLMM_PROGRAM,
        role:
          accounts.bitmapExtension === null ? AccountRole.READONLY : AccountRole.WRITABLE,
      },
      { address: accounts.reserveX, role: AccountRole.WRITABLE },
      { address: accounts.reserveY, role: AccountRole.WRITABLE },
      { address: accounts.userTokenIn, role: AccountRole.WRITABLE },
      { address: accounts.userTokenOut, role: AccountRole.WRITABLE },
      { address: accounts.tokenMintX, role: AccountRole.READONLY },
      { address: accounts.tokenMintY, role: AccountRole.READONLY },
      { address: accounts.oracle, role: AccountRole.WRITABLE },
      { address: METEORA_DLMM_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.sender, role: AccountRole.READONLY_SIGNER },
      { address: accounts.tokenProgramX, role: AccountRole.READONLY },
      { address: accounts.tokenProgramY, role: AccountRole.READONLY },
      { address: MEMO_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DLMM_PROGRAM, role: AccountRole.READONLY },
      ...accounts.binArrays.map((binArray) => ({
        address: binArray,
        role: AccountRole.WRITABLE,
      })),
    ],
    data: dataEncoder.encode({
      discriminator,
      maximumAmountIn: args.maximumAmountIn,
      amountOut: args.amountOut,
      remainingAccountsSliceCount: 0,
    }),
  };
}
