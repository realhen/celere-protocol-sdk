/** Offline native Whirlpool address derivations; see NOTICE.md for Orca attribution. */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { WHIRLPOOL_PROGRAM } from "./constants";
const encoder = getAddressEncoder();

/** Public seed inputs for a native Whirlpool address; no decoded pool state is required. */
export interface OrcaWhirlpoolAddressParams {
  /** Whirlpool configuration account. */
  readonly whirlpoolsConfig: Address;
  /** Token A in native mint order; the helper does not sort the pair. */
  readonly tokenMintA: Address;
  /** Token B in native mint order. */
  readonly tokenMintB: Address;
  /** Unsigned 16-bit fee-tier seed, encoded little-endian. For the adapter's supported static-fee pools this equals tick spacing; derivation does not qualify adaptive-fee execution. */
  readonly feeTierIndex: number;
}
/** Derive a Whirlpool and bump without fetching or creating it. Rejects a noninteger or out-of-range u16 feeTierIndex; uses the caller's native mint order. */
export function findOrcaWhirlpoolPda(
  params: OrcaWhirlpoolAddressParams,
): Promise<ProgramDerivedAddress> {
  if (
    !Number.isSafeInteger(params.feeTierIndex) ||
    params.feeTierIndex < 0 ||
    params.feeTierIndex > 65535
  )
    throw new RangeError("feeTierIndex must be an unsigned 16-bit integer");
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, params.feeTierIndex, true);
  return getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM,
    seeds: [
      "whirlpool",
      encoder.encode(params.whirlpoolsConfig),
      encoder.encode(params.tokenMintA),
      encoder.encode(params.tokenMintB),
      bytes,
    ],
  });
}
/** Derive a Whirlpool from native mint order and a u16 fee-tier seed without fetching or creating it; see {@link OrcaWhirlpoolAddressParams}. */
export async function getOrcaWhirlpoolAddress(
  params: OrcaWhirlpoolAddressParams,
): Promise<Address> {
  return (await findOrcaWhirlpoolPda(params))[0];
}
/** Derive a Whirlpool tick array without fetching or creating it. startTickIndex is the signed i32 first tick index, encoded as decimal text (not binary); caller computes alignment to 88 * tick spacing. Rejects noninteger/out-of-range indexes. Does not qualify dynamic tick-array execution. */
export async function getOrcaTickArrayAddress(
  pool: Address,
  startTickIndex: number,
): Promise<Address> {
  if (
    !Number.isSafeInteger(startTickIndex) ||
    startTickIndex < -2147483648 ||
    startTickIndex > 2147483647
  )
    throw new RangeError("startTickIndex must be a signed 32-bit integer");
  return (
    await getProgramDerivedAddress({
      programAddress: WHIRLPOOL_PROGRAM,
      seeds: ["tick_array", encoder.encode(pool), String(startTickIndex)],
    })
  )[0];
}
/** Derive a Whirlpool's oracle without fetching it, creating it, or asserting its existence. */
export async function getOrcaOracleAddress(pool: Address): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: WHIRLPOOL_PROGRAM,
      seeds: ["oracle", encoder.encode(pool)],
    })
  )[0];
}
