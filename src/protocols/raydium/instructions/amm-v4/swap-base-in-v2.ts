import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_AMM_V4_PROGRAM } from "../../constants.js";

/** Named native accounts for AMM v4 swap_base_in_v2; caller supplies and validates every address. */
export interface RaydiumAmmV4SwapBaseInV2Accounts {
  readonly pool: Address;
  readonly authority: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly owner: Address;
}

/** Native AMM v4 swap_base_in_v2 arguments; token amounts use atomic bigint units. */
export interface RaydiumAmmV4SwapBaseInV2Args {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["tag", getU8Encoder()],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
]);

/**
 * Build the native AMM v4 swap_base_in_v2 instruction without network or signer access.
 * @remarks Data layout: 0 tag (u8); 1–8 amountIn (u64 LE);
 * 9–16 minimumAmountOut (u64 LE). Total: 17 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function getRaydiumAmmV4SwapBaseInV2Instruction(
  accounts: RaydiumAmmV4SwapBaseInV2Accounts,
  args: RaydiumAmmV4SwapBaseInV2Args,
): Instruction {
  const data = dataEncoder.encode({
    tag: 16,
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
  });
  return {
    programAddress: RAYDIUM_AMM_V4_PROGRAM,
    accounts: [
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.vault0, role: AccountRole.WRITABLE },
      { address: accounts.vault1, role: AccountRole.WRITABLE },
      { address: accounts.userInput, role: AccountRole.WRITABLE },
      { address: accounts.userOutput, role: AccountRole.WRITABLE },
      { address: accounts.owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
