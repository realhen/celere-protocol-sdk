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

const DISCRIMINATOR = new Uint8Array([24, 211, 116, 40, 105, 3, 153, 56]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["bondingCurveBump", getU8Encoder()],
  ["solVaultBump", getU8Encoder()],
  ["maxSolAmountInput", getU64Encoder()],
  ["tokensOutput", getU64Encoder()],
]);

/** Ordered accounts for native `buy_exact_out`. */
export interface SugarBuyExactOutAccounts {
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
export interface SugarBuyExactOutArgs {
  readonly bondingCurveBump: number;
  readonly solVaultBump: number;
  readonly maxSolAmountInput: bigint;
  readonly tokensOutput: bigint;
}

/**
 * Historical interface: the current production deployment unconditionally rejects all calls.
 * Build native `buy_exact_out` without discovering or validating state.
 * @remarks Bytes 0–7: discriminator; byte 8: curve bump; byte 9: SOL vault bump;
 * bytes 10–17: `maxSolAmountInput`; bytes 18–25: `tokensOutput`. Amounts are u64 LE; total 26 bytes.
 * Callers validate identities, PDAs, state, balances, and limits.
 * @throws Synchronous codec errors for unencodable arguments.
 */
export function buy_exact_out(
  accounts: SugarBuyExactOutAccounts,
  args: SugarBuyExactOutArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    bondingCurveBump: args.bondingCurveBump,
    solVaultBump: args.solVaultBump,
    maxSolAmountInput: args.maxSolAmountInput,
    tokensOutput: args.tokensOutput,
  });
  return {
    programAddress: SUGAR_PROGRAM,
    accounts: [
      { address: accounts.state, role: AccountRole.READONLY },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.solVault, role: AccountRole.WRITABLE },
      { address: accounts.tokenVault, role: AccountRole.WRITABLE },
      { address: accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.receiver, role: AccountRole.READONLY },
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
