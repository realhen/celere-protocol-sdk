import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METEORA_DAMM_V1_PROGRAM, METEORA_VAULT_PROGRAM } from "../../constants.js";

const discriminator = Uint8Array.of(248, 198, 158, 145, 225, 117, 135, 200);
const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/** Native DAMM v1 swap accounts; vault shares use the pool's vault-A share authority. */
export interface MeteoraDammV1SwapAccounts {
  readonly pool: Address;
  readonly userSourceToken: Address;
  readonly userDestinationToken: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
  readonly tokenVaultA: Address;
  readonly tokenVaultB: Address;
  readonly vaultLpMintA: Address;
  readonly vaultLpMintB: Address;
  readonly vaultLpTokenA: Address;
  readonly vaultLpTokenB: Address;
  readonly protocolTokenFee: Address;
  readonly user: Address;
}
/** Amounts are atomic input/output token units. */
export interface MeteoraDammV1SwapArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

/**
 * Build the native exact-input `swap` instruction without inspecting account state.
 * @remarks Data: [0,8) discriminator; [8,16) amountIn; [16,24) minimumAmountOut.
 * Integer fields are little-endian u64. Caller validates PDAs, vault backing and
 * limits; this function neither derives addresses nor attaches signer objects.
 * @throws Synchronous codec errors for values outside the native integer range.
 */
export function swap(
  accounts: MeteoraDammV1SwapAccounts,
  args: MeteoraDammV1SwapArgs,
): Instruction {
  return {
    programAddress: METEORA_DAMM_V1_PROGRAM,
    accounts: [
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userSourceToken, role: AccountRole.WRITABLE },
      { address: accounts.userDestinationToken, role: AccountRole.WRITABLE },
      { address: accounts.vaultA, role: AccountRole.WRITABLE },
      { address: accounts.vaultB, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultA, role: AccountRole.WRITABLE },
      { address: accounts.tokenVaultB, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpMintA, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpMintB, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpTokenA, role: AccountRole.WRITABLE },
      { address: accounts.vaultLpTokenB, role: AccountRole.WRITABLE },
      { address: accounts.protocolTokenFee, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: METEORA_VAULT_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: dataEncoder.encode({
      discriminator,
      amountIn: args.amountIn,
      minimumAmountOut: args.minimumAmountOut,
    }),
  };
}
