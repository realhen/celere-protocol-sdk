import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { SUGAR_PROGRAM } from "./constants";

const addressEncoder = getAddressEncoder();

/**
 * Derive a historical Sugar bonding curve and its instruction bump without I/O.
 * @remarks Uses the historical Sugar interface; it does not establish executable
 * support. The SDK does not register a Sugar swap adapter.
 */
export function findSugarBondingCurvePda(mint: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: SUGAR_PROGRAM,
    seeds: ["bonding_curve_", addressEncoder.encode(mint)],
  });
}

/** Get the historical Sugar curve address locally; see {@link findSugarBondingCurvePda}. */
export async function getSugarBondingCurveAddress(mint: Address): Promise<Address> {
  return (await findSugarBondingCurvePda(mint))[0];
}

/** Derive the historical Sugar SOL vault and its instruction bump, without I/O or an execution guarantee. */
export function findSugarSolVaultPda(mint: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: SUGAR_PROGRAM,
    seeds: ["bonding_curve_", addressEncoder.encode(mint), "_sol_vault"],
  });
}

/** Get the historical Sugar SOL vault address locally; see {@link findSugarSolVaultPda}. */
export async function getSugarSolVaultAddress(mint: Address): Promise<Address> {
  return (await findSugarSolVaultPda(mint))[0];
}

/** Get Sugar's historical global state address without fetching it or implying executable support. */
export async function getSugarStateAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({ programAddress: SUGAR_PROGRAM, seeds: ["state"] })
  )[0];
}

/** Get Sugar's historical event authority locally; no current execution support is implied. */
export async function getSugarEventAuthorityAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: SUGAR_PROGRAM,
      seeds: ["__event_authority"],
    })
  )[0];
}
