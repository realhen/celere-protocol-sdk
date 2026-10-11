import { associatedTokenAddress, TOKEN_PROGRAM } from "../../accounts/tokens";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { MOONSHOT_PROGRAM } from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the token curve for the deployed moonshot program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findMoonshotCurvePda(mint: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MOONSHOT_PROGRAM,
    seeds: ["token", encoder.encode(mint)],
  });
}

/** Get the token curve offline; inputs match {@link findMoonshotCurvePda}. Does not check existence. */
export async function getMoonshotCurveAddress(mint: Address): Promise<Address> {
  return (await findMoonshotCurvePda(mint))[0];
}

/**
 * Derive the global configuration for the deployed moonshot program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findMoonshotConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MOONSHOT_PROGRAM,
    seeds: ["config_account"],
  });
}

/** Get the global configuration offline; inputs match {@link findMoonshotConfigPda}. Does not check existence. */
export async function getMoonshotConfigAddress(): Promise<Address> {
  return (await findMoonshotConfigPda())[0];
}

/** Get curve/configuration addresses and bumps for a base mint offline; accounts may not exist. */
export async function getMoonshotCurveAddresses(mint: Address) {
  const [curve, config] = await Promise.all([
    findMoonshotCurvePda(mint),
    findMoonshotConfigPda(),
  ]);

  return {
    curve: curve[0],
    curveBump: curve[1],
    config: config[0],
    configBump: config[1],
  };
}

/**
 * Get the Moonshot curve token vault offline, without checking existence.
 * @param curve - Native account that owns the token vault.
 * @param mint - Mint held by the vault.
 */
export function getMoonshotTokenVaultAddress(
  curve: Address,
  mint: Address,
): Promise<Address> {
  return associatedTokenAddress(curve, mint, TOKEN_PROGRAM);
}

/**
 * Get the canonical SPL-token account required for Moonshot sells, offline; it may not exist.
 * @param owner - Trading wallet authority.
 * @param mint - Moonshot token mint.
 */
export function getMoonshotUserTokenAddress(
  owner: Address,
  mint: Address,
): Promise<Address> {
  return associatedTokenAddress(owner, mint, TOKEN_PROGRAM);
}
