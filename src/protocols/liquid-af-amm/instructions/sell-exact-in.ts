import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Instruction,
} from "@solana/kit";
import {
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_EVENTS_PROGRAM,
} from "../../liquid-af/constants.js";
import { LIQUID_AF_AMM_PROGRAM } from "../constants.js";
import type { LiquidAfAmmSwapAccounts } from "./accounts.js";

/** Atomic token amounts for the native LiquidAF AMM SellExactIn instruction. */
export interface LiquidAfAmmSellExactInArgs {
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
 * Builds the raw native AMM SellExactIn instruction without fetching or signer objects.
 * @remarks The caller validates state, PDA relationships, token programs, fees and slippage.
 * Amounts use atomic token units. Omitted oracle accounts use the Anchor program sentinel.
 * @throws Synchronously when an amount cannot be encoded as an unsigned u64.
 */
export function getLiquidAfAmmSellExactInInstruction(
  accounts: LiquidAfAmmSwapAccounts,
  args: LiquidAfAmmSellExactInArgs,
): Instruction {
  return {
    programAddress: LIQUID_AF_AMM_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userBaseAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteAccount, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.observationState, role: AccountRole.WRITABLE },
      { address: accounts.feeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.protocolFeeVault, role: AccountRole.WRITABLE },
      { address: accounts.feeVault, role: AccountRole.READONLY },
      { address: accounts.feeVaultTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.buybackVault, role: AccountRole.WRITABLE },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.creator, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.userProperties, role: AccountRole.WRITABLE },
      { address: accounts.globalAmmVolume, role: AccountRole.WRITABLE },
      { address: accounts.tokenVolume, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.cashbackConfig, role: AccountRole.READONLY },
      { address: LIQUID_AF_STATE_PROGRAM, role: AccountRole.READONLY },
      { address: accounts.stateEventsCpiAuthority, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.cpiAuthority, role: AccountRole.READONLY },
      { address: LIQUID_AF_EVENTS_PROGRAM, role: AccountRole.READONLY },
      {
        address: accounts.oraclePriceFeed ?? LIQUID_AF_AMM_PROGRAM,
        role: AccountRole.READONLY,
      },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([149, 39, 222, 155, 211, 124, 152, 26]),
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
    }),
  };
}
