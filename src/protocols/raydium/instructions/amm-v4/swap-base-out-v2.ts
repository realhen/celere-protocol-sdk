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

/** Named native accounts for AMM v4 swap_base_out_v2; caller supplies and validates every address. */
export interface RaydiumAmmV4SwapBaseOutV2Accounts {
  readonly pool: Address;
  readonly authority: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly userInput: Address;
  readonly userOutput: Address;
  readonly owner: Address;
}

/** Native AMM v4 swap_base_out_v2 arguments; token amounts use atomic bigint units. */
export interface RaydiumAmmV4SwapBaseOutV2Args {
  readonly maximumAmountIn: bigint;
  readonly amountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["tag", getU8Encoder()],
  ["maximumAmountIn", getU64Encoder()],
  ["amountOut", getU64Encoder()],
]);

/**
 * Build the native AMM v4 swap_base_out_v2 instruction without network or signer access.
 * @remarks Data layout: 0 tag (u8); 1–8 maximumAmountIn (u64 LE);
 * 9–16 amountOut (u64 LE). Total: 17 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function getRaydiumAmmV4SwapBaseOutV2Instruction(
  accounts: RaydiumAmmV4SwapBaseOutV2Accounts,
  args: RaydiumAmmV4SwapBaseOutV2Args,
): Instruction {
  const data = dataEncoder.encode({
    tag: 17,
    maximumAmountIn: args.maximumAmountIn,
    amountOut: args.amountOut,
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
