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

/** Named native accounts for CPMM swap_base_output; caller supplies and validates every address. */
export interface RaydiumCpmmSwapBaseOutputAccounts {
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

/** Native CPMM swap_base_output arguments; token amounts use atomic bigint units. */
export interface RaydiumCpmmSwapBaseOutputArgs {
  readonly maximumAmountIn: bigint;
  readonly amountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
]);

/**
 * Build the native CPMM swap_base_output instruction without network or signer access.
 * @remarks Data layout: 0–7 discriminator; 8–15 maximumAmountIn (u64 LE);
 * 16–23 amountOut (u64 LE). Total: 24 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function swap_base_output(
  accounts: RaydiumCpmmSwapBaseOutputAccounts,
  args: RaydiumCpmmSwapBaseOutputArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([55, 217, 98, 86, 163, 74, 180, 173]),
    maximumAmountIn: args.maximumAmountIn,
    amountOut: args.amountOut,
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
