import { InvalidAccountError, UnsupportedPoolFeatureError } from "../errors";
import { SYSTEM_PROGRAM_ADDRESS as AMM_SYSTEM_PROGRAM } from "@solana-program/system";
import { WRAPPED_SOL_MINT as AMM_QUOTE_MINT } from "../accounts/tokens";
import type { Address } from "@solana/kit";

import { requireAccount } from "../accounts/snapshot";
import type { AccountSnapshot, SnapshotAccount } from "../types";
import {
  readU64,
  readAddress,
  accountDataView,
  matchesDiscriminator,
} from "../accounts/bytes";

import { readPumpFeeSchedule } from "./fees";
import { PUMP_AMM_PROGRAM, PUMP_FEE_PROGRAM as AMM_FEE_PROGRAM } from "./constants";
export { PUMP_AMM_PROGRAM, AMM_FEE_PROGRAM };
export { AMM_SYSTEM_PROGRAM, AMM_QUOTE_MINT };

export interface PumpAmmPool {
  readonly bump: number;
  readonly index: number;
  readonly creator: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly coinCreator: Address;
  readonly virtualQuoteReserves: bigint;
  readonly creatorFeeBps: bigint;
  readonly isHolderReward: boolean;
  readonly protocolFees: bigint;
  readonly creatorFees: bigint;
}

export interface PumpAmmFeeRates {
  readonly lpBps: bigint;
  readonly protocolBps: bigint;
  readonly creatorBps: bigint;
}

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "pump-amm",
    feature,
    message: `Pump AMM ${feature} is not supported by this release`,
  });
}

function discriminator(
  account: SnapshotAccount,
  expected: readonly number[],
  minimumSize: number,
): void {
  if (
    account.data.length < minimumSize ||
    !matchesDiscriminator(account.data, expected)
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid Pump AMM discriminator or account size",
    });
  }
}

/** Decode supported versioned pool prefixes and reject unqualified trading variants explicitly. */
export function readAmmPool(snapshot: AccountSnapshot, pool: Address): PumpAmmPool {
  const account = requireAccount(snapshot, pool, "Pump AMM pool", PUMP_AMM_PROGRAM);
  discriminator(account, [241, 154, 109, 4, 17, 177, 109, 188], 211);
  if (![211, 243, 244, 245, 261, 270, 271, 287, 300].includes(account.data.length)) {
    unsupported("pool-layout");
  }

  if ((account.data[243] ?? 0) !== 0) {
    unsupported("mayhem");
  }

  if ((account.data[244] ?? 0) !== 0) {
    unsupported("cashback");
  }

  if ((account.data[269] ?? 0) > 1 || (account.data[270] ?? 0) > 1) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid Pump AMM pool boolean flag",
    });
  }

  const quoteMint = readAddress(account.data, 75);
  const view = accountDataView(account.data);

  return {
    bump: account.data[8]!,
    index: view.getUint16(9, true),
    creator: readAddress(account.data, 11),
    baseMint: readAddress(account.data, 43),
    quoteMint,
    baseVault: readAddress(account.data, 139),
    quoteVault: readAddress(account.data, 171),
    coinCreator:
      account.data.length >= 243 ? readAddress(account.data, 211) : AMM_SYSTEM_PROGRAM,
    virtualQuoteReserves:
      account.data.length >= 261
        ? readU64(account.data, 245) | (BigInt(view.getBigInt64(253, true)) << 64n)
        : 0n,
    creatorFeeBps: account.data.length >= 270 ? readU64(account.data, 261) : 0n,
    isHolderReward: account.data.length >= 271 && account.data[270] === 1,
    protocolFees: account.data.length >= 287 ? readU64(account.data, 271) : 0n,
    creatorFees: account.data.length >= 287 ? readU64(account.data, 279) : 0n,
  };
}

/** Read the deterministic buyback recipient and directional disable flag from caller state. */
export function readAmmGlobal(
  snapshot: AccountSnapshot,
  global: Address,
): { buybackRecipient: Address; disabled: number; creatorFeeConfigurable: boolean } {
  const account = requireAccount(
    snapshot,
    global,
    "Pump AMM global configuration",
    PUMP_AMM_PROGRAM,
  );
  discriminator(account, [149, 8, 156, 202, 160, 252, 176, 217], 907);
  const buybackRecipient = Array.from({ length: 8 }, (_, index) =>
    readAddress(account.data, 643 + 32 * index),
  ).find((recipient) => recipient !== AMM_SYSTEM_PROGRAM);
  if (buybackRecipient === undefined || readU64(account.data, 899) > 10_000n) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid Pump AMM buyback configuration",
    });
  }

  if ((account.data[940] ?? 0) > 1) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid Pump AMM configurable creator fee flag",
    });
  }

  return {
    buybackRecipient,
    disabled: account.data[56]!,
    creatorFeeConfigurable: account.data.length >= 949 && account.data[940] === 1,
  };
}

/** Inputs that select the native fee schedule and optional per-pool creator override. */
export interface PumpAmmFeeOptions {
  readonly quoteMint?: Address;
  readonly creatorFeeConfigurable?: boolean;
  readonly creatorFeeBps?: bigint;
}

/**
 * Select native SOL, stable, or exotic fees for canonical pools; permissionless pools pay flat fees.
 * @remarks Version length gates are significant: stale bytes after a shortened tier vector in an
 * older account must not be interpreted as a newer schedule. Creator fees retain their category
 * on holder-reward pools; only the eventual payout destination changes.
 */
export function readAmmFees(
  snapshot: AccountSnapshot,
  feeConfig: Address,
  canonical: boolean,
  marketCap: bigint,
  coinCreator: Address,
  options: PumpAmmFeeOptions = {},
): PumpAmmFeeRates {
  const account = requireAccount(
    snapshot,
    feeConfig,
    "Pump AMM fee configuration",
    AMM_FEE_PROGRAM,
  );
  discriminator(account, [143, 52, 146, 187, 219, 123, 76, 155], 2512);
  const rates = readPumpFeeSchedule(
    account,
    canonical,
    marketCap,
    options.quoteMint ?? AMM_QUOTE_MINT,
  );
  const creatorBps =
    coinCreator === AMM_SYSTEM_PROGRAM
      ? 0n
      : options.creatorFeeConfigurable && (options.creatorFeeBps ?? 0n) > 0n
        ? options.creatorFeeBps!
        : rates.creatorBps;
  const result = { ...rates, creatorBps };
  if (result.lpBps + result.protocolBps + result.creatorBps >= 10_000n) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Unsupported Pump AMM total fee rate",
    });
  }

  return result;
}
