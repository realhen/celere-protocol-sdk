import { associatedTokenAddress, TOKEN_PROGRAM } from "../accounts/tokens";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { BOOP_PROGRAM } from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the bonding curve for the deployed boop program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopBondingCurvePda(mint: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: BOOP_PROGRAM,
    seeds: ["bonding_curve", encoder.encode(mint)],
  });
}

/** Get the bonding curve offline; inputs match {@link findBoopBondingCurvePda}. Does not check existence. */
export async function getBoopBondingCurveAddress(mint: Address): Promise<Address> {
  return (await findBoopBondingCurvePda(mint))[0];
}

/**
 * Derive the global configuration for the deployed boop program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({ programAddress: BOOP_PROGRAM, seeds: ["config"] });
}

/** Get the global configuration offline; inputs match {@link findBoopConfigPda}. Does not check existence. */
export async function getBoopConfigAddress(): Promise<Address> {
  return (await findBoopConfigPda())[0];
}

/**
 * Derive the curve token vault for the deployed boop program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopBondingCurveVaultPda(
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: BOOP_PROGRAM,
    seeds: ["bonding_curve_vault", encoder.encode(mint)],
  });
}

/** Get the curve token vault offline; inputs match {@link findBoopBondingCurveVaultPda}. Does not check existence. */
export async function getBoopBondingCurveVaultAddress(mint: Address): Promise<Address> {
  return (await findBoopBondingCurveVaultPda(mint))[0];
}

/**
 * Derive the curve native SOL vault for the deployed boop program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopBondingCurveSolVaultPda(
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: BOOP_PROGRAM,
    seeds: ["bonding_curve_sol_vault", encoder.encode(mint)],
  });
}

/** Get the curve native SOL vault offline; inputs match {@link findBoopBondingCurveSolVaultPda}. Does not check existence. */
export async function getBoopBondingCurveSolVaultAddress(
  mint: Address,
): Promise<Address> {
  return (await findBoopBondingCurveSolVaultPda(mint))[0];
}

/**
 * Derive the WSOL fee vault for the deployed boop program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopTradingFeesVaultPda(
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: BOOP_PROGRAM,
    seeds: ["trading_fees_vault", encoder.encode(mint)],
  });
}

/** Get the WSOL fee vault offline; inputs match {@link findBoopTradingFeesVaultPda}. Does not check existence. */
export async function getBoopTradingFeesVaultAddress(mint: Address): Promise<Address> {
  return (await findBoopTradingFeesVaultPda(mint))[0];
}

/**
 * Derive the vault authority for the deployed boop program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findBoopVaultAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: BOOP_PROGRAM,
    seeds: ["vault_authority"],
  });
}

/** Get the vault authority offline; inputs match {@link findBoopVaultAuthorityPda}. Does not check existence. */
export async function getBoopVaultAuthorityAddress(): Promise<Address> {
  return (await findBoopVaultAuthorityPda())[0];
}

/** Get selector-31 curve dependencies for a base mint offline; accounts may not exist. */
export async function getBoopCurveAddresses(mint: Address) {
  const [pool, config, tokenVault, solVault, feesVault, authority] = await Promise.all([
    getBoopBondingCurveAddress(mint),
    getBoopConfigAddress(),
    getBoopBondingCurveVaultAddress(mint),
    getBoopBondingCurveSolVaultAddress(mint),
    getBoopTradingFeesVaultAddress(mint),
    getBoopVaultAuthorityAddress(),
  ]);

  return { pool, config, tokenVault, solVault, feesVault, authority };
}

/**
 * Get the canonical SPL-token account required for Boop sells, offline; it may not exist.
 * @param owner - Trading wallet authority.
 * @param mint - Boop token mint.
 */
export function getBoopUserTokenAddress(owner: Address, mint: Address): Promise<Address> {
  return associatedTokenAddress(owner, mint, TOKEN_PROGRAM);
}
