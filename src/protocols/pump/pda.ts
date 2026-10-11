import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { PUMP_FEE_PROGRAM, PUMP_PROGRAM } from "./constants";

const addressEncoder = getAddressEncoder();
const utf8 = new TextEncoder();

/** Derive a Pump account without fetching or creating it. */
async function derive(
  programAddress: Address,
  seed: string,
  ...addresses: readonly Address[]
): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8.encode(seed), ...addresses.map((value) => addressEncoder.encode(value))],
  });
  return address;
}

/**
 * Get the bonding curve address for a Pump token mint, without RPC calls.
 * @param mint - The token's base mint, not its SOL or token quote mint.
 * @returns The curve address. Derivation does not establish that it exists or is still trading.
 * @example
 * ```ts
 * const pool = await getPumpBondingCurveAddress(outputMint);
 * ```
 */
export function getPumpBondingCurveAddress(mint: Address): Promise<Address> {
  return derive(PUMP_PROGRAM, "bonding-curve", mint);
}

/** Get the auxiliary v2 curve address used by Pump's legacy trade instructions; performs no RPC calls. */
export function getPumpBondingCurveV2Address(mint: Address): Promise<Address> {
  return derive(PUMP_PROGRAM, "bonding-curve-v2", mint);
}

/** Get Pump's global configuration address without fetching the account. */
export function getPumpGlobalAddress(): Promise<Address> {
  return derive(PUMP_PROGRAM, "global");
}

/** Get Pump's fee configuration in the Pump fee program, without fetching it. */
export function getPumpFeeConfigAddress(): Promise<Address> {
  return derive(PUMP_FEE_PROGRAM, "fee_config", PUMP_PROGRAM);
}

/** Get the Pump bonding curve program's Anchor event authority without RPC calls. */
export function getPumpEventAuthorityAddress(): Promise<Address> {
  return derive(PUMP_PROGRAM, "__event_authority");
}

/** Get the creator fee vault for a creator authority, not a token mint; performs no RPC calls. */
export function getPumpCreatorVaultAddress(creator: Address): Promise<Address> {
  return derive(PUMP_PROGRAM, "creator-vault", creator);
}

/** Get the Pump bonding curve program's global volume accumulator without fetching it. */
export function getPumpGlobalVolumeAccumulatorAddress(): Promise<Address> {
  return derive(PUMP_PROGRAM, "global_volume_accumulator");
}

/** Get a wallet's Pump bonding curve volume accumulator without fetching or initializing it. */
export function getPumpUserVolumeAccumulatorAddress(owner: Address): Promise<Address> {
  return derive(PUMP_PROGRAM, "user_volume_accumulator", owner);
}
