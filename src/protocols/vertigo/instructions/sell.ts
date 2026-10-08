import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { VERTIGO_PROGRAM } from "../constants.js";

/** Named native accounts for Vertigo sell; caller supplies and validates every address. */
export interface VertigoSellAccounts {
  readonly pool: Address;
  readonly user: Address;
  readonly poolOwner: Address;
  readonly mintA: Address;
  readonly mintB: Address;
  readonly userA: Address;
  readonly userB: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
}

/** Native Vertigo sell arguments; token amounts use atomic bigint units. */
export interface VertigoSellArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Build the native Vertigo sell instruction without network or signer access.
 * @remarks Data layout: 0–7 discriminator; 8–15 amountIn (u64 LE);
 * 16–23 minimumAmountOut (u64 LE). Total: 24 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function getVertigoSellInstruction(
  accounts: VertigoSellAccounts,
  args: VertigoSellArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
  });
  return {
    programAddress: VERTIGO_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: accounts.poolOwner, role: AccountRole.READONLY },
      { address: accounts.mintA, role: AccountRole.READONLY },
      { address: accounts.mintB, role: AccountRole.READONLY },
      { address: accounts.userA, role: AccountRole.WRITABLE },
      { address: accounts.userB, role: AccountRole.WRITABLE },
      { address: accounts.vaultA, role: AccountRole.WRITABLE },
      { address: accounts.vaultB, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: VERTIGO_PROGRAM, role: AccountRole.READONLY },
    ],
    data,
  };
}
