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

const discriminator = Uint8Array.of(43, 4, 237, 11, 26, 201, 30, 98);
const remainingAccountsSliceEncoder = getStructEncoder([
  ["accountsType", getU8Encoder()],
  ["length", getU8Encoder()],
]);
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

/** Native swap-v2 accounts, without transfer-hook remaining accounts. */
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
/** Raw native swap-v2 arguments; token amounts use atomic units. */
export interface OrcaSwapV2Args {
  /** Input amount when amountSpecifiedIsInput is true, otherwise desired output. */
  readonly amount: bigint;
  /** Minimum output for exact input, maximum input for exact output. */
  readonly otherAmountThreshold: bigint;
  /** Q64.64 boundary. Zero uses the native default and rejects partial exact output. */
  readonly sqrtPriceLimit: bigint;
  readonly amountSpecifiedIsInput: boolean;
  readonly aToB: boolean;
}

/**
 * Build native `swap_v2` with optional supplemental tick-array slice metadata.
 * @remarks Data: [0,8) discriminator; [8,16) amount; [16,24) otherAmountThreshold;
 * [24,40) sqrtPriceLimit; byte 40 input-mode bool; byte 41 direction bool; byte 42
 * option tag. Some appends [43,47) u32 slice count=1, byte 47 type=6, byte 48
 * supplemental count. Integers are little-endian. Caller validates accounts, price
 * limits and execution guarantees; the high-level adapter fixes sqrtPriceLimit=0.
 * @throws Synchronous codec errors for out-of-range native arguments or slice count.
 */
export function getOrcaSwapV2Instruction(
  accounts: OrcaSwapV2Accounts,
  args: OrcaSwapV2Args,
): Instruction {
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
