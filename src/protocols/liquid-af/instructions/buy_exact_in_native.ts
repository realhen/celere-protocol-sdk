import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Instruction,
} from "@solana/kit";
import { WRAPPED_SOL_MINT } from "../../../accounts/tokens.js";
import {
  LIQUID_AF_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_EVENTS_PROGRAM,
} from "../constants.js";
import type { LiquidAfNativeSwapAccounts } from "./accounts.js";

/** Atomic amounts for the native LiquidAF `buy_exact_in_native` instruction. */
export interface LiquidAfBuyExactInNativeArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

/** 24 bytes: discriminator [0,8), amountIn LE [8,16), minimumAmountOut LE [16,24). */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Builds the raw native `buy_exact_in_native` instruction without network access or signer objects.
 * @remarks The caller validates pool state, PDA relationships, fees, referrals and slippage.
 * At graduation this ABI may reduce the input debit and output to the remaining curve inventory.
 * Input/output amounts use atomic units; native SOL uses lamports. Optional referral
 * accounts use the Anchor program sentinel when omitted.
 * @throws Synchronously when an amount cannot be encoded as an unsigned u64.
 */
export function buy_exact_in_native(
  accounts: LiquidAfNativeSwapAccounts,
  args: LiquidAfBuyExactInNativeArgs,
): Instruction {
  return {
    programAddress: LIQUID_AF_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.feeVault, role: AccountRole.WRITABLE },
      { address: accounts.buybackVault, role: AccountRole.WRITABLE },
      {
        address: accounts.creatorReferralVault ?? LIQUID_AF_PROGRAM,
        role: accounts.creatorReferralVault ? AccountRole.WRITABLE : AccountRole.READONLY,
      },
      {
        address: accounts.traderReferralVault ?? LIQUID_AF_PROGRAM,
        role: accounts.traderReferralVault ? AccountRole.WRITABLE : AccountRole.READONLY,
      },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: WRAPPED_SOL_MINT, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.creatorUserProperties, role: AccountRole.READONLY },
      { address: accounts.userProperties, role: AccountRole.WRITABLE },
      { address: accounts.globalCurveVolume, role: AccountRole.WRITABLE },
      { address: accounts.tokenVolume, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.cashbackConfig, role: AccountRole.READONLY },
      { address: LIQUID_AF_STATE_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.stateEventsCpiAuthority, role: AccountRole.READONLY },
      { address: accounts.pythPriceFeed, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.cpiAuthority, role: AccountRole.READONLY },
      { address: LIQUID_AF_EVENTS_PROGRAM, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([78, 141, 86, 103, 221, 69, 201, 8]),
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
    }),
  };
}
