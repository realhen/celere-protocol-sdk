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
import { BOOP_PROGRAM } from "../constants.js";
const DISCRIMINATOR = new Uint8Array([109, 61, 40, 187, 230, 176, 135, 174]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["sellAmount", getU64Encoder()],
  ["amountOutMin", getU64Encoder()],
]);
/** Named native `sell_token` accounts; caller validates addresses and state. */
export interface BoopSellTokenAccounts {
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly tradingFeesVault: Address;
  readonly bondingCurveVault: Address;
  readonly bondingCurveSolVault: Address;
  readonly sellerTokenAccount: Address;
  readonly seller: Address;
  readonly recipient: Address;
  readonly config: Address;
}
/** Atomic token input and lamport output amounts. */
export interface BoopSellTokenArgs {
  readonly sellAmount: bigint;
  readonly amountOutMin: bigint;
}
/**
 * Build Boop's native `sell_token` instruction without state validation.
 * @remarks Bytes 0–7: discriminator; 8–15: `sellAmount` u64 LE;
 * 16–23: `amountOutMin` u64 LE. Total 24 bytes.
 * Callers validate PDAs, state, ownership, balances and full-fill limits.
 * @throws Synchronous codec errors for amounts outside u64.
 */
export function getBoopSellTokenInstruction(
  accounts: BoopSellTokenAccounts,
  args: BoopSellTokenArgs,
): Instruction {
  return {
    programAddress: BOOP_PROGRAM,
    accounts: [
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.tradingFeesVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveVault, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurveSolVault, role: AccountRole.WRITABLE },
      { address: accounts.sellerTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.seller, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.recipient, role: AccountRole.WRITABLE },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: DISCRIMINATOR,
      sellAmount: args.sellAmount,
      amountOutMin: args.amountOutMin,
    }),
  };
}
