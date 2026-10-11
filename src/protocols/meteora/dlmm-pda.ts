/** Offline DLMM derivations adapted from the ISC SDK; see NOTICE.md. */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { METEORA_DLMM_PROGRAM } from "./constants";
const encoder = getAddressEncoder();

/** Seed parameters for the supported permissionless legacy DLMM pool addressing. */
export interface MeteoraDlmmPoolAddressParams {
  /** Token X in native pool order; the helper does not reorder the mints. */
  readonly mintX: Address;
  /** Token Y in native pool order. */
  readonly mintY: Address;
  /** Unsigned 16-bit bin step in basis points, encoded little-endian. */
  readonly binStep: number;
  /** Optional unsigned 16-bit base-factor seed, encoded little-endian; omit for the original addressing variant. */
  readonly baseFactor?: number;
}
function u16(value: number, field: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535)
    throw new RangeError(`${field} must be an unsigned 16-bit integer`);
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}
/** Derive a legacy permissionless DLMM pool and bump. Optional baseFactor selects the base-factor-seeded legacy variant, not v2/customizable/permissioned addressing. Does not fetch or create accounts. Rejects out-of-range numeric seeds. */
export function findMeteoraDlmmPoolPda(
  params: MeteoraDlmmPoolAddressParams,
): Promise<ProgramDerivedAddress> {
  const seeds = [
    encoder.encode(params.mintX),
    encoder.encode(params.mintY),
    u16(params.binStep, "binStep"),
  ];
  if (params.baseFactor !== undefined) seeds.push(u16(params.baseFactor, "baseFactor"));
  return getProgramDerivedAddress({ programAddress: METEORA_DLMM_PROGRAM, seeds });
}
/** Derive a supported legacy DLMM pool, without fetching or creating it. Uses native mint order and rejects invalid u16 seeds; see {@link MeteoraDlmmPoolAddressParams}. */
export async function getMeteoraDlmmPoolAddress(
  params: MeteoraDlmmPoolAddressParams,
): Promise<Address> {
  return (await findMeteoraDlmmPoolPda(params))[0];
}
/** Derive a DLMM reserve token account for a pool and underlying mint, without fetching or creating it. */
export async function getMeteoraDlmmReserveAddress(
  pool: Address,
  mint: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DLMM_PROGRAM,
      seeds: [encoder.encode(pool), encoder.encode(mint)],
    })
  )[0];
}
/** Derive a DLMM pool's oracle, without fetching or creating it. */
export async function getMeteoraDlmmOracleAddress(pool: Address): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DLMM_PROGRAM,
      seeds: ["oracle", encoder.encode(pool)],
    })
  )[0];
}
/** Derive a DLMM pool's optional bitmap extension, without fetching it or asserting that it exists. */
export async function getMeteoraDlmmBitmapExtensionAddress(
  pool: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DLMM_PROGRAM,
      seeds: ["bitmap", encoder.encode(pool)],
    })
  )[0];
}
/** Derive a DLMM bin array without fetching or creating it. index is the signed array index (floor(binId / 70)), encoded as i64 little-endian, not an individual bin ID. Rejects values outside i64. */
export async function getMeteoraDlmmBinArrayAddress(
  pool: Address,
  index: bigint,
): Promise<Address> {
  if (typeof index !== "bigint" || index < -(1n << 63n) || index >= 1n << 63n)
    throw new RangeError("index must be a signed 64-bit bigint");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, index, true);
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DLMM_PROGRAM,
      seeds: ["bin_array", encoder.encode(pool), bytes],
    })
  )[0];
}
/** Derive the DLMM program's singleton Anchor event authority, without fetching or creating it. */
export async function getMeteoraDlmmEventAuthorityAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DLMM_PROGRAM,
      seeds: ["__event_authority"],
    })
  )[0];
}
