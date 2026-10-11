/** Offline DBC derivations adapted from the MIT SDK; see NOTICE.md. */
import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { METEORA_DBC_PROGRAM } from "./constants";
const encoder = getAddressEncoder();

/** Derive a DBC pool for a configuration and its base/quote mints. The mint bytes are sorted descending as required by DBC, independently of their semantic roles. Does not fetch or create it. */
export async function getMeteoraDbcPoolAddress(
  config: Address,
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  const base = encoder.encode(baseMint),
    quote = encoder.encode(quoteMint);
  let baseLarger = false;
  for (let i = 0; i < base.length; i++) {
    if (base[i] === quote[i]) continue;
    baseLarger = base[i]! > quote[i]!;
    break;
  }
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DBC_PROGRAM,
      seeds: [
        "pool",
        encoder.encode(config),
        baseLarger ? base : quote,
        baseLarger ? quote : base,
      ],
    })
  )[0];
}
/** Derive a DBC pool's vault for an underlying base or quote mint; mint precedes pool in the seeds. Does not fetch or create it. */
export async function getMeteoraDbcTokenVaultAddress(
  mint: Address,
  pool: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DBC_PROGRAM,
      seeds: ["token_vault", encoder.encode(mint), encoder.encode(pool)],
    })
  )[0];
}
/** Derive the DBC program's singleton Anchor event authority, without fetching or creating it. */
export async function getMeteoraDbcEventAuthorityAddress(): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: METEORA_DBC_PROGRAM,
      seeds: ["__event_authority"],
    })
  )[0];
}
