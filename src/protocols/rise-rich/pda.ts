import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { RISE_RICH_PROGRAM, MAYFLOWER_PROGRAM } from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the market for the deployed rise-rich program, entirely offline.
 * @param tenant - Tenant account recorded in market state.
 * @param marketMeta - Market metadata account recorded in market state.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findRiseRichMarketPda(
  tenant: Address,
  marketMeta: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["market", encoder.encode(tenant), encoder.encode(marketMeta)],
  });
}

/** Get the market offline; inputs match {@link findRiseRichMarketPda}. Does not check existence. */
export async function getRiseRichMarketAddress(
  tenant: Address,
  marketMeta: Address,
): Promise<Address> {
  return (await findRiseRichMarketPda(tenant, marketMeta))[0];
}

/**
 * Derive the creator escrow for the deployed rise-rich program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findRiseRichCreatorEscrowPda(
  pool: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["creator_escrow", encoder.encode(pool)],
  });
}

/** Get the creator escrow offline; inputs match {@link findRiseRichCreatorEscrowPda}. Does not check existence. */
export async function getRiseRichCreatorEscrowAddress(pool: Address): Promise<Address> {
  return (await findRiseRichCreatorEscrowPda(pool))[0];
}

/**
 * Derive the team escrow for the collateral mint for the deployed rise-rich program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findRiseRichTeamEscrowPda(mint: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["team_escrow", encoder.encode(mint)],
  });
}

/** Get the team escrow for the collateral mint offline; inputs match {@link findRiseRichTeamEscrowPda}. Does not check existence. */
export async function getRiseRichTeamEscrowAddress(mint: Address): Promise<Address> {
  return (await findRiseRichTeamEscrowPda(mint))[0];
}

/**
 * Derive the Mayflower log account for the deployed rise-rich program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findRiseRichMayflowerLogPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({ programAddress: MAYFLOWER_PROGRAM, seeds: ["log"] });
}

/** Get the Mayflower log account offline; inputs match {@link findRiseRichMayflowerLogPda}. Does not check existence. */
export async function getRiseRichMayflowerLogAddress(): Promise<Address> {
  return (await findRiseRichMayflowerLogPda())[0];
}

/**
 * Derive the event authority for the deployed rise-rich program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findRiseRichEventAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["__event_authority"],
  });
}

/** Get the event authority offline; inputs match {@link findRiseRichEventAuthorityPda}. Does not check existence. */
export async function getRiseRichEventAuthorityAddress(): Promise<Address> {
  return (await findRiseRichEventAuthorityPda())[0];
}

/**
 * Get Rise market dependencies offline; no account existence checks are made.
 * @param tenant - Tenant account recorded in market state.
 * @param marketMeta - Market metadata recorded in market state.
 * @param collateralMint - Main collateral mint; the swap adapter supports WSOL.
 */
export async function getRiseRichMarketAddresses(
  tenant: Address,
  marketMeta: Address,
  collateralMint: Address,
) {
  const [pool, marketBump] = await findRiseRichMarketPda(tenant, marketMeta);
  const [creatorEscrow, teamEscrow, mayLogAccount, eventAuthority] = await Promise.all([
    getRiseRichCreatorEscrowAddress(pool),
    getRiseRichTeamEscrowAddress(collateralMint),
    getRiseRichMayflowerLogAddress(),
    getRiseRichEventAuthorityAddress(),
  ]);

  return { pool, marketBump, creatorEscrow, teamEscrow, mayLogAccount, eventAuthority };
}

/**
 * Derive the deployed Rise/Mayflower tenant account offline.
 * @param tenantSeed - Tenant address seed recorded in Rise tenant state.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichTenantPda(
  tenantSeed: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["tenant", encoder.encode(tenantSeed)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichTenantPda}. Does not check existence. */
export async function getRiseRichTenantAddress(tenantSeed: Address): Promise<Address> {
  return (await findRiseRichTenantPda(tenantSeed))[0];
}

/**
 * Derive the deployed Rise/Mayflower tenant account offline.
 * @param tenantSeed - Tenant address seed recorded in Mayflower tenant state.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerTenantPda(
  tenantSeed: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["tenant", encoder.encode(tenantSeed)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerTenantPda}. Does not check existence. */
export async function getRiseRichMayflowerTenantAddress(
  tenantSeed: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerTenantPda(tenantSeed))[0];
}

/**
 * Derive the deployed Rise/Mayflower market_group account offline.
 * @param groupSeed - Market group address seed recorded in Mayflower group state.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerMarketGroupPda(
  groupSeed: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["market_group", encoder.encode(groupSeed)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerMarketGroupPda}. Does not check existence. */
export async function getRiseRichMayflowerMarketGroupAddress(
  groupSeed: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerMarketGroupPda(groupSeed))[0];
}

/**
 * Derive the deployed Rise/Mayflower market_meta account offline.
 * @param metaSeed - Market metadata address seed recorded in Mayflower metadata state.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerMarketMetaPda(
  metaSeed: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["market_meta", encoder.encode(metaSeed)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerMarketMetaPda}. Does not check existence. */
export async function getRiseRichMayflowerMarketMetaAddress(
  metaSeed: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerMarketMetaPda(metaSeed))[0];
}

/**
 * Derive the deployed Rise/Mayflower market_linear account offline.
 * @param marketMeta - Mayflower market metadata account.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerLinearMarketPda(
  marketMeta: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["market_linear", encoder.encode(marketMeta)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerLinearMarketPda}. Does not check existence. */
export async function getRiseRichMayflowerLinearMarketAddress(
  marketMeta: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerLinearMarketPda(marketMeta))[0];
}

/**
 * Derive the deployed Rise/Mayflower cash_escrow account offline.
 * @param pool - Rise market account.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichCashEscrowPda(pool: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: RISE_RICH_PROGRAM,
    seeds: ["cash_escrow", encoder.encode(pool)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichCashEscrowPda}. Does not check existence. */
export async function getRiseRichCashEscrowAddress(pool: Address): Promise<Address> {
  return (await findRiseRichCashEscrowPda(pool))[0];
}

/**
 * Derive the deployed Rise/Mayflower liq_vault_main account offline.
 * @param marketMeta - Mayflower market metadata account.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerLiquidityVaultPda(
  marketMeta: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["liq_vault_main", encoder.encode(marketMeta)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerLiquidityVaultPda}. Does not check existence. */
export async function getRiseRichMayflowerLiquidityVaultAddress(
  marketMeta: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerLiquidityVaultPda(marketMeta))[0];
}

/**
 * Derive the deployed Rise/Mayflower rev_escrow_group account offline.
 * @param marketMeta - Mayflower market metadata account.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerGroupRevenueEscrowPda(
  marketMeta: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["rev_escrow_group", encoder.encode(marketMeta)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerGroupRevenueEscrowPda}. Does not check existence. */
export async function getRiseRichMayflowerGroupRevenueEscrowAddress(
  marketMeta: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerGroupRevenueEscrowPda(marketMeta))[0];
}

/**
 * Derive the deployed Rise/Mayflower rev_escrow_tenant account offline.
 * @param marketMeta - Mayflower market metadata account.
 * @returns Address and canonical bump; does not check existence.
 */
export function findRiseRichMayflowerTenantRevenueEscrowPda(
  marketMeta: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MAYFLOWER_PROGRAM,
    seeds: ["rev_escrow_tenant", encoder.encode(marketMeta)],
  });
}

/** Get the account offline; inputs match {@link findRiseRichMayflowerTenantRevenueEscrowPda}. Does not check existence. */
export async function getRiseRichMayflowerTenantRevenueEscrowAddress(
  marketMeta: Address,
): Promise<Address> {
  return (await findRiseRichMayflowerTenantRevenueEscrowPda(marketMeta))[0];
}
