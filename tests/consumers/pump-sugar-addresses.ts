import { type Address, type ProgramDerivedAddress } from "@solana/kit";
import {
  findPumpAmmPoolPda,
  getPumpAmmPoolAddress,
  getPumpAmmCanonicalPoolAddress,
  getPumpAmmGlobalAddress,
  getPumpAmmFeeConfigAddress,
  getPumpAmmEventAuthorityAddress,
  getPumpAmmUserVolumeAccumulatorAddress,
} from "celere-protocol-sdk/protocols/pump-amm";
import {
  getPumpPoolAuthorityAddress,
  getPumpHolderRewardsAddress,
} from "celere-protocol-sdk/protocols/pump";
import {
  findSugarBondingCurvePda,
  findSugarSolVaultPda,
  getSugarBondingCurveAddress,
  getSugarSolVaultAddress,
  getSugarStateAddress,
  getSugarEventAuthorityAddress,
} from "celere-protocol-sdk/protocols/sugar";

declare const mint: Address;
declare const quoteMint: Address;
declare const owner: Address;
const poolSeeds = { index: 0, creator: owner, baseMint: mint, quoteMint };
const pdas: ProgramDerivedAddress[] = await Promise.all([
  findPumpAmmPoolPda(poolSeeds),
  findSugarBondingCurvePda(mint),
  findSugarSolVaultPda(mint),
]);
const addresses: Address[] = await Promise.all([
  getPumpAmmPoolAddress(poolSeeds),
  getPumpAmmCanonicalPoolAddress(mint, quoteMint),
  getPumpAmmGlobalAddress(),
  getPumpAmmFeeConfigAddress(),
  getPumpAmmEventAuthorityAddress(),
  getPumpAmmUserVolumeAccumulatorAddress(owner),
  getPumpPoolAuthorityAddress(mint),
  getPumpHolderRewardsAddress(mint),
  getSugarBondingCurveAddress(mint),
  getSugarSolVaultAddress(mint),
  getSugarStateAddress(),
  getSugarEventAuthorityAddress(),
]);
void [pdas, addresses];
