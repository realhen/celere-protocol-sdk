import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  findBoopBondingCurvePda,
  getBoopCurveAddresses,
  getBoopUserTokenAddress,
} from "celere-protocol-sdk/protocols/boop";
import {
  findMoonshotCurvePda,
  getMoonshotCurveAddresses,
  getMoonshotTokenVaultAddress,
} from "celere-protocol-sdk/protocols/moonshot";
import {
  HEAVEN_ORACLE_PROGRAM,
  HEAVEN_SOL_PRICE,
  findHeavenProtocolConfigPda,
  getHeavenProtocolConfigAddress,
  getHeavenPoolAddress,
  getHeavenTokenVaultAddress,
} from "celere-protocol-sdk/protocols/heaven";
import {
  findMetaDaoDaoPda,
  getMetaDaoDaoAddress,
  getMetaDaoTokenVaultAddress,
  getMetaDaoEventAuthorityAddress,
} from "celere-protocol-sdk/protocols/metadao";
import {
  findVertigoPoolPda,
  getVertigoPoolAddresses,
  getVertigoVaultAddress,
} from "celere-protocol-sdk/protocols/vertigo";
import {
  findRiseRichMarketPda,
  getRiseRichMarketAddresses,
  getRiseRichTenantAddress,
  getRiseRichMayflowerMarketGroupAddress,
  getRiseRichMayflowerMarketMetaAddress,
  getRiseRichMayflowerLinearMarketAddress,
  getRiseRichMayflowerLiquidityVaultAddress,
  getRiseRichMayflowerGroupRevenueEscrowAddress,
  getRiseRichMayflowerTenantRevenueEscrowAddress,
} from "celere-protocol-sdk/protocols/rise-rich";
import {
  findLiquidAfBondingCurvePda,
  getLiquidAfCurveAddresses,
  getLiquidAfSharedAddresses,
  getLiquidAfFeeVaultTokenAddress,
  LIQUID_AF_STATE_PROGRAM,
} from "celere-protocol-sdk/protocols/liquid-af";
import {
  findLiquidAfAmmAuthorityPda,
  getLiquidAfAmmPoolAddresses,
  getLiquidAfAmmProtocolFeeVaultAddress,
  getLiquidAfFeeVaultTokenAddress as getAmmFeeVaultTokenAddress,
  LIQUID_AF_FEES_PROGRAM,
} from "celere-protocol-sdk/protocols/liquid-af-amm";

type Addresses<Names extends string> = Readonly<Record<Names, Address>>;
type SharedLiquidAddresses = Addresses<
  | "feeConfig"
  | "feeVault"
  | "creatorUserProperties"
  | "userProperties"
  | "globalVolume"
  | "tokenVolume"
  | "cashbackConfig"
  | "stateEventsCpiAuthority"
> & { readonly feeBump: number };

/** Derive subscription targets from caller-owned stream fields without constructing a swap request. */
export async function otherProtocolSubscriptionAddresses(input: {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly owner: Address;
  readonly creator: Address;
  readonly feeRecipient: Address;
  readonly tenant: Address;
  readonly marketMeta: Address;
  readonly tenantSeed: Address;
  readonly groupSeed: Address;
  readonly metaSeed: Address;
  readonly daoNonce: bigint;
  readonly heavenVersion: 1 | 2;
}): Promise<readonly Address[]> {
  const pdas: readonly ProgramDerivedAddress[] = await Promise.all([
    findBoopBondingCurvePda(input.baseMint),
    findMoonshotCurvePda(input.baseMint),
    findHeavenProtocolConfigPda(input.heavenVersion),
    findMetaDaoDaoPda(input.creator, input.daoNonce),
    findVertigoPoolPda(input.owner, input.quoteMint, input.baseMint),
    findRiseRichMarketPda(input.tenant, input.marketMeta),
    findLiquidAfBondingCurvePda(input.baseMint),
    findLiquidAfAmmAuthorityPda(),
  ]);
  const boop: Addresses<
    "pool" | "config" | "tokenVault" | "solVault" | "feesVault" | "authority"
  > = await getBoopCurveAddresses(input.baseMint);
  const moonshot: Addresses<"curve" | "config"> & {
    readonly curveBump: number;
    readonly configBump: number;
  } = await getMoonshotCurveAddresses(input.baseMint);
  const vertigo: Addresses<"pool" | "vaultA" | "vaultB"> & {
    readonly bump: number;
  } = await getVertigoPoolAddresses(input.owner, input.quoteMint, input.baseMint);
  const rise: Addresses<
    "pool" | "creatorEscrow" | "teamEscrow" | "mayLogAccount" | "eventAuthority"
  > & { readonly marketBump: number } = await getRiseRichMarketAddresses(
    input.tenant,
    input.marketMeta,
    input.quoteMint,
  );
  const shared: SharedLiquidAddresses = await getLiquidAfSharedAddresses(
    input.owner,
    input.creator,
    input.baseMint,
    input.quoteMint,
    "amm",
  );
  const liquidCurve: Addresses<
    "pool" | "globalConfig" | "solVault" | "buybackVault" | "cpiAuthority" | "tokenVault"
  > & {
    readonly bump: number;
    readonly configBump: number;
    readonly shared: SharedLiquidAddresses;
  } = await getLiquidAfCurveAddresses(input.baseMint, input.owner, input.creator);
  const liquidAmm: Addresses<
    | "pool"
    | "baseVault"
    | "quoteVault"
    | "lpMint"
    | "observation"
    | "authority"
    | "globalConfig"
    | "cpiAuthority"
    | "buybackVault"
  > & {
    readonly authorityBump: number;
    readonly configBump: number;
    readonly shared: SharedLiquidAddresses;
  } = await getLiquidAfAmmPoolAddresses(
    input.baseMint,
    input.quoteMint,
    input.owner,
    input.creator,
  );
  const heavenConfig: Address = await getHeavenProtocolConfigAddress(input.heavenVersion);
  const dao: Address = await getMetaDaoDaoAddress(input.creator, input.daoNonce);
  const addresses: readonly Address[] = await Promise.all([
    getBoopUserTokenAddress(input.owner, input.baseMint),
    getMoonshotTokenVaultAddress(moonshot.curve, input.baseMint),
    getHeavenPoolAddress(input.baseMint, input.quoteMint),
    getHeavenTokenVaultAddress(heavenConfig, input.baseMint),
    getMetaDaoTokenVaultAddress(dao, input.baseMint),
    getMetaDaoEventAuthorityAddress(),
    getVertigoVaultAddress(vertigo.pool, input.baseMint),
    getRiseRichTenantAddress(input.tenantSeed),
    getRiseRichMayflowerMarketGroupAddress(input.groupSeed),
    getRiseRichMayflowerMarketMetaAddress(input.metaSeed),
    getRiseRichMayflowerLinearMarketAddress(input.marketMeta),
    getRiseRichMayflowerLiquidityVaultAddress(input.marketMeta),
    getRiseRichMayflowerGroupRevenueEscrowAddress(input.marketMeta),
    getRiseRichMayflowerTenantRevenueEscrowAddress(input.marketMeta),
    getLiquidAfFeeVaultTokenAddress(
      shared.feeVault,
      input.quoteMint,
      TOKEN_2022_PROGRAM_ADDRESS,
    ),
    getAmmFeeVaultTokenAddress(
      liquidAmm.shared.feeVault,
      input.quoteMint,
      TOKEN_PROGRAM_ADDRESS,
    ),
    getLiquidAfAmmProtocolFeeVaultAddress(input.feeRecipient, input.quoteMint),
  ]);
  const bumps: readonly number[] = [
    ...pdas.map(([, bump]) => bump),
    moonshot.curveBump,
    moonshot.configBump,
    vertigo.bump,
    rise.marketBump,
    shared.feeBump,
    liquidCurve.bump,
    liquidCurve.configBump,
    liquidAmm.authorityBump,
    liquidAmm.configBump,
  ];
  void bumps;
  return [
    ...pdas.map(([address]) => address),
    ...Object.values(boop),
    moonshot.config,
    vertigo.vaultA,
    vertigo.vaultB,
    rise.creatorEscrow,
    rise.teamEscrow,
    liquidCurve.tokenVault,
    liquidCurve.shared.tokenVolume,
    liquidAmm.baseVault,
    liquidAmm.quoteVault,
    liquidAmm.observation,
    ...addresses,
    HEAVEN_ORACLE_PROGRAM,
    HEAVEN_SOL_PRICE,
    LIQUID_AF_STATE_PROGRAM,
    LIQUID_AF_FEES_PROGRAM,
  ];
}
