import { SYSTEM_PROGRAM_ADDRESS as AMM_SYSTEM_PROGRAM } from "@solana-program/system";
import { WRAPPED_SOL_MINT as AMM_QUOTE_MINT } from "../../accounts/tokens.js";
import { getAddressDecoder, type Address } from "@solana/kit";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type { AccountSnapshot, SnapshotAccount } from "../../core/types.js";

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
  if (account.data.length >= 270 && readU64(account, 261) !== 0n)
    unsupported("configured-creator-fee");
  if ((account.data[270] ?? 0) !== 0) unsupported("holder-rewards");
  const quoteMint = readAddress(account, 75);
  if (quoteMint !== AMM_QUOTE_MINT) unsupported("non-WSOL-quote");
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
    protocolFees: account.data.length >= 287 ? readU64(account, 271) : 0n,
    creatorFees: account.data.length >= 287 ? readU64(account, 279) : 0n,
  };
}

/** Read the deterministic buyback recipient and directional disable flag from caller state. */
export function readAmmGlobal(
  snapshot: AccountSnapshot,
  global: Address,
): { buybackRecipient: Address; disabled: number } {
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
  return { buybackRecipient, disabled: account.data[56]! };
}

/** Canonical SOL pools pay market-cap tiers; other pools pay the fee program's flat schedule. */
export function readAmmFees(
  snapshot: AccountSnapshot,
  feeConfig: Address,
  canonical: boolean,
  marketCap: bigint,
  coinCreator: Address,
): PumpAmmFeeRates {
  const account = requireAccount(
    snapshot,
    feeConfig,
    "Pump AMM fee configuration",
    AMM_FEE_PROGRAM,
  );
  discriminator(account, [143, 52, 146, 187, 219, 123, 76, 155], 2512);
  const readRates = (offset: number): PumpAmmFeeRates => ({
    lpBps: readU64(account, offset),
    protocolBps: readU64(account, offset + 8),
    creatorBps: coinCreator === AMM_SYSTEM_PROGRAM ? 0n : readU64(account, offset + 16),
  });
  let rates = readRates(41);
  if (canonical) {
    const count = new DataView(
      account.data.buffer,
      account.data.byteOffset,
      account.data.byteLength,
    ).getUint32(65, true);
    if (count === 0 || count > 50 || 69 + count * 40 > account.data.length)
      invalid(account, "Invalid Pump AMM fee tier vector");
    let previous = -1n;
    for (let index = 0; index < count; index++) {
      const offset = 69 + index * 40;
      const threshold = readU64(account, offset) | (readU64(account, offset + 8) << 64n);
      if (threshold <= previous)
        invalid(account, "Pump AMM fee tiers must be strictly ordered");
      previous = threshold;
      if (index === 0 || threshold <= marketCap) rates = readRates(offset + 16);
    }
  }
  if (rates.lpBps + rates.protocolBps + rates.creatorBps >= 10_000n)
    invalid(account, "Unsupported Pump AMM total fee rate");
  return rates;
}
