/**
 * Offline Raydium mainnet derivations used by the supported adapters.
 * No helper fetches or creates accounts; a derived address does not prove existence.
 */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  RAYDIUM_AMM_V4_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
  RAYDIUM_LAUNCHLAB_PROGRAM,
} from "./constants";

const encoder = getAddressEncoder();
const utf8 = new TextEncoder();

function derive(
  programAddress: Address,
  seed: string,
  ...seeds: readonly ReadonlyUint8Array[]
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [utf8.encode(seed), ...seeds],
  });
}

function u16BigEndian(index: number): Uint8Array {
  if (!Number.isSafeInteger(index) || index < 0 || index > 65535)
    throw new RangeError("Configuration index must be an integer in [0, 65535]");
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, index, false);
  return bytes;
}

/** Derive AMM v4's global vault authority and canonical bump offline; does not imply existence. */
export function findRaydiumAmmV4AuthorityPda(): Promise<ProgramDerivedAddress> {
  return derive(RAYDIUM_AMM_V4_PROGRAM, "amm authority");
}

/** Get AMM v4's global vault authority offline; does not imply existence. */
export async function getRaydiumAmmV4AuthorityAddress(): Promise<Address> {
  return (await findRaydiumAmmV4AuthorityPda())[0];
}

/** Derive CPMM's global vault/LP-mint authority and bump offline; does not imply existence. */
export function findRaydiumCpmmAuthorityPda(): Promise<ProgramDerivedAddress> {
  return derive(RAYDIUM_CPMM_PROGRAM, "vault_and_lp_mint_auth_seed");
}

/** Get CPMM's global vault/LP-mint authority offline; does not imply existence. */
export async function getRaydiumCpmmAuthorityAddress(): Promise<Address> {
  return (await findRaydiumCpmmAuthorityPda())[0];
}

/**
 * Derive a CPMM AMM configuration and bump offline; does not imply existence.
 * @param index - Configuration index, an integer in [0, 65535], encoded as big-endian u16.
 * @throws RangeError if the index is not a u16 integer.
 */
export function findRaydiumCpmmConfigPda(index: number): Promise<ProgramDerivedAddress> {
  return derive(RAYDIUM_CPMM_PROGRAM, "amm_config", u16BigEndian(index));
}

/** Get the CPMM configuration for a u16 index offline; rejects invalid indices and does not imply existence. */
export async function getRaydiumCpmmConfigAddress(index: number): Promise<Address> {
  return (await findRaydiumCpmmConfigPda(index))[0];
}

/** Get a CPMM pool's observation account offline; does not imply existence. */
export async function getRaydiumCpmmObservationAddress(pool: Address): Promise<Address> {
  return (await derive(RAYDIUM_CPMM_PROGRAM, "observation", encoder.encode(pool)))[0];
}

/**
 * Derive a CLMM AMM configuration and bump offline; does not imply existence.
 * @param index - Configuration index, an integer in [0, 65535], encoded as big-endian u16.
 * @throws RangeError if the index is not a u16 integer.
 */
export function findRaydiumClmmConfigPda(index: number): Promise<ProgramDerivedAddress> {
  return derive(RAYDIUM_CLMM_PROGRAM, "amm_config", u16BigEndian(index));
}

/** Get the CLMM configuration for a u16 index offline; rejects invalid indices and does not imply existence. */
export async function getRaydiumClmmConfigAddress(index: number): Promise<Address> {
  return (await findRaydiumClmmConfigPda(index))[0];
}

/**
 * Derive a standard permissionless CLMM pool and bump offline; does not imply existence.
 * @param config - CLMM AMM configuration address.
 * @param mint0 - First mint in ascending raw address-byte order; inputs are not sorted.
 * @param mint1 - Second mint in ascending raw address-byte order.
 * @remarks Permissioned pool variants are not supported by this derivation.
 */
export function findRaydiumClmmPoolPda(
  config: Address,
  mint0: Address,
  mint1: Address,
): Promise<ProgramDerivedAddress> {
  return derive(
    RAYDIUM_CLMM_PROGRAM,
    "pool",
    encoder.encode(config),
    encoder.encode(mint0),
    encoder.encode(mint1),
  );
}

/** Get a permissionless CLMM pool offline using mints in ascending raw byte order; does not imply existence. */
export async function getRaydiumClmmPoolAddress(
  config: Address,
  mint0: Address,
  mint1: Address,
): Promise<Address> {
  return (await findRaydiumClmmPoolPda(config, mint0, mint1))[0];
}

/** Get the CLMM vault for a pool and its token mint offline; does not imply existence. */
export async function getRaydiumClmmVaultAddress(
  pool: Address,
  mint: Address,
): Promise<Address> {
  return (
    await derive(
      RAYDIUM_CLMM_PROGRAM,
      "pool_vault",
      encoder.encode(pool),
      encoder.encode(mint),
    )
  )[0];
}

/** Get a CLMM pool's observation account offline; does not imply existence. */
export async function getRaydiumClmmObservationAddress(pool: Address): Promise<Address> {
  return (await derive(RAYDIUM_CLMM_PROGRAM, "observation", encoder.encode(pool)))[0];
}

/**
 * Get a CLMM tick-array address offline; does not imply existence or initialization.
 * @param pool - CLMM pool address.
 * @param startTickIndex - First tick index, in tick units (not array units), encoded as signed big-endian i32.
 * @remarks The caller supplies the start aligned to 60 times the pool's tick spacing;
 * this helper does not read spacing, align the index, or validate the pool's tick domain.
 * @throws RangeError if the index is not a signed i32 integer.
 */
export async function getRaydiumClmmTickArrayAddress(
  pool: Address,
  startTickIndex: number,
): Promise<Address> {
  if (
    !Number.isSafeInteger(startTickIndex) ||
    startTickIndex < -2147483648 ||
    startTickIndex > 2147483647
  )
    throw new RangeError("Tick-array start index must be a signed i32 integer");
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, startTickIndex, false);
  return (
    await derive(RAYDIUM_CLMM_PROGRAM, "tick_array", encoder.encode(pool), bytes)
  )[0];
}

/** Get a CLMM pool's tick-array bitmap extension offline; does not imply existence. */
export async function getRaydiumClmmTickArrayBitmapExtensionAddress(
  pool: Address,
): Promise<Address> {
  return (
    await derive(
      RAYDIUM_CLMM_PROGRAM,
      "pool_tick_array_bitmap_extension",
      encoder.encode(pool),
    )
  )[0];
}

/** Derive LaunchLab's global vault authority and bump offline; does not imply existence. */
export function findRaydiumLaunchlabAuthorityPda(): Promise<ProgramDerivedAddress> {
  return derive(RAYDIUM_LAUNCHLAB_PROGRAM, "vault_auth_seed");
}

/** Get LaunchLab's global vault authority offline; does not imply existence. */
export async function getRaydiumLaunchlabAuthorityAddress(): Promise<Address> {
  return (await findRaydiumLaunchlabAuthorityPda())[0];
}

/**
 * Get a LaunchLab constant-product global configuration offline; does not imply existence.
 * @param quoteMint - Quote token mint, not the launched base mint.
 * @param index - Configuration index, an integer in [0, 65535], encoded as big-endian u16.
 * @remarks Only the existing adapter's curve type 0 (constant product) is supported.
 * @throws RangeError if the index is not a u16 integer.
 */
export async function getRaydiumLaunchlabGlobalConfigAddress(
  quoteMint: Address,
  index: number,
): Promise<Address> {
  return (
    await derive(
      RAYDIUM_LAUNCHLAB_PROGRAM,
      "global_config",
      encoder.encode(quoteMint),
      Uint8Array.of(0),
      u16BigEndian(index),
    )
  )[0];
}

/**
 * Get a LaunchLab pool offline; does not imply existence.
 * @param baseMint - Launched token mint; retained first without sorting.
 * @param quoteMint - Funding/quote mint; retained second without sorting.
 */
export async function getRaydiumLaunchlabPoolAddress(
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  return (
    await derive(
      RAYDIUM_LAUNCHLAB_PROGRAM,
      "pool",
      encoder.encode(baseMint),
      encoder.encode(quoteMint),
    )
  )[0];
}

/** Get a LaunchLab pool's vault for its base or quote mint offline; does not imply existence. */
export async function getRaydiumLaunchlabVaultAddress(
  pool: Address,
  mint: Address,
): Promise<Address> {
  return (
    await derive(
      RAYDIUM_LAUNCHLAB_PROGRAM,
      "pool_vault",
      encoder.encode(pool),
      encoder.encode(mint),
    )
  )[0];
}

/** Get LaunchLab's Anchor event authority offline; does not imply existence. */
export async function getRaydiumLaunchlabEventAuthorityAddress(): Promise<Address> {
  return (await derive(RAYDIUM_LAUNCHLAB_PROGRAM, "__event_authority"))[0];
}

async function launchlabFeeVaultAddress(
  beneficiary: Address,
  quoteMint: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: RAYDIUM_LAUNCHLAB_PROGRAM,
      seeds: [encoder.encode(beneficiary), encoder.encode(quoteMint)],
    })
  )[0];
}

/** Get a LaunchLab platform fee vault offline, using the platform configuration address and quote mint; does not imply existence. */
export function getRaydiumLaunchlabPlatformFeeVaultAddress(
  platform: Address,
  quoteMint: Address,
): Promise<Address> {
  return launchlabFeeVaultAddress(platform, quoteMint);
}

/** Get a LaunchLab creator fee vault offline, using the creator authority and quote mint; does not imply existence. */
export function getRaydiumLaunchlabCreatorFeeVaultAddress(
  creator: Address,
  quoteMint: Address,
): Promise<Address> {
  return launchlabFeeVaultAddress(creator, quoteMint);
}
