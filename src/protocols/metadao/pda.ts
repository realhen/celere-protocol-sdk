import { associatedTokenAddress, TOKEN_PROGRAM } from "../accounts/tokens";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { METADAO_PROGRAM } from "./constants";
import { getU64Encoder } from "@solana/kit";

const encoder = getAddressEncoder();

/**
 * Derive the v0.6 event authority for the deployed metadao program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findMetaDaoEventAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: METADAO_PROGRAM,
    seeds: ["__event_authority"],
  });
}

/** Get the v0.6 event authority offline; inputs match {@link findMetaDaoEventAuthorityPda}. Does not check existence. */
export async function getMetaDaoEventAuthorityAddress(): Promise<Address> {
  return (await findMetaDaoEventAuthorityPda())[0];
}

/**
 * Derive the MetaDAO v0.6 DAO that owns its spot pool, entirely offline.
 * @param creator - DAO creator authority.
 * @param nonce - Unsigned u64 DAO nonce, encoded little-endian; zero is valid.
 * @returns Address and canonical bump; does not check existence or DAO state.
 * @throws RangeError if nonce is outside the u64 range or is not a bigint.
 */
export async function findMetaDaoDaoPda(
  creator: Address,
  nonce: bigint,
): Promise<ProgramDerivedAddress> {
  if (typeof nonce !== "bigint" || nonce < 0n || nonce > (1n << 64n) - 1n) {
    throw new RangeError("MetaDAO nonce must be a u64 bigint");
  }

  return getProgramDerivedAddress({
    programAddress: METADAO_PROGRAM,
    seeds: ["dao", encoder.encode(creator), getU64Encoder().encode(nonce)],
  });
}

/** Get the MetaDAO v0.6 DAO address offline; inputs match {@link findMetaDaoDaoPda}. Does not check existence. */
export async function getMetaDaoDaoAddress(
  creator: Address,
  nonce: bigint,
): Promise<Address> {
  return (await findMetaDaoDaoPda(creator, nonce))[0];
}

/**
 * Get the MetaDAO v0.6 DAO token vault offline, without checking existence.
 * @param dao - Native account that owns the token vault.
 * @param mint - Mint held by the vault.
 */
export function getMetaDaoTokenVaultAddress(
  dao: Address,
  mint: Address,
): Promise<Address> {
  return associatedTokenAddress(dao, mint, TOKEN_PROGRAM);
}
