import { associatedTokenAddress, TOKEN_PROGRAM } from "../accounts/tokens";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { HEAVEN_PROGRAM } from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the liquidity pool for the deployed heaven program, entirely offline.
 * @param baseMint - Base mint in native protocol order; no sorting is performed.
 * @param quoteMint - Quote mint in native protocol order; no sorting is performed.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findHeavenPoolPda(
  baseMint: Address,
  quoteMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: HEAVEN_PROGRAM,
    seeds: ["liquidity_pool_state", encoder.encode(baseMint), encoder.encode(quoteMint)],
  });
}

/** Get the liquidity pool offline; inputs match {@link findHeavenPoolPda}. Does not check existence. */
export async function getHeavenPoolAddress(
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  return (await findHeavenPoolPda(baseMint, quoteMint))[0];
}

/**
 * Derive Heaven's supported version 1 or 2 configuration offline.
 * @param version - Native u16 configuration version, encoded big-endian; only 1 and 2 are supported.
 * @returns Address and canonical bump, without checking existence.
 * @throws RangeError for unsupported versions or nonintegral values.
 */
export async function findHeavenProtocolConfigPda(
  version: 1 | 2,
): Promise<ProgramDerivedAddress> {
  if (!Number.isSafeInteger(version) || (version !== 1 && version !== 2)) {
    throw new RangeError("Heaven configuration version must be 1 or 2");
  }

  return getProgramDerivedAddress({
    programAddress: HEAVEN_PROGRAM,
    seeds: ["protocol_config_state", Uint8Array.of(version >> 8, version & 255)],
  });
}

/** Get Heaven's version 1 or 2 configuration offline; does not check existence. */
export async function getHeavenProtocolConfigAddress(version: 1 | 2): Promise<Address> {
  return (await findHeavenProtocolConfigPda(version))[0];
}

/**
 * Get the Heaven configuration-owned token vault offline, without checking existence.
 * @param config - Native account that owns the token vault.
 * @param mint - Mint held by the vault.
 */
export function getHeavenTokenVaultAddress(
  config: Address,
  mint: Address,
): Promise<Address> {
  return associatedTokenAddress(config, mint, TOKEN_PROGRAM);
}
