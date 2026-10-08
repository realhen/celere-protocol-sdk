import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  getU128Encoder,
  getU8Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_CLMM_PROGRAM } from "../../constants.js";

/** Named native accounts for CLMM swap; caller supplies and validates every address. */
export interface RaydiumClmmSwapAccounts {
  readonly owner: Address;
  readonly config: Address;
  readonly pool: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly inputVault: Address;
  readonly outputVault: Address;
  readonly observation: Address;
  readonly tickArrayBitmap: Address;
  /** Writable remaining tick arrays in native traversal order, before the bitmap. */
  readonly tickArrays: readonly Address[];
}

/** Native CLMM swap arguments; token amounts use atomic bigint units. */
export interface RaydiumClmmSwapArgs {
  readonly amount: bigint;
  readonly otherAmountThreshold: bigint;
  readonly sqrtPriceLimitX64: bigint;
  readonly isBaseInput: boolean;
}

const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amount", getU64Encoder()],
  ["otherAmountThreshold", getU64Encoder()],
  ["sqrtPriceLimitX64", getU128Encoder()],
  ["isBaseInput", getU8Encoder()],
]);

/**
 * Build the native CLMM swap instruction without network or signer access.
 * @remarks Data layout: 0–7 discriminator; 8–15 amount (u64 LE);
 * 16–23 otherAmountThreshold (u64 LE); 24–39 sqrtPriceLimitX64 (u128 LE);
 * 40 isBaseInput (u8 boolean). Total: 41 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * A zero sqrtPriceLimitX64 requires the program to fill the entire specified amount.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function getRaydiumClmmSwapInstruction(
  accounts: RaydiumClmmSwapAccounts,
  args: RaydiumClmmSwapArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([248, 198, 158, 145, 225, 117, 135, 200]),
    amount: args.amount,
    otherAmountThreshold: args.otherAmountThreshold,
    sqrtPriceLimitX64: args.sqrtPriceLimitX64,
    isBaseInput: args.isBaseInput ? 1 : 0,
  });
  return {
    programAddress: RAYDIUM_CLMM_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userInput, role: AccountRole.WRITABLE },
      { address: accounts.userOutput, role: AccountRole.WRITABLE },
      { address: accounts.inputVault, role: AccountRole.WRITABLE },
      { address: accounts.outputVault, role: AccountRole.WRITABLE },
      { address: accounts.observation, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      ...accounts.tickArrays.map((address) => ({
        address,
        role: AccountRole.WRITABLE,
      })),
      { address: accounts.tickArrayBitmap, role: AccountRole.READONLY },
    ],
    data,
  };
}
