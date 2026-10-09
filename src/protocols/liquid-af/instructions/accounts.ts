import type { Address } from "@solana/kit";

/** Accounts shared by LiquidAF curve’s native swap instructions. */
export interface LiquidAfNativeSwapAccounts {
  readonly user: Address;
  readonly feeRecipient: Address;
  readonly bondingCurve: Address;
  readonly bondingCurveSolVault: Address;
  readonly bondingCurveTokenAccount: Address;
  readonly userTokenAccount: Address;
  readonly feeVault: Address;
  readonly buybackVault: Address;
  readonly creatorReferralVault?: Address;
  readonly traderReferralVault?: Address;
  readonly globalConfig: Address;
  readonly mint: Address;
  readonly feeConfig: Address;
  readonly creatorUserProperties: Address;
  readonly userProperties: Address;
  readonly globalCurveVolume: Address;
  readonly tokenVolume: Address;
  readonly cashbackConfig: Address;
  readonly stateEventsCpiAuthority: Address;
  readonly pythPriceFeed: Address;
  readonly cpiAuthority: Address;
}
