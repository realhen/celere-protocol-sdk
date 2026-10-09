import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { WRAPPED_SOL_MINT } from "../../../accounts/tokens.js";
import { BOOP_PROGRAM } from "../constants.js";
const DISCRIMINATOR = new Uint8Array([138, 127, 14, 91, 38, 87, 115, 105]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["buyAmount", getU64Encoder()],
  ["amountOutMin", getU64Encoder()],
]);
/** Named native `buy_token` accounts; caller validates addresses and state. */
export interface BoopBuyTokenAccounts {
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly tradingFeesVault: Address;
  readonly bondingCurveVault: Address;
  readonly bondingCurveSolVault: Address;
  readonly recipientTokenAccount: Address;
  readonly buyer: Address;
  readonly config: Address;
  readonly vaultAuthority: Address;
}
/** Atomic lamport input and token output amounts. */
export interface BoopBuyTokenArgs {
  readonly buyAmount: bigint;
  readonly amountOutMin: bigint;
}
/**
 * Build Boop's native `buy_token` instruction without state validation.
 * @remarks Bytes 0–7: discriminator; 8–15: `buyAmount` u64 LE;
 * 16–23: `amountOutMin` u64 LE. Total 24 bytes.
 * Graduation may clip the requested input and output; this instruction cannot
 * guarantee full fills. Callers validate PDAs, state, ownership, balances and limits.
 * The recipient is writable because the native token-transfer CPI credits it.
 * @throws Synchronous codec errors for amounts outside u64.
 */
export function buy_token(
  accounts: BoopBuyTokenAccounts,
  args: BoopBuyTokenArgs,
): Instruction {
  return {
    programAddress: BOOP_PROGRAM,
    accounts: [
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.tradingFeesVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.recipientTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.vaultAuthority, role: AccountRole.READONLY },
      { address: WRAPPED_SOL_MINT, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: DISCRIMINATOR,
      buyAmount: args.buyAmount,
      amountOutMin: args.amountOutMin,
    }),
  };
}
