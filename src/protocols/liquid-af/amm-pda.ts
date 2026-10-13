import { getLiquidAfSharedAddresses } from "./pda";
export {
  findLiquidAfFeeConfigPda,
  getLiquidAfFeeConfigAddress,
  findLiquidAfFeeVaultPda,
  getLiquidAfFeeVaultAddress,
  getLiquidAfFeeVaultTokenAddress,
  findLiquidAfUserPropertiesPda,
  getLiquidAfUserPropertiesAddress,
  findLiquidAfGlobalAmmVolumePda,
  getLiquidAfGlobalAmmVolumeAddress,
  findLiquidAfTokenVolumePda,
  getLiquidAfTokenVolumeAddress,
  findLiquidAfCashbackConfigPda,
  getLiquidAfCashbackConfigAddress,
  findLiquidAfStateCpiAuthorityPda,
  getLiquidAfStateCpiAuthorityAddress,
  getLiquidAfSharedAddresses,
} from "./pda";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { LIQUID_AF_AMM_PROGRAM } from "./amm-constants";

const encoder = getAddressEncoder();

/**
 * Derive the AMM pool for the deployed liquid-af-amm program, entirely offline.
 * @param baseMint - Base mint in native protocol order; no sorting is performed.
 * @param quoteMint - Quote mint in native protocol order; no sorting is performed.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmPoolPda(
  baseMint: Address,
  quoteMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["pool", encoder.encode(baseMint), encoder.encode(quoteMint)],
  });
}

/** Get the AMM pool offline; inputs match {@link findLiquidAfAmmPoolPda}. Does not check existence. */
export async function getLiquidAfAmmPoolAddress(
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  return (await findLiquidAfAmmPoolPda(baseMint, quoteMint))[0];
}

/**
 * Derive the AMM token vault for the deployed liquid-af-amm program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmVaultPda(
  pool: Address,
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["pool_vault", encoder.encode(pool), encoder.encode(mint)],
  });
}

/** Get the AMM token vault offline; inputs match {@link findLiquidAfAmmVaultPda}. Does not check existence. */
export async function getLiquidAfAmmVaultAddress(
  pool: Address,
  mint: Address,
): Promise<Address> {
  return (await findLiquidAfAmmVaultPda(pool, mint))[0];
}

/**
 * Derive the AMM LP mint for the deployed liquid-af-amm program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmLpMintPda(pool: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["pool_lp_mint", encoder.encode(pool)],
  });
}

/** Get the AMM LP mint offline; inputs match {@link findLiquidAfAmmLpMintPda}. Does not check existence. */
export async function getLiquidAfAmmLpMintAddress(pool: Address): Promise<Address> {
  return (await findLiquidAfAmmLpMintPda(pool))[0];
}

/**
 * Derive the AMM observation for the deployed liquid-af-amm program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmObservationPda(
  pool: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["observation", encoder.encode(pool)],
  });
}

/** Get the AMM observation offline; inputs match {@link findLiquidAfAmmObservationPda}. Does not check existence. */
export async function getLiquidAfAmmObservationAddress(pool: Address): Promise<Address> {
  return (await findLiquidAfAmmObservationPda(pool))[0];
}

/**
 * Derive the vault and LP mint authority for the deployed liquid-af-amm program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["vault_and_lp_mint_auth_seed"],
  });
}

/** Get the vault and LP mint authority offline; inputs match {@link findLiquidAfAmmAuthorityPda}. Does not check existence. */
export async function getLiquidAfAmmAuthorityAddress(): Promise<Address> {
  return (await findLiquidAfAmmAuthorityPda())[0];
}

/**
 * Derive the AMM global configuration for the deployed liquid-af-amm program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmGlobalConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["global_config"],
  });
}

/** Get the AMM global configuration offline; inputs match {@link findLiquidAfAmmGlobalConfigPda}. Does not check existence. */
export async function getLiquidAfAmmGlobalConfigAddress(): Promise<Address> {
  return (await findLiquidAfAmmGlobalConfigPda())[0];
}

/**
 * Derive the AMM CPI authority for the deployed liquid-af-amm program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmCpiAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["cpi_authority"],
  });
}

/** Get the AMM CPI authority offline; inputs match {@link findLiquidAfAmmCpiAuthorityPda}. Does not check existence. */
export async function getLiquidAfAmmCpiAuthorityAddress(): Promise<Address> {
  return (await findLiquidAfAmmCpiAuthorityPda())[0];
}

/**
 * Derive the AMM buyback vault for the deployed liquid-af-amm program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @param quoteMint - Quote mint in native protocol order; no sorting is performed.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmBuybackVaultPda(
  pool: Address,
  quoteMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["buyback_vault", encoder.encode(pool), encoder.encode(quoteMint)],
  });
}

/** Get the AMM buyback vault offline; inputs match {@link findLiquidAfAmmBuybackVaultPda}. Does not check existence. */
export async function getLiquidAfAmmBuybackVaultAddress(
  pool: Address,
  quoteMint: Address,
): Promise<Address> {
  return (await findLiquidAfAmmBuybackVaultPda(pool, quoteMint))[0];
}

/**
 * Derive the AMM protocol fee vault for the deployed liquid-af-amm program, entirely offline.
 * @param feeRecipient - Configured protocol fee recipient.
 * @param quoteMint - Quote mint in native protocol order; no sorting is performed.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfAmmProtocolFeeVaultPda(
  feeRecipient: Address,
  quoteMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_AMM_PROGRAM,
    seeds: ["global_fee", encoder.encode(feeRecipient), encoder.encode(quoteMint)],
  });
}

/** Get the AMM protocol fee vault offline; inputs match {@link findLiquidAfAmmProtocolFeeVaultPda}. Does not check existence. */
export async function getLiquidAfAmmProtocolFeeVaultAddress(
  feeRecipient: Address,
  quoteMint: Address,
): Promise<Address> {
  return (await findLiquidAfAmmProtocolFeeVaultPda(feeRecipient, quoteMint))[0];
}

/**
 * Derive LiquidAF AMM pool dependencies offline; no existence or pool state checks are performed.
 * @param baseMint - Native base mint; preserve pool order.
 * @param quoteMint - Native quote mint; preserve pool order.
 * @param owner - Trading user authority.
 * @param creator - Pool creator authority from caller-owned state.
 */
export async function getLiquidAfAmmPoolAddresses(
  baseMint: Address,
  quoteMint: Address,
  owner: Address,
  creator: Address,
) {
  const pool = await getLiquidAfAmmPoolAddress(baseMint, quoteMint);
  const [
    baseVault,
    quoteVault,
    lpMint,
    observation,
    [authority, authorityBump],
    [globalConfig, configBump],
    cpiAuthority,
    buybackVault,
    shared,
  ] = await Promise.all([
    getLiquidAfAmmVaultAddress(pool, baseMint),
    getLiquidAfAmmVaultAddress(pool, quoteMint),
    getLiquidAfAmmLpMintAddress(pool),
    getLiquidAfAmmObservationAddress(pool),
    findLiquidAfAmmAuthorityPda(),
    findLiquidAfAmmGlobalConfigPda(),
    getLiquidAfAmmCpiAuthorityAddress(),
    getLiquidAfAmmBuybackVaultAddress(pool, quoteMint),
    getLiquidAfSharedAddresses(owner, creator, baseMint, quoteMint, "amm"),
  ]);

  return {
    pool,
    baseVault,
    quoteVault,
    lpMint,
    observation,
    authority,
    authorityBump,
    globalConfig,
    configBump,
    cpiAuthority,
    buybackVault,
    shared,
  };
}
