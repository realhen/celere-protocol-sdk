import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_PROGRAM } from "@solana-program/system";
import { WRAPPED_SOL_MINT as NATIVE_SOL_MINT } from "../../accounts/tokens.js";
import { getAddressDecoder, type Address } from "@solana/kit";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type { AccountSnapshot, SnapshotAccount } from "../../core/types.js";

import { PUMP_PROGRAM, PUMP_FEE_PROGRAM } from "./constants.js";
export { PUMP_PROGRAM, PUMP_FEE_PROGRAM };
export { SYSTEM_PROGRAM, NATIVE_SOL_MINT };
const addressDecoder = getAddressDecoder();

export interface PumpCurve {
  readonly virtualTokens: bigint;
  readonly virtualSol: bigint;
  readonly realTokens: bigint;
  readonly realSol: bigint;
  readonly creator: Address;
}

export interface PumpFees {
  readonly protocolBps: bigint;
  readonly creatorBps: bigint;
}

function invalid(account: SnapshotAccount, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account.address, message });
}

function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "pump",
    feature,
    message: `Pump ${feature} is not supported by this release`,
  });
}

function validateDiscriminator(
  account: SnapshotAccount,
  discriminator: readonly number[],
  minimumSize: number,
): void {
  if (
    account.data.length < minimumSize ||
    discriminator.some((byte, index) => account.data[index] !== byte)
  ) {
    invalid(account, "Invalid Pump account discriminator or layout");
  }
}

function readU64(account: SnapshotAccount, offset: number): bigint {
  return new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).getBigUint64(offset, true);
}

function readAddress(account: SnapshotAccount, offset: number): Address {
  return addressDecoder.decode(account.data.subarray(offset, offset + 32));
}

/** Decode the supported SOL curve prefix. New trading variants fail closed. */
export function readCurve(snapshot: AccountSnapshot, pool: Address): PumpCurve {
  const account = requireAccount(snapshot, pool, "Pump bonding curve", PUMP_PROGRAM);
  validateDiscriminator(account, [23, 183, 248, 55, 96, 216, 172, 96], 81);
  const lengths = [81, 82, 83, 115, 124, 125, 141, 151, 166];
  if (!lengths.includes(account.data.length)) unsupported("bonding-curve-layout");
  if (account.data[48] !== 0)
    invalid(
      account,
      "Completed Pump curves cannot trade through the bonding curve adapter",
    );
  if ((account.data[81] ?? 0) !== 0 || (account.data[82] ?? 0) !== 0) {
    unsupported("mayhem-or-cashback");
  }
  if (account.data.length >= 115 && readAddress(account, 83) !== SYSTEM_PROGRAM) {
    unsupported("token-quote");
  }
  if (
    (account.data.length >= 123 && readU64(account, 115) !== 0n) ||
    (account.data[124] ?? 0) !== 0
  ) {
    unsupported("configured-creator-fees-or-holder-rewards");
  }
  if (readU64(account, 40) !== 1_000_000_000_000_000n)
    unsupported("nonstandard-token-supply");
  if ((account.data[141] ?? 0) !== 0) unsupported("nested-quote-curve");
  const curve = {
    virtualTokens: readU64(account, 8),
    virtualSol: readU64(account, 16),
    realTokens: readU64(account, 24),
    realSol: readU64(account, 32),
    creator: readAddress(account, 49),
  };
  if (
    curve.virtualTokens === 0n ||
    curve.virtualSol === 0n ||
    curve.realTokens > curve.virtualTokens
  ) {
    invalid(account, "Invalid Pump curve reserves");
  }
  return curve;
}

/** Recipients are selected deterministically from the caller's current global state. */
export function readRecipients(
  snapshot: AccountSnapshot,
  globalAddress: Address,
): { feeRecipient: Address; buybackRecipient: Address } {
  const account = requireAccount(snapshot, globalAddress, "Pump global", PUMP_PROGRAM);
  validateDiscriminator(account, [167, 232, 232, 177, 200, 108, 114, 127], 1005);
  const normalOffsets = [41, 162, 194, 226, 258, 290, 322, 354];
  const buybackOffsets = Array.from({ length: 8 }, (_, index) => 741 + index * 32);
  const choose = (offsets: readonly number[]) =>
    offsets
      .map((offset) => readAddress(account, offset))
      .find((recipient) => recipient !== SYSTEM_PROGRAM);
  const feeRecipient = choose(normalOffsets);
  const buybackRecipient = choose(buybackOffsets);
  if (feeRecipient === undefined || buybackRecipient === undefined)
    invalid(account, "Pump global has no valid fee recipients");
  return { feeRecipient, buybackRecipient };
}

/** Select the SOL fee tier from the supplied fee-program state using integer market cap. */
export function readFees(
  snapshot: AccountSnapshot,
  feeAddress: Address,
  curve: PumpCurve,
): PumpFees {
  const account = requireAccount(
    snapshot,
    feeAddress,
    "Pump fee configuration",
    PUMP_FEE_PROGRAM,
  );
  validateDiscriminator(account, [143, 52, 146, 187, 219, 123, 76, 155], 2512);
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  const count = view.getUint32(65, true);
  if (count === 0 || count > 50 || 69 + count * 40 > account.data.length)
    invalid(account, "Invalid Pump SOL fee tier vector");
  const marketCap = (curve.virtualSol * 1_000_000_000_000_000n) / curve.virtualTokens;
  let selected: PumpFees | undefined;
  let previousThreshold = -1n;
  for (let index = 0; index < count; index++) {
    const offset = 69 + index * 40;
    const threshold = readU64(account, offset) | (readU64(account, offset + 8) << 64n);
    if (threshold <= previousThreshold)
      invalid(account, "Pump fee tiers are not strictly ordered");
    previousThreshold = threshold;
    const fees = {
      protocolBps: readU64(account, offset + 24),
      creatorBps: readU64(account, offset + 32),
    };
    if (fees.protocolBps + fees.creatorBps >= 10_000n)
      invalid(account, "Unsupported Pump fee rate");
    if (index === 0 || marketCap >= threshold) selected = fees;
  }
  if (selected === undefined) invalid(account, "Pump fee schedule is empty");
  return {
    protocolBps: selected.protocolBps,
    creatorBps: curve.creator === SYSTEM_PROGRAM ? 0n : selected.creatorBps,
  };
}
