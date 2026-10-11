import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  findMeteoraDammV1VaultPda,
  getMeteoraDammV1VaultAddress,
  findMeteoraDammV1TokenVaultPda,
  getMeteoraDammV1TokenVaultAddress,
  getMeteoraDammV1LpMintAddress,
  findMeteoraDammV1PoolVaultSharePda,
  getMeteoraDammV1PoolVaultShareAddress,
  getMeteoraDammV1ProtocolFeeAddress,
} from "celere-protocol-sdk/protocols/meteora-damm-v1";
import {
  getMeteoraDammV2TokenVaultAddress,
  getMeteoraDammV2EventAuthorityAddress,
  METEORA_DAMM_V2_POOL_AUTHORITY,
} from "celere-protocol-sdk/protocols/meteora-damm-v2";
import {
  findMeteoraDlmmPoolPda,
  getMeteoraDlmmPoolAddress,
  getMeteoraDlmmReserveAddress,
  getMeteoraDlmmOracleAddress,
  getMeteoraDlmmBitmapExtensionAddress,
  getMeteoraDlmmBinArrayAddress,
  getMeteoraDlmmEventAuthorityAddress,
  type MeteoraDlmmPoolAddressParams,
} from "celere-protocol-sdk/protocols/meteora-dlmm";
import {
  getMeteoraDbcPoolAddress,
  getMeteoraDbcTokenVaultAddress,
  getMeteoraDbcEventAuthorityAddress,
  METEORA_DBC_AUTHORITY,
} from "celere-protocol-sdk/protocols/meteora-dbc";
import {
  findOrcaWhirlpoolPda,
  getOrcaWhirlpoolAddress,
  getOrcaTickArrayAddress,
  getOrcaOracleAddress,
  type OrcaWhirlpoolAddressParams,
} from "celere-protocol-sdk/protocols/orca";

declare const pool: Address,
  mint: Address,
  otherMint: Address,
  vault: Address,
  base: Address,
  config: Address;
const dlmm: MeteoraDlmmPoolAddressParams = {
  mintX: mint,
  mintY: otherMint,
  binStep: 10,
  baseFactor: 100,
};
const orca: OrcaWhirlpoolAddressParams = {
  whirlpoolsConfig: config,
  tokenMintA: mint,
  tokenMintB: otherMint,
  feeTierIndex: 64,
};
const addresses: Promise<Address>[] = [
  getMeteoraDammV1VaultAddress(mint, base),
  getMeteoraDammV1TokenVaultAddress(vault),
  getMeteoraDammV1LpMintAddress(vault),
  getMeteoraDammV1PoolVaultShareAddress(vault, pool),
  getMeteoraDammV1ProtocolFeeAddress(mint, pool),
  getMeteoraDammV2TokenVaultAddress(mint, pool),
  getMeteoraDammV2EventAuthorityAddress(),
  getMeteoraDlmmPoolAddress(dlmm),
  getMeteoraDlmmReserveAddress(pool, mint),
  getMeteoraDlmmOracleAddress(pool),
  getMeteoraDlmmBitmapExtensionAddress(pool),
  getMeteoraDlmmBinArrayAddress(pool, -1n),
  getMeteoraDlmmEventAuthorityAddress(),
  getMeteoraDbcPoolAddress(config, mint, otherMint),
  getMeteoraDbcTokenVaultAddress(mint, pool),
  getMeteoraDbcEventAuthorityAddress(),
  getOrcaWhirlpoolAddress(orca),
  getOrcaTickArrayAddress(pool, -5632),
  getOrcaOracleAddress(pool),
];
const pdas: Promise<ProgramDerivedAddress>[] = [
  findMeteoraDammV1VaultPda(mint, base),
  findMeteoraDammV1TokenVaultPda(vault),
  findMeteoraDammV1PoolVaultSharePda(vault, pool),
  findMeteoraDlmmPoolPda(dlmm),
  findOrcaWhirlpoolPda(orca),
];
const authorities: Address[] = [METEORA_DAMM_V2_POOL_AUTHORITY, METEORA_DBC_AUTHORITY];
void [addresses, pdas, authorities];
