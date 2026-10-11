import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  findRaydiumAmmV4AuthorityPda,
  getRaydiumAmmV4AuthorityAddress,
} from "celere-protocol-sdk/protocols/raydium-amm-v4";
import {
  findRaydiumCpmmAuthorityPda,
  findRaydiumCpmmConfigPda,
  getRaydiumCpmmAuthorityAddress,
  getRaydiumCpmmConfigAddress,
  getRaydiumCpmmObservationAddress,
} from "celere-protocol-sdk/protocols/raydium-cpmm";
import {
  findRaydiumClmmConfigPda,
  findRaydiumClmmPoolPda,
  getRaydiumClmmConfigAddress,
  getRaydiumClmmPoolAddress,
  getRaydiumClmmVaultAddress,
  getRaydiumClmmObservationAddress,
  getRaydiumClmmTickArrayAddress,
  getRaydiumClmmTickArrayBitmapExtensionAddress,
} from "celere-protocol-sdk/protocols/raydium-clmm";
import {
  findRaydiumLaunchlabAuthorityPda,
  getRaydiumLaunchlabAuthorityAddress,
  getRaydiumLaunchlabGlobalConfigAddress,
  getRaydiumLaunchlabPoolAddress,
  getRaydiumLaunchlabVaultAddress,
  getRaydiumLaunchlabEventAuthorityAddress,
  getRaydiumLaunchlabPlatformFeeVaultAddress,
  getRaydiumLaunchlabCreatorFeeVaultAddress,
} from "celere-protocol-sdk/protocols/raydium-launchlab";

/** A streaming consumer derives addresses offline, then subscribes through its own transport. */
export async function raydiumSubscriptionAddresses(input: {
  readonly config: Address;
  readonly pool: Address;
  readonly mint0: Address;
  readonly mint1: Address;
  readonly platform: Address;
  readonly creator: Address;
}): Promise<readonly Address[]> {
  const pdas: readonly ProgramDerivedAddress[] = await Promise.all([
    findRaydiumAmmV4AuthorityPda(),
    findRaydiumCpmmAuthorityPda(),
    findRaydiumCpmmConfigPda(1),
    findRaydiumClmmConfigPda(1),
    findRaydiumClmmPoolPda(input.config, input.mint0, input.mint1),
    findRaydiumLaunchlabAuthorityPda(),
  ]);
  const addresses: Address[] = await Promise.all([
    getRaydiumAmmV4AuthorityAddress(),
    getRaydiumCpmmAuthorityAddress(),
    getRaydiumCpmmConfigAddress(1),
    getRaydiumCpmmObservationAddress(input.pool),
    getRaydiumClmmConfigAddress(1),
    getRaydiumClmmPoolAddress(input.config, input.mint0, input.mint1),
    getRaydiumClmmVaultAddress(input.pool, input.mint0),
    getRaydiumClmmObservationAddress(input.pool),
    getRaydiumClmmTickArrayAddress(input.pool, -60),
    getRaydiumClmmTickArrayBitmapExtensionAddress(input.pool),
    getRaydiumLaunchlabAuthorityAddress(),
    getRaydiumLaunchlabGlobalConfigAddress(input.mint1, 1),
    getRaydiumLaunchlabPoolAddress(input.mint0, input.mint1),
    getRaydiumLaunchlabVaultAddress(input.pool, input.mint0),
    getRaydiumLaunchlabEventAuthorityAddress(),
    getRaydiumLaunchlabPlatformFeeVaultAddress(input.platform, input.mint1),
    getRaydiumLaunchlabCreatorFeeVaultAddress(input.creator, input.mint1),
  ]);
  return [...pdas.map(([address]) => address), ...addresses];
}
