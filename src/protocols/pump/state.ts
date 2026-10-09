import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_PROGRAM } from "@solana-program/system";
import { WRAPPED_SOL_MINT as NATIVE_SOL_MINT } from "../../accounts/tokens.js";
import { getAddressDecoder, type Address } from "@solana/kit";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type { AccountSnapshot, SnapshotAccount } from "../../core/types.js";

import { PUMP_PROGRAM, PUMP_FEE_PROGRAM } from "./constants.js";
import { readPumpFeeSchedule } from "./fees.js";
export { PUMP_PROGRAM, PUMP_FEE_PROGRAM };
export { SYSTEM_PROGRAM, NATIVE_SOL_MINT };
const addressDecoder = getAddressDecoder();

/** Native incomplete curve state. Legacy Sol-named reserve fields hold atomic units of quoteMint. */
export interface PumpCurve {
  readonly virtualTokens: bigint;
  readonly virtualSol: bigint;
  readonly realTokens: bigint;
  readonly realSol: bigint;
  readonly creator: Address;
  readonly quoteMint: Address;
  readonly creatorFeeBps: bigint;
  readonly creatorFees: bigint;
  readonly protocolFees: bigint;
  readonly holderReward: boolean;
  readonly depth: number;
  readonly postCompleteBaseOut: bigint;
  readonly postCompleteQuoteIn: bigint;
}

/** Effective trade rates in basis points after quote schedule and creator overrides. */
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

/** Decode an incomplete curve, including retained fees and token quote identity. */
export function readCurve(snapshot: AccountSnapshot, pool: Address): PumpCurve {
  const account = requireAccount(snapshot, pool, "Pump bonding curve", PUMP_PROGRAM);
  validateDiscriminator(account, [23, 183, 248, 55, 96, 216, 172, 96], 81);
  const lengths = [81, 82, 83, 115, 124, 125, 141, 151, 166];
  if (!lengths.includes(account.data.length)) unsupported("bonding-curve-layout");
  for (const offset of [48, 81, 82, 123, 124]) {
    if ((account.data[offset] ?? 0) > 1)
      invalid(account, "Invalid Pump curve boolean field");
  }
  if (account.data[48] !== 0)
    invalid(
      account,
      "Completed Pump curves cannot trade through the bonding curve adapter",
    );
  if ((account.data[81] ?? 0) !== 0 || (account.data[82] ?? 0) !== 0) {
    unsupported("mayhem-or-cashback");
  }
  if (readU64(account, 40) !== 1_000_000_000_000_000n)
    unsupported("nonstandard-token-supply");
  const curve = {
    virtualTokens: readU64(account, 8),
    virtualSol: readU64(account, 16),
    realTokens: readU64(account, 24),
    realSol: readU64(account, 32),
    creator: readAddress(account, 49),
    quoteMint:
      account.data.length >= 115 && readAddress(account, 83) !== SYSTEM_PROGRAM
        ? readAddress(account, 83)
        : NATIVE_SOL_MINT,
    creatorFeeBps: account.data.length >= 123 ? readU64(account, 115) : 0n,
    creatorFees: account.data.length >= 133 ? readU64(account, 125) : 0n,
    protocolFees: account.data.length >= 141 ? readU64(account, 133) : 0n,
    holderReward: (account.data[124] ?? 0) === 1,
    depth: account.data[141] ?? 0,
    postCompleteBaseOut: account.data.length >= 158 ? readU64(account, 150) : 0n,
    postCompleteQuoteIn: account.data.length >= 166 ? readU64(account, 158) : 0n,
  };
  if (
    curve.virtualTokens === 0n ||
    curve.virtualSol === 0n ||
    curve.realTokens > curve.virtualTokens
  ) {
    invalid(account, "Invalid Pump curve reserves");
  }
  if (
    curve.creatorFeeBps >= 10_000n ||
    curve.postCompleteBaseOut !== 0n ||
    curve.postCompleteQuoteIn !== 0n
  )
    invalid(account, "Invalid incomplete Pump curve fee or migration state");
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

/** Global controls used by v3 pricing; absent extension fields retain their legacy defaults. */
export interface PumpGlobal {
  readonly migrationFee: bigint;
  readonly creatorFeeConfigurable: boolean;
  readonly buybackBps: bigint;
}

/** Decode the migration charge and creator-rate gate from caller-supplied global state. */
export function readPumpGlobal(
  snapshot: AccountSnapshot,
  globalAddress: Address,
): PumpGlobal {
  const account = requireAccount(snapshot, globalAddress, "Pump global", PUMP_PROGRAM);
  validateDiscriminator(account, [167, 232, 232, 177, 200, 108, 114, 127], 1005);
  if ((account.data[1045] ?? 0) > 1) invalid(account, "Invalid creator fee gate");
  const buybackBps = readU64(account, 997);
  if (buybackBps > 10_000n) invalid(account, "Invalid Pump buyback rate");
  return {
    migrationFee: readU64(account, 146),
    creatorFeeConfigurable: account.data[1045] === 1,
    buybackBps,
  };
}

/** Select native SOL/stable tiers or exotic flat fees, then apply the enabled per-coin creator rate. */
export function readFees(
  snapshot: AccountSnapshot,
  feeAddress: Address,
  curve: PumpCurve,
  global?: PumpGlobal,
): PumpFees {
  const account = requireAccount(
    snapshot,
    feeAddress,
    "Pump fee configuration",
    PUMP_FEE_PROGRAM,
  );
  validateDiscriminator(account, [143, 52, 146, 187, 219, 123, 76, 155], 2512);
  const marketCap = (curve.virtualSol * 1_000_000_000_000_000n) / curve.virtualTokens;
  const selected = readPumpFeeSchedule(account, true, marketCap, curve.quoteMint);
  const creatorBps =
    curve.creator === SYSTEM_PROGRAM
      ? 0n
      : global?.creatorFeeConfigurable && curve.creatorFeeBps !== 0n
        ? curve.creatorFeeBps
        : selected.creatorBps;
  if (selected.protocolBps + creatorBps >= 10_000n)
    invalid(account, "Unsupported Pump fee rate");
  return { protocolBps: selected.protocolBps, creatorBps };
}
