import { InvalidAccountError, UnsupportedPoolFeatureError } from "../errors";
import type { Address } from "@solana/kit";
import {
  accountDataView,
  readAddress,
  readU128,
  matchesDiscriminator,
} from "../accounts/bytes";
import type { TickArrayFacade, WhirlpoolFacade } from "@orca-so/whirlpools-core";

import type { SnapshotAccount } from "../types";

export { WHIRLPOOL_PROGRAM } from "./constants";

const POOL_DISCRIMINATOR = Uint8Array.of(63, 149, 209, 12, 225, 128, 99, 9);
const FIXED_TICK_DISCRIMINATOR = Uint8Array.of(69, 97, 189, 190, 110, 7, 66, 187);
const DYNAMIC_TICK_DISCRIMINATOR = Uint8Array.of(17, 216, 246, 142, 225, 199, 218, 56);

export type Pool = WhirlpoolFacade & {
  whirlpoolsConfig: Address;
  bump: number;
  feeTierIndex: number;
  tokenMintA: Address;
  tokenMintB: Address;
  tokenVaultA: Address;
  tokenVaultB: Address;
};

/** Decode the stable 653-byte Whirlpool layout without accepting unrelated account types. */
export function decodePool(account: SnapshotAccount): Pool {
  if (
    account.data.length !== 653 ||
    !matchesDiscriminator(account.data, POOL_DISCRIMINATOR)
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid Whirlpool layout or discriminator",
    });
  }

  const data = accountDataView(account.data);

  return {
    whirlpoolsConfig: readAddress(account.data, 8),
    bump: account.data[40]!,
    tickSpacing: data.getUint16(41, true),
    feeTierIndex: data.getUint16(43, true),
    feeRate: data.getUint16(45, true),
    protocolFeeRate: data.getUint16(47, true),
    liquidity: readU128(data, 49),
    sqrtPrice: readU128(data, 65),
    tickCurrentIndex: data.getInt32(81, true),
    tokenMintA: readAddress(account.data, 101),
    tokenVaultA: readAddress(account.data, 133),
    feeGrowthGlobalA: readU128(data, 165),
    tokenMintB: readAddress(account.data, 181),
    tokenVaultB: readAddress(account.data, 213),
    feeGrowthGlobalB: readU128(data, 245),
    rewardLastUpdatedTimestamp: data.getBigUint64(261, true),
    rewardInfos: Array.from({ length: 3 }, (_, index) => ({
      emissionsPerSecondX64: readU128(data, 269 + index * 128 + 96),
      growthGlobalX64: readU128(data, 269 + index * 128 + 112),
    })),
  };
}

/** Decode only qualified fixed tick arrays, validating their parent pool and start index. */
export function decodeFixedArray(
  account: SnapshotAccount,
  pool: Address,
  startTickIndex: number,
): TickArrayFacade {
  if (matchesDiscriminator(account.data, DYNAMIC_TICK_DISCRIMINATOR)) {
    throw new UnsupportedPoolFeatureError({
      protocol: "orca-whirlpool",
      feature: "dynamicTickArrays",
      message: "Dynamic Whirlpool tick arrays are not qualified in this release",
    });
  }
  if (
    account.data.length !== 9988 ||
    !matchesDiscriminator(account.data, FIXED_TICK_DISCRIMINATOR)
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid fixed Whirlpool tick-array layout or discriminator",
    });
  }

  const data = accountDataView(account.data);
  if (
    data.getInt32(8, true) !== startTickIndex ||
    readAddress(account.data, 9956) !== pool
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Tick array does not match its pool and derived tick range",
    });
  }

  return {
    startTickIndex,
    ticks: Array.from({ length: 88 }, (_, index) => {
      const offset = 12 + index * 113;
      if (account.data[offset]! > 1) {
        throw new InvalidAccountError({
          address: account.address,
          message: "Invalid tick initialization flag",
        });
      }

      // Interpret the stored u128 bits as the native signed liquidity delta.
      const net = readU128(data, offset + 1);

      return {
        initialized: account.data[offset] === 1,
        liquidityNet: net >= 1n << 127n ? net - (1n << 128n) : net,
        liquidityGross: readU128(data, offset + 17),
        feeGrowthOutsideA: readU128(data, offset + 33),
        feeGrowthOutsideB: readU128(data, offset + 49),
        rewardGrowthsOutside: [
          readU128(data, offset + 65),
          readU128(data, offset + 81),
          readU128(data, offset + 97),
        ],
      };
    }),
  };
}
