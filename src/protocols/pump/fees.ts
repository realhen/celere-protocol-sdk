import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { address, type Address } from "@solana/kit";
import { WRAPPED_SOL_MINT, TOKEN_2022_NATIVE_MINT } from "../../accounts/tokens.js";
import { fail } from "../../core/errors.js";
import type { SnapshotAccount } from "../../core/types.js";
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** Native fee schedule rates in basis points before creator overrides and route assignment. */
export interface PumpFeeRates {
  readonly lpBps: bigint;
  readonly protocolBps: bigint;
  readonly creatorBps: bigint;
}
function invalid(account: SnapshotAccount, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account.address, message });
}
function readU64(account: SnapshotAccount, offset: number): bigint {
  return new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).getBigUint64(offset, true);
}
/**
 * Decode the versioned Pump Fees schedule shared by curves and pools.
 * @remarks Account ownership, PDA and discriminator are checked by the caller. Newer fields
 * are gated by allocated account length, then read after the actual variable-length vectors.
 */
export function readPumpFeeSchedule(
  account: SnapshotAccount,
  canonical: boolean,
  marketCap: bigint,
  quoteMint: Address,
): PumpFeeRates {
  if (account.data.length < 2512) invalid(account, "Truncated Pump fee configuration");
  const readRates = (offset: number): PumpFeeRates => {
    if (offset + 24 > account.data.length)
      invalid(account, "Truncated Pump fee schedule");
    return {
      lpBps: readU64(account, offset),
      protocolBps: readU64(account, offset + 8),
      creatorBps: readU64(account, offset + 16),
    };
  };
  const readTiers = (offset: number) => {
    if (offset + 4 > account.data.length)
      invalid(account, "Truncated Pump fee tier vector");
    const count = new DataView(
      account.data.buffer,
      account.data.byteOffset,
      account.data.byteLength,
    ).getUint32(offset, true);
    if (count > 50 || offset + 4 + count * 40 > account.data.length)
      invalid(account, "Invalid Pump fee tier vector");
    let previous = -1n;
    let selected: PumpFeeRates | undefined;
    for (let index = 0; index < count; index++) {
      const start = offset + 4 + index * 40;
      const threshold = readU64(account, start) | (readU64(account, start + 8) << 64n);
      if (threshold <= previous)
        invalid(account, "Pump fee tiers must be strictly ordered");
      previous = threshold;
      if (index === 0 || threshold <= marketCap) selected = readRates(start + 16);
    }
    return { end: offset + 4 + count * 40, selected };
  };
  const flat = readRates(41);
  const solTiers = readTiers(65);
  const stableTiers = account.data.length >= 4073 ? readTiers(solTiers.end) : undefined;
  const exotic = account.data.length >= 4097 ? readRates(stableTiers!.end) : undefined;
  let rates = flat;
  if (canonical) {
    if (
      quoteMint === WRAPPED_SOL_MINT ||
      quoteMint === TOKEN_2022_NATIVE_MINT ||
      quoteMint === SYSTEM_PROGRAM_ADDRESS
    ) {
      if (!solTiers.selected) invalid(account, "Missing Pump SOL fee tiers");
      rates = solTiers.selected;
    } else if (quoteMint === USDC_MINT) {
      const selected = stableTiers?.selected;
      if (!selected) invalid(account, "Missing Pump stable fee tiers");
      rates = selected;
    } else if (exotic && exotic.lpBps + exotic.protocolBps + exotic.creatorBps > 0n) {
      rates = exotic;
    }
  }
  return rates;
}
