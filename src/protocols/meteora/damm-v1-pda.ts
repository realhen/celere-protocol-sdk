/** Offline DAMM v1 and Meteora vault derivations, adapted from the MIT SDKs; see NOTICE.md. */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { METEORA_DAMM_V1_PROGRAM, METEORA_VAULT_PROGRAM } from "./constants";
const encoder = getAddressEncoder();

/** Derive a DAMM v1 vault and bump from its underlying mint and vault base public key. Does not fetch or create accounts. */
export function findMeteoraDammV1VaultPda(
  mint: Address,
  base: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: METEORA_VAULT_PROGRAM,
    seeds: ["vault", encoder.encode(mint), encoder.encode(base)],
  });
}

/** Derive a DAMM v1 vault from its underlying mint and vault base public key, without fetching or creating it. */
export async function getMeteoraDammV1VaultAddress(
  mint: Address,
  base: Address,
): Promise<Address> {
  return (await findMeteoraDammV1VaultPda(mint, base))[0];
}

/** Derive the underlying token reserve and bump for a Meteora DAMM v1 vault, without fetching or creating it. */
export function findMeteoraDammV1TokenVaultPda(
  vault: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: METEORA_VAULT_PROGRAM,
    seeds: ["token_vault", encoder.encode(vault)],
  });
}

/** Derive a DAMM v1 vault's underlying token reserve, without fetching or creating it. */
export async function getMeteoraDammV1TokenVaultAddress(
  vault: Address,
): Promise<Address> {
  return (await findMeteoraDammV1TokenVaultPda(vault))[0];
}

/** Derive the LP share mint issued by a DAMM v1 vault, without fetching or creating it. */
export async function getMeteoraDammV1LpMintAddress(vault: Address): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_VAULT_PROGRAM,
      seeds: ["lp_mint", encoder.encode(vault)],
    })
  )[0];
}

/** Derive the DAMM v1 pool's vault-share token account and bump; vault precedes pool in the seeds. Does not fetch or create it. */
export function findMeteoraDammV1PoolVaultSharePda(
  vault: Address,
  pool: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: METEORA_DAMM_V1_PROGRAM,
    seeds: [encoder.encode(vault), encoder.encode(pool)],
  });
}

/** Derive the DAMM v1 pool's token account holding shares of the supplied vault, without fetching or creating it. */
export async function getMeteoraDammV1PoolVaultShareAddress(
  vault: Address,
  pool: Address,
): Promise<Address> {
  return (await findMeteoraDammV1PoolVaultSharePda(vault, pool))[0];
}

/** Derive a DAMM v1 pool's protocol-fee token account for the supplied underlying mint, without fetching or creating it. */
export async function getMeteoraDammV1ProtocolFeeAddress(
  mint: Address,
  pool: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DAMM_V1_PROGRAM,
      seeds: ["fee", encoder.encode(mint), encoder.encode(pool)],
    })
  )[0];
}
