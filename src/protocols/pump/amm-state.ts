import { SYSTEM_PROGRAM_ADDRESS as AMM_SYSTEM_PROGRAM } from "@solana-program/system";
import { WRAPPED_SOL_MINT as AMM_QUOTE_MINT } from "../../accounts/tokens.js";
import { getAddressDecoder, type Address } from "@solana/kit";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type { AccountSnapshot, SnapshotAccount } from "../../core/types.js";

import { readPumpFeeSchedule } from "./fees.js";
import { PUMP_AMM_PROGRAM, PUMP_FEE_PROGRAM as AMM_FEE_PROGRAM } from "./constants.js";
export { PUMP_AMM_PROGRAM, AMM_FEE_PROGRAM };
export { AMM_SYSTEM_PROGRAM, AMM_QUOTE_MINT };
const decoder = getAddressDecoder();

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

function invalid(account: SnapshotAccount, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account.address, message });
}

function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "pump-amm",
    feature,
    message: `Pump AMM ${feature} is not supported by this release`,
  });
}

function readAddress(account: SnapshotAccount, offset: number): Address {
  return decoder.decode(account.data.subarray(offset, offset + 32));
}

function readU64(account: SnapshotAccount, offset: number): bigint {
  return new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).getBigUint64(offset, true);
}

function discriminator(
  account: SnapshotAccount,
  expected: readonly number[],
  minimumSize: number,
): void {
  if (
    account.data.length < minimumSize ||
    expected.some((byte, index) => account.data[index] !== byte)
  )
    invalid(account, "Invalid Pump AMM discriminator or account size");
}

/** Decode supported versioned pool prefixes and reject unqualified trading variants explicitly. */
export function readAmmPool(snapshot: AccountSnapshot, pool: Address): PumpAmmPool {
  const account = requireAccount(snapshot, pool, "Pump AMM pool", PUMP_AMM_PROGRAM);
  discriminator(account, [241, 154, 109, 4, 17, 177, 109, 188], 211);
  if (![211, 243, 244, 245, 261, 270, 271, 287, 300].includes(account.data.length))
    unsupported("pool-layout");
  if ((account.data[243] ?? 0) !== 0) unsupported("mayhem");
  if ((account.data[244] ?? 0) !== 0) unsupported("cashback");
  if ((account.data[269] ?? 0) > 1 || (account.data[270] ?? 0) > 1)
    invalid(account, "Invalid Pump AMM pool boolean flag");
  const quoteMint = readAddress(account, 75);
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  return {
    bump: account.data[8]!,
    index: view.getUint16(9, true),
    creator: readAddress(account, 11),
    baseMint: readAddress(account, 43),
    quoteMint,
    baseVault: readAddress(account, 139),
    quoteVault: readAddress(account, 171),
    coinCreator:
      account.data.length >= 243 ? readAddress(account, 211) : AMM_SYSTEM_PROGRAM,
    virtualQuoteReserves:
      account.data.length >= 261
        ? readU64(account, 245) | (BigInt(view.getBigInt64(253, true)) << 64n)
        : 0n,
    creatorFeeBps: account.data.length >= 270 ? readU64(account, 261) : 0n,
    isHolderReward: account.data.length >= 271 && account.data[270] === 1,
    protocolFees: account.data.length >= 287 ? readU64(account, 271) : 0n,
    creatorFees: account.data.length >= 287 ? readU64(account, 279) : 0n,
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
    readAddress(account, 643 + 32 * index),
  ).find((recipient) => recipient !== AMM_SYSTEM_PROGRAM);
  if (buybackRecipient === undefined || readU64(account, 899) > 10_000n)
    invalid(account, "Invalid Pump AMM buyback configuration");
  if ((account.data[940] ?? 0) > 1)
    invalid(account, "Invalid Pump AMM configurable creator fee flag");
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
  if (result.lpBps + result.protocolBps + result.creatorBps >= 10_000n)
    invalid(account, "Unsupported Pump AMM total fee rate");
  return result;
}
