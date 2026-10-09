import type { Address } from "@solana/kit";

/** Accounts shared by LiquidAF AMM’s native swap instructions. */
export interface LiquidAfAmmSwapAccounts {
  readonly user: Address;
  readonly pool: Address;
  readonly userBaseAccount: Address;
  readonly userQuoteAccount: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly observationState: Address;
  readonly feeRecipient: Address;
  readonly protocolFeeVault: Address;
  readonly feeVault: Address;
  readonly feeVaultTokenAccount: Address;
  readonly buybackVault: Address;
  readonly authority: Address;
  readonly globalConfig: Address;
  readonly creator: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly feeConfig: Address;
  readonly userProperties: Address;
  readonly globalAmmVolume: Address;
  readonly tokenVolume: Address;
  readonly cashbackConfig: Address;
  readonly stateEventsCpiAuthority: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly cpiAuthority: Address;
  readonly oraclePriceFeed?: Address;
}
