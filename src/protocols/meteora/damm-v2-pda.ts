/** Offline DAMM v2 derivations adapted from the MIT SDK; see NOTICE.md. */
import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { METEORA_DAMM_V2_PROGRAM } from "./constants";
const encoder = getAddressEncoder();

/** Derive a DAMM v2 pool's token vault for the supplied underlying mint; mint precedes pool in the seeds. Does not fetch or create it. */
export async function getMeteoraDammV2TokenVaultAddress(
  mint: Address,
  pool: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DAMM_V2_PROGRAM,
      seeds: ["token_vault", encoder.encode(mint), encoder.encode(pool)],
    })
  )[0];
}
/** Derive the DAMM v2 program's singleton Anchor event authority, without fetching or creating it. */
export async function getMeteoraDammV2EventAuthorityAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DAMM_V2_PROGRAM,
      seeds: ["__event_authority"],
    })
  )[0];
}
