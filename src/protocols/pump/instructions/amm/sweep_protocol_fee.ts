import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_AMM_PROGRAM } from "../../constants.js";

/** Caller-resolved accounts for native `sweep_protocol_fee`; the payer funds any account rent. */
export interface PumpAmmSweepProtocolFeeAccounts {
  readonly payer: Address;
  readonly globalConfig: Address;
  readonly pool: Address;
  readonly quoteMint: Address;
  readonly quoteTokenProgram: Address;
  readonly poolQuoteTokenAccount: Address;
  readonly recipient: Address;
  readonly recipientTokenAccount: Address;
  readonly eventAuthority: Address;
}

/** Eight bytes: Anchor instruction discriminator [0, 8); there are no arguments. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
]);

/**
 * Build a permissionless native protocol fee sweep without fetching or signing.
 * @remarks The recipient must be a currently configured protocol fee recipient.
 * The caller validates all PDA, mint, and token-program relationships against current state.
 * Quote tokens move from the pool vault; the program may create the recipient ATA.
 * This moves accrued fees to their designated recipient; it does not claim them for the payer.
 * An empty fee bucket is a valid no-op. The payer signs and pays rent if needed.
 */
export function sweep_protocol_fee(
  accounts: PumpAmmSweepProtocolFeeAccounts,
): Instruction {
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.poolQuoteTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.recipient, role: AccountRole.READONLY },
      { address: accounts.recipientTokenAccount, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: PUMP_AMM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([8, 48, 190, 7, 182, 68, 183, 229]),
    }),
  };
}
