import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { SUGAR_PROGRAM } from "../constants.js";

const DISCRIMINATOR = new Uint8Array([95, 200, 71, 34, 8, 9, 11, 166]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["bondingCurveBump", getU8Encoder()],
  ["solVaultBump", getU8Encoder()],
  ["maxTokensInput", getU64Encoder()],
  ["solAmountOutput", getU64Encoder()],
]);

/** Ordered accounts for native `sell_exact_out`. */
export interface SugarSellExactOutAccounts {
  readonly state: Address;
  readonly mint: Address;
  readonly bondingCurve: Address;
  readonly solVault: Address;
  readonly tokenVault: Address;
  readonly userTokenAccount: Address;
  readonly payer: Address;
  readonly receiver: Address;
  readonly feeReceiver: Address;
  readonly tokenProgram: Address;
  readonly associatedTokenProgram: Address;
  readonly systemProgram: Address;
  readonly rent: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/** Native PDA bumps and atomic amounts. SOL amounts are lamports. */
export interface SugarSellExactOutArgs {
  readonly bondingCurveBump: number;
  readonly solVaultBump: number;
  readonly maxTokensInput: bigint;
  readonly solAmountOutput: bigint;
}

/**
 * Historical interface: the current production deployment unconditionally rejects all calls.
 * Build native `sell_exact_out` without discovering or validating state.
 * @remarks Bytes 0–7: discriminator; byte 8: curve bump; byte 9: SOL vault bump;
 * bytes 10–17: `maxTokensInput`; bytes 18–25: `solAmountOutput`. Amounts are u64 LE; total 26 bytes.
 * Callers validate identities, PDAs, state, balances, and limits.
 * @throws Synchronous codec errors for unencodable arguments.
 */
export function sell_exact_out(
  accounts: SugarSellExactOutAccounts,
  args: SugarSellExactOutArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    bondingCurveBump: args.bondingCurveBump,
    solVaultBump: args.solVaultBump,
    maxTokensInput: args.maxTokensInput,
    solAmountOutput: args.solAmountOutput,
  });
  return {
    programAddress: SUGAR_PROGRAM,
    accounts: [
      { address: accounts.state, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.WRITABLE },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.solVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenVault, role: AccountRole.WRITABLE },
      { address: accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.receiver, role: AccountRole.WRITABLE },
      { address: accounts.feeReceiver, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.associatedTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.rent, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
