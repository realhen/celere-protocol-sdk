import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { PUMP_AMM_PROGRAM, PUMP_FEE_PROGRAM } from "./constants";
import { getPumpPoolAuthorityAddress } from "./pda";

const addressEncoder = getAddressEncoder();

/** Inputs encoded by PumpSwap's pool seeds. Base and quote order is significant. */
export interface PumpAmmPoolSeeds {
  /** Pool index from creation/state, an unsigned 16-bit integer. Canonical pools use zero. */
  readonly index: number;
  /** Pool creator authority, which may differ from the coin creator receiving fees. */
  readonly creator: Address;
  /** Pool's base token mint. Do not sort the mint pair. */
  readonly baseMint: Address;
  /** Pool's actual quote mint, including WSOL for SOL pairs. */
  readonly quoteMint: Address;
}

/**
 * Derive a PumpSwap pool and its bump without fetching state or creating accounts.
 * @throws RangeError when index is not an integer in 0..65535.
 * @returns The address and bump for this exact creator, index, and ordered mint pair.
 */
export function findPumpAmmPoolPda(
  seeds: PumpAmmPoolSeeds,
): Promise<ProgramDerivedAddress> {
  if (!Number.isInteger(seeds.index) || seeds.index < 0 || seeds.index > 65535)
    throw new RangeError("PumpSwap pool index must be an integer in 0..65535");
  const index = new Uint8Array(2);
  new DataView(index.buffer).setUint16(0, seeds.index, true);
  return getProgramDerivedAddress({
    programAddress: PUMP_AMM_PROGRAM,
    seeds: [
      "pool",
      index,
      ...[seeds.creator, seeds.baseMint, seeds.quoteMint].map((value) =>
        addressEncoder.encode(value),
      ),
    ],
  });
}

/** Derive a PumpSwap pool address locally; see {@link findPumpAmmPoolPda} for input constraints. */
export async function getPumpAmmPoolAddress(seeds: PumpAmmPoolSeeds): Promise<Address> {
  return (await findPumpAmmPoolPda(seeds))[0];
}

/**
 * Derive the canonical index-zero PumpSwap pool created by Pump for this token.
 * @param baseMint - Pump token mint.
 * @param quoteMint - Actual quote mint (use WSOL for a SOL-quoted pool).
 * @remarks Performs no RPC calls and does not establish that migration has occurred.
 */
export async function getPumpAmmCanonicalPoolAddress(
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  return getPumpAmmPoolAddress({
    index: 0,
    creator: await getPumpPoolAuthorityAddress(baseMint),
    baseMint,
    quoteMint,
  });
}

/** Get PumpSwap's global configuration address without fetching it. */
export async function getPumpAmmGlobalAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: PUMP_AMM_PROGRAM,
      seeds: ["global_config"],
    })
  )[0];
}

/** Get PumpSwap's configuration in the shared Pump fee program, without fetching it. */
export async function getPumpAmmFeeConfigAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: PUMP_FEE_PROGRAM,
      seeds: ["fee_config", addressEncoder.encode(PUMP_AMM_PROGRAM)],
    })
  )[0];
}

/** Get PumpSwap's Anchor event authority locally. */
export async function getPumpAmmEventAuthorityAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: PUMP_AMM_PROGRAM,
      seeds: ["__event_authority"],
    })
  )[0];
}

/** Get a wallet's PumpSwap volume accumulator without fetching or initializing it. */
export async function getPumpAmmUserVolumeAccumulatorAddress(
  owner: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: PUMP_AMM_PROGRAM,
      seeds: ["user_volume_accumulator", addressEncoder.encode(owner)],
    })
  )[0];
}
