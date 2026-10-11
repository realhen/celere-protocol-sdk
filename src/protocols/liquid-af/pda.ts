import { WRAPPED_SOL_MINT } from "../../accounts/tokens";
import {
  associatedTokenAddress,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../../accounts/tokens";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import {
  LIQUID_AF_PROGRAM,
  LIQUID_AF_FEES_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
} from "./constants";

const encoder = getAddressEncoder();

/**
 * Derive the bonding curve for the deployed liquid-af program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfBondingCurvePda(
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_PROGRAM,
    seeds: ["bonding_curve", encoder.encode(mint)],
  });
}
/** Get the bonding curve offline; inputs match {@link findLiquidAfBondingCurvePda}. Does not check existence. */
export async function getLiquidAfBondingCurveAddress(mint: Address): Promise<Address> {
  return (await findLiquidAfBondingCurvePda(mint))[0];
}

/**
 * Derive the curve global configuration for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfGlobalConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_PROGRAM,
    seeds: ["global_config"],
  });
}
/** Get the curve global configuration offline; inputs match {@link findLiquidAfGlobalConfigPda}. Does not check existence. */
export async function getLiquidAfGlobalConfigAddress(): Promise<Address> {
  return (await findLiquidAfGlobalConfigPda())[0];
}

/**
 * Derive the native SOL curve vault for the deployed liquid-af program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfSolVaultPda(pool: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_PROGRAM,
    seeds: ["bonding_curve_sol_vault", encoder.encode(pool)],
  });
}
/** Get the native SOL curve vault offline; inputs match {@link findLiquidAfSolVaultPda}. Does not check existence. */
export async function getLiquidAfSolVaultAddress(pool: Address): Promise<Address> {
  return (await findLiquidAfSolVaultPda(pool))[0];
}

/**
 * Derive the curve buyback vault for the deployed liquid-af program, entirely offline.
 * @param pool - Existing pool or curve address.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfBuybackVaultPda(
  pool: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_PROGRAM,
    seeds: ["buyback_vault", encoder.encode(pool)],
  });
}
/** Get the curve buyback vault offline; inputs match {@link findLiquidAfBuybackVaultPda}. Does not check existence. */
export async function getLiquidAfBuybackVaultAddress(pool: Address): Promise<Address> {
  return (await findLiquidAfBuybackVaultPda(pool))[0];
}

/**
 * Derive the curve CPI authority for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfCpiAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_PROGRAM,
    seeds: ["cpi_authority"],
  });
}
/** Get the curve CPI authority offline; inputs match {@link findLiquidAfCpiAuthorityPda}. Does not check existence. */
export async function getLiquidAfCpiAuthorityAddress(): Promise<Address> {
  return (await findLiquidAfCpiAuthorityPda())[0];
}

/**
 * Derive the shared fee configuration for the deployed liquid-af program, entirely offline.
 * @param baseMint - Base mint in native protocol order; no sorting is performed.
 * @param quoteMint - Quote mint in native protocol order; no sorting is performed.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfFeeConfigPda(
  baseMint: Address,
  quoteMint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_FEES_PROGRAM,
    seeds: ["fee_config", encoder.encode(baseMint), encoder.encode(quoteMint)],
  });
}
/** Get the shared fee configuration offline; inputs match {@link findLiquidAfFeeConfigPda}. Does not check existence. */
export async function getLiquidAfFeeConfigAddress(
  baseMint: Address,
  quoteMint: Address,
): Promise<Address> {
  return (await findLiquidAfFeeConfigPda(baseMint, quoteMint))[0];
}

/**
 * Derive the shared fee vault for the deployed liquid-af program, entirely offline.
 * @param feeConfig - Fee configuration account.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfFeeVaultPda(
  feeConfig: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_FEES_PROGRAM,
    seeds: ["fee_vault", encoder.encode(feeConfig)],
  });
}
/** Get the shared fee vault offline; inputs match {@link findLiquidAfFeeVaultPda}. Does not check existence. */
export async function getLiquidAfFeeVaultAddress(feeConfig: Address): Promise<Address> {
  return (await findLiquidAfFeeVaultPda(feeConfig))[0];
}

/**
 * Derive the user properties for the deployed liquid-af program, entirely offline.
 * @param owner - Account owner or authority.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfUserPropertiesPda(
  owner: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["user_properties", encoder.encode(owner)],
  });
}
/** Get the user properties offline; inputs match {@link findLiquidAfUserPropertiesPda}. Does not check existence. */
export async function getLiquidAfUserPropertiesAddress(owner: Address): Promise<Address> {
  return (await findLiquidAfUserPropertiesPda(owner))[0];
}

/**
 * Derive the global curve volume for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfGlobalCurveVolumePda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["global_curve_volume"],
  });
}
/** Get the global curve volume offline; inputs match {@link findLiquidAfGlobalCurveVolumePda}. Does not check existence. */
export async function getLiquidAfGlobalCurveVolumeAddress(): Promise<Address> {
  return (await findLiquidAfGlobalCurveVolumePda())[0];
}

/**
 * Derive the global AMM volume for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfGlobalAmmVolumePda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["global_amm_volume"],
  });
}
/** Get the global AMM volume offline; inputs match {@link findLiquidAfGlobalAmmVolumePda}. Does not check existence. */
export async function getLiquidAfGlobalAmmVolumeAddress(): Promise<Address> {
  return (await findLiquidAfGlobalAmmVolumePda())[0];
}

/**
 * Derive the token volume for the deployed liquid-af program, entirely offline.
 * @param mint - Token mint.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfTokenVolumePda(
  mint: Address,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["token_volume", encoder.encode(mint)],
  });
}
/** Get the token volume offline; inputs match {@link findLiquidAfTokenVolumePda}. Does not check existence. */
export async function getLiquidAfTokenVolumeAddress(mint: Address): Promise<Address> {
  return (await findLiquidAfTokenVolumePda(mint))[0];
}

/**
 * Derive the cashback configuration for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfCashbackConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["cashback_config"],
  });
}
/** Get the cashback configuration offline; inputs match {@link findLiquidAfCashbackConfigPda}. Does not check existence. */
export async function getLiquidAfCashbackConfigAddress(): Promise<Address> {
  return (await findLiquidAfCashbackConfigPda())[0];
}

/**
 * Derive the state CPI authority for the deployed liquid-af program, entirely offline.
 * @returns Address and canonical bump; does not prove account existence or validity.
 */
export function findLiquidAfStateCpiAuthorityPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: LIQUID_AF_STATE_PROGRAM,
    seeds: ["cpi_authority"],
  });
}
/** Get the state CPI authority offline; inputs match {@link findLiquidAfStateCpiAuthorityPda}. Does not check existence. */
export async function getLiquidAfStateCpiAuthorityAddress(): Promise<Address> {
  return (await findLiquidAfStateCpiAuthorityPda())[0];
}

/**
 * Derive shared LiquidAF fee and volume accounts offline, without checking existence.
 * @param owner - Trading user authority.
 * @param creator - Pool creator authority.
 * @param baseMint - Base mint in native pool order.
 * @param quoteMint - Quote mint in native pool order (WSOL for curves).
 * @param marketKind - Select the native curve or AMM global volume account.
 * @throws RangeError for an invalid market kind.
 */
export async function getLiquidAfSharedAddresses(
  owner: Address,
  creator: Address,
  baseMint: Address,
  quoteMint: Address,
  marketKind: "curve" | "amm",
) {
  if (marketKind !== "curve" && marketKind !== "amm")
    throw new RangeError("LiquidAF market kind must be curve or amm");
  const [
    [feeConfig, feeBump],
    creatorUserProperties,
    userProperties,
    globalVolume,
    tokenVolume,
    cashbackConfig,
    stateEventsCpiAuthority,
  ] = await Promise.all([
    findLiquidAfFeeConfigPda(baseMint, quoteMint),
    getLiquidAfUserPropertiesAddress(creator),
    getLiquidAfUserPropertiesAddress(owner),
    marketKind === "amm"
      ? getLiquidAfGlobalAmmVolumeAddress()
      : getLiquidAfGlobalCurveVolumeAddress(),
    getLiquidAfTokenVolumeAddress(baseMint),
    getLiquidAfCashbackConfigAddress(),
    getLiquidAfStateCpiAuthorityAddress(),
  ]);
  const feeVault = await getLiquidAfFeeVaultAddress(feeConfig);
  return {
    feeConfig,
    feeBump,
    feeVault,
    creatorUserProperties,
    userProperties,
    globalVolume,
    tokenVolume,
    cashbackConfig,
    stateEventsCpiAuthority,
  };
}

/**
 * Get the LiquidAF curve Token-2022 vault offline, without checking existence.
 * @param curve - Native account that owns the token vault.
 * @param mint - Mint held by the vault.
 */
export function getLiquidAfTokenVaultAddress(
  curve: Address,
  mint: Address,
): Promise<Address> {
  return associatedTokenAddress(curve, mint, TOKEN_2022_PROGRAM);
}

/**
 * Get the shared LiquidAF fee vault's quote-token account offline; it may not exist.
 * @param feeVault - Shared fee vault derived from the pool fee configuration.
 * @param quoteMint - Pool quote mint.
 * @param quoteTokenProgram - SPL Token or Token-2022 owner of the quote mint.
 * @throws RangeError for any other token program.
 */
export function getLiquidAfFeeVaultTokenAddress(
  feeVault: Address,
  quoteMint: Address,
  quoteTokenProgram: Address,
): Promise<Address> {
  if (quoteTokenProgram !== TOKEN_PROGRAM && quoteTokenProgram !== TOKEN_2022_PROGRAM)
    throw new RangeError("LiquidAF fee vault requires SPL Token or Token-2022");
  return associatedTokenAddress(feeVault, quoteMint, quoteTokenProgram);
}

/**
 * Derive LiquidAF native-SOL curve dependencies offline; no accounts are fetched or verified.
 * @param mint - Curve's Token-2022 base mint.
 * @param owner - Trading user authority.
 * @param creator - Curve creator authority from caller-owned state.
 */
export async function getLiquidAfCurveAddresses(
  mint: Address,
  owner: Address,
  creator: Address,
) {
  const [pool, bump] = await findLiquidAfBondingCurvePda(mint);
  const [
    [globalConfig, configBump],
    solVault,
    buybackVault,
    cpiAuthority,
    tokenVault,
    shared,
  ] = await Promise.all([
    findLiquidAfGlobalConfigPda(),
    getLiquidAfSolVaultAddress(pool),
    getLiquidAfBuybackVaultAddress(pool),
    getLiquidAfCpiAuthorityAddress(),
    getLiquidAfTokenVaultAddress(pool, mint),
    getLiquidAfSharedAddresses(owner, creator, mint, WRAPPED_SOL_MINT, "curve"),
  ]);
  return {
    pool,
    bump,
    globalConfig,
    configBump,
    solVault,
    buybackVault,
    cpiAuthority,
    tokenVault,
    shared,
  };
}
