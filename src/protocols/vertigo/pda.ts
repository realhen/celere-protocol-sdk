import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { VERTIGO_PROGRAM } from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the pool for the deployed vertigo program, entirely offline.
 * @param owner - Account owner or authority.
 * @param mintA - First mint in native pool order.
 * @param mintB - Second mint in native pool order.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findVertigoPoolPda(
  owner: Address,
  mintA: Address,
  mintB: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: ["pool", encoder.encode(owner), encoder.encode(mintA), encoder.encode(mintB)],
  });
}
/** Get the pool offline; inputs match {@link findVertigoPoolPda}. Does not check existence. */
export async function getVertigoPoolAddress(
  owner: Address,
  mintA: Address,
  mintB: Address,
): Promise<Address> {
  return (await findVertigoPoolPda(owner, mintA, mintB))[0];
}

/**
 * Derive the pool token vault for the deployed vertigo program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findVertigoVaultPda(
  pool: Address,
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: [encoder.encode(pool), encoder.encode(mint)],
  });
}
/** Get the pool token vault offline; inputs match {@link findVertigoVaultPda}. Does not check existence. */
export async function getVertigoVaultAddress(
  pool: Address,
  mint: Address,
): Promise<Address> {
  return (await findVertigoVaultPda(pool, mint))[0];
}

/**
 * Derive Vertigo pool and vault accounts offline; does not check existence or pool validity.
 * @param owner - Native pool owner.
 * @param mintA - First mint in native pool order (quote side in the swap adapter).
 * @param mintB - Second mint in native pool order (base side in the swap adapter).
 */
export async function getVertigoPoolAddresses(
  owner: Address,
  mintA: Address,
  mintB: Address,
) {
  const [pool, bump] = await findVertigoPoolPda(owner, mintA, mintB);
  const [vaultA, vaultB] = await Promise.all([
    getVertigoVaultAddress(pool, mintA),
    getVertigoVaultAddress(pool, mintB),
  ]);
  return { pool, bump, vaultA, vaultB };
}
