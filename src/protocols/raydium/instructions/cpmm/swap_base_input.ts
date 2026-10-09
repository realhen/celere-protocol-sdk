import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_CPMM_PROGRAM } from "../../constants.js";

/** Named native accounts for CPMM swap_base_input; caller supplies and validates every address. */
export interface RaydiumCpmmSwapBaseInputAccounts {
  readonly owner: Address;
  readonly authority: Address;
  readonly ammConfig: Address;
  readonly pool: Address;
  readonly inputTokenAccount: Address;
  readonly outputTokenAccount: Address;
  readonly inputVault: Address;
  readonly outputVault: Address;
  readonly inputTokenProgram: Address;
  readonly outputTokenProgram: Address;
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly observationState: Address;
}

/** Native CPMM swap_base_input arguments; token amounts use atomic bigint units. */
export interface RaydiumCpmmSwapBaseInputArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Build the native CPMM swap_base_input instruction without network or signer access.
 * @remarks Data layout: 0–7 discriminator; 8–15 amountIn (u64 LE);
 * 16–23 minimumAmountOut (u64 LE). Total: 24 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function swap_base_input(
  accounts: RaydiumCpmmSwapBaseInputAccounts,
  args: RaydiumCpmmSwapBaseInputArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([143, 190, 90, 218, 196, 30, 51, 222]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
  });
  return {
    programAddress: RAYDIUM_CPMM_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.ammConfig, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.outputTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.inputVault, role: AccountRole.WRITABLE },
      { address: accounts.outputVault, role: AccountRole.WRITABLE },
      { address: accounts.inputTokenProgram, role: AccountRole.READONLY },
      { address: accounts.outputTokenProgram, role: AccountRole.READONLY },
      { address: accounts.inputMint, role: AccountRole.READONLY },
      { address: accounts.outputMint, role: AccountRole.READONLY },
      { address: accounts.observationState, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
