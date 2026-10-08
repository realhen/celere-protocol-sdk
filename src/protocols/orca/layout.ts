import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import type { TickArrayFacade, WhirlpoolFacade } from "@orca-so/whirlpools-core";
import { fail } from "../../core/errors.js";
import type { SnapshotAccount } from "../../core/types.js";

import { WHIRLPOOL_PROGRAM } from "./constants.js";
export { WHIRLPOOL_PROGRAM } from "./constants.js";
const POOL_DISCRIMINATOR = Uint8Array.of(63, 149, 209, 12, 225, 128, 99, 9);
const FIXED_TICK_DISCRIMINATOR = Uint8Array.of(69, 97, 189, 190, 110, 7, 66, 187);
const DYNAMIC_TICK_DISCRIMINATOR = Uint8Array.of(17, 216, 246, 142, 225, 199, 218, 56);
const decodeAddress = getAddressDecoder();
const encodeAddress = getAddressEncoder();

export type Pool = WhirlpoolFacade & {
  whirlpoolsConfig: Address;
  bump: number;
  feeTierIndex: number;
  tokenMintA: Address;
  tokenMintB: Address;
  tokenVaultA: Address;
  tokenVaultB: Address;
};

function invalid(account: SnapshotAccount, message: string): never {
  return fail({ code: "INVALID_ACCOUNT", address: account.address, message });
}
function matches(data: Uint8Array, discriminator: Uint8Array): boolean {
  return discriminator.every((byte, index) => data[index] === byte);
}
function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
function u128(data: DataView, offset: number): bigint {
  return data.getBigUint64(offset, true) | (data.getBigUint64(offset + 8, true) << 64n);
}
function pubkey(data: Uint8Array, offset: number): Address {
  return decodeAddress.decode(data.subarray(offset, offset + 32));
}

/** Decode the stable 653-byte Whirlpool layout without accepting unrelated account types. */
export function decodePool(account: SnapshotAccount): Pool {
  if (account.data.length !== 653 || !matches(account.data, POOL_DISCRIMINATOR))
    invalid(account, "Invalid Whirlpool layout or discriminator");
  const data = view(account.data);
  return {
    whirlpoolsConfig: pubkey(account.data, 8),
    bump: account.data[40]!,
    tickSpacing: data.getUint16(41, true),
    feeTierIndex: data.getUint16(43, true),
    feeRate: data.getUint16(45, true),
    protocolFeeRate: data.getUint16(47, true),
    liquidity: u128(data, 49),
    sqrtPrice: u128(data, 65),
    tickCurrentIndex: data.getInt32(81, true),
    tokenMintA: pubkey(account.data, 101),
    tokenVaultA: pubkey(account.data, 133),
    feeGrowthGlobalA: u128(data, 165),
    tokenMintB: pubkey(account.data, 181),
    tokenVaultB: pubkey(account.data, 213),
    feeGrowthGlobalB: u128(data, 245),
    rewardLastUpdatedTimestamp: data.getBigUint64(261, true),
    rewardInfos: Array.from({ length: 3 }, (_, index) => ({
      emissionsPerSecondX64: u128(data, 269 + index * 128 + 96),
      growthGlobalX64: u128(data, 269 + index * 128 + 112),
    })),
  };
}

/** Decode only qualified fixed tick arrays, validating their parent pool and start index. */
export function decodeFixedArray(
  account: SnapshotAccount,
  pool: Address,
  startTickIndex: number,
): TickArrayFacade {
  if (matches(account.data, DYNAMIC_TICK_DISCRIMINATOR))
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "orca-whirlpool",
      feature: "dynamicTickArrays",
      message: "Dynamic Whirlpool tick arrays are not qualified in this release",
    });
  if (account.data.length !== 9988 || !matches(account.data, FIXED_TICK_DISCRIMINATOR))
    invalid(account, "Invalid fixed Whirlpool tick-array layout or discriminator");
  const data = view(account.data);
  if (data.getInt32(8, true) !== startTickIndex || pubkey(account.data, 9956) !== pool)
    invalid(account, "Tick array does not match its pool and derived tick range");
  return {
    startTickIndex,
    ticks: Array.from({ length: 88 }, (_, index) => {
      const offset = 12 + index * 113;
      if (account.data[offset]! > 1) invalid(account, "Invalid tick initialization flag");
      const net = u128(data, offset + 1);
      return {
        initialized: account.data[offset] === 1,
        liquidityNet: net >= 1n << 127n ? net - (1n << 128n) : net,
        liquidityGross: u128(data, offset + 17),
        feeGrowthOutsideA: u128(data, offset + 33),
        feeGrowthOutsideB: u128(data, offset + 49),
        rewardGrowthsOutside: [
          u128(data, offset + 65),
          u128(data, offset + 81),
          u128(data, offset + 97),
        ],
      };
    }),
  };
}

/** Derive native protocol addresses locally; no data source is consulted. */
export function poolAddress(pool: Pool) {
  return getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM,
    seeds: [
      "whirlpool",
      encodeAddress.encode(pool.whirlpoolsConfig),
      encodeAddress.encode(pool.tokenMintA),
      encodeAddress.encode(pool.tokenMintB),
      Uint8Array.of(pool.feeTierIndex & 255, pool.feeTierIndex >> 8),
    ],
  });
}
export function tickArrayAddress(pool: Address, startTickIndex: number) {
  return getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM,
    seeds: ["tick_array", encodeAddress.encode(pool), String(startTickIndex)],
  });
}
export function oracleAddress(pool: Address) {
  return getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM,
    seeds: ["oracle", encodeAddress.encode(pool)],
  });
}
