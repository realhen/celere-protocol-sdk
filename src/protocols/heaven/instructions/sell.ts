import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSVAR_INSTRUCTIONS_ADDRESS } from "@solana/sysvars";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  getU32Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { HEAVEN_PROGRAM, HEAVEN_ORACLE_PROGRAM, HEAVEN_SOL_PRICE } from "../constants.js";

/** Named native Heaven sell accounts, in on-chain order. */
export interface HeavenSellAccounts {
  readonly tokenAProgram: Address;
  readonly tokenBProgram: Address;
  readonly pool: Address;
  readonly user: Address;
  readonly tokenAMint: Address;
  readonly tokenBMint: Address;
  readonly userTokenA: Address;
  readonly userTokenB: Address;
  readonly tokenAVault: Address;
  readonly tokenBVault: Address;
  readonly protocolConfig: Address;
}
/** Atomic token amounts. Heaven sell supports native exact input only. */
export interface HeavenSellArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
  ["eventDataLength", getU32Encoder()],
]);
/** Build an unsigned Heaven sell from caller-validated accounts.
 * @remarks Layout: 0–7 discriminator; 8–15 amountIn (u64 LE);
 * 16–23 minimumAmountOut (u64 LE); 24–27 empty event string length (u32 LE).
 * Total 28 bytes. SOL uses SPL wrapped SOL token accounts.
 * @throws Synchronously if an amount exceeds its codec range.
 */
export function getHeavenSellInstruction(
  accounts: HeavenSellAccounts,
  args: HeavenSellArgs,
): Instruction {
  return {
    programAddress: HEAVEN_PROGRAM,
    accounts: [
      { address: accounts.tokenAProgram, role: AccountRole.READONLY },
      { address: accounts.tokenBProgram, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tokenAMint, role: AccountRole.READONLY },
      { address: accounts.tokenBMint, role: AccountRole.READONLY },
      { address: accounts.userTokenA, role: AccountRole.WRITABLE },
      { address: accounts.userTokenB, role: AccountRole.WRITABLE },
      { address: accounts.tokenAVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenBVault, role: AccountRole.WRITABLE },
      { address: accounts.protocolConfig, role: AccountRole.WRITABLE },
      { address: SYSVAR_INSTRUCTIONS_ADDRESS, role: AccountRole.READONLY },
      { address: HEAVEN_ORACLE_PROGRAM, role: AccountRole.READONLY },
      { address: HEAVEN_SOL_PRICE, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator: new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
      eventDataLength: 0,
    }),
  };
}
