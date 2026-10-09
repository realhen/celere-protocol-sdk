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
import { PUMP_PROGRAM } from "../../constants.js";

/** Accounts required by Pump bonding curve’s native `sweep_creator_fee` instruction. */
export interface PumpSweepCreatorFeeAccounts {
  readonly payer: Address;
  readonly global: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly quoteTokenProgram: Address;
  readonly bondingCurve: Address;
  readonly associatedQuoteBondingCurve: Address;
  readonly recipient: Address;
  readonly associatedQuoteRecipient: Address;
  readonly eventAuthority: Address;
}

/** Encodes the native `sweep_creator_fee` discriminator; the instruction takes no arguments. */
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
]);

/**
 * Creates a permissionless Pump bonding curve instruction to sweep accrued creator fees.
 *
 * Accounts are supplied by the caller. This function performs no fetching,
 * address derivation, quoting, signing, or transaction submission.
 *
 * @param accounts - Accounts required by the native instruction.
 * @returns An unsigned instruction to include in a transaction.
 *
 * @example
 * Build a sweep to the designated fee recipient, using accounts resolved by the caller.
 *
 * ```ts
 * import {
 *   sweep_creator_fee,
 *   type PumpSweepCreatorFeeAccounts,
 * } from "celere-protocol-sdk/instructions/pump";
 *
 * // Resolve these accounts from your application's account data.
 * declare const accounts: PumpSweepCreatorFeeAccounts;
 *
 * const instruction = sweep_creator_fee(accounts);
 * ```
 *
 * @remarks
 * The recipient must be the current creator vault PDA. Anyone may pay for this
 * permissionless sweep, but accrued fees go to the designated recipient, not to the
 * payer. An empty fee bucket is a valid no-op. The payer signs and pays any
 * account-creation rent. SOL markets transfer native lamports; token-quoted markets
 * transfer quote tokens and may create the recipient ATA.
 *
 * @see {@link PumpSweepCreatorFeeAccounts}
 */
export function sweep_creator_fee(accounts: PumpSweepCreatorFeeAccounts): Instruction {
  return {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: accounts.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.global, role: AccountRole.READONLY },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteBondingCurve, role: AccountRole.WRITABLE },
      { address: accounts.recipient, role: AccountRole.WRITABLE },
      { address: accounts.associatedQuoteRecipient, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: PUMP_PROGRAM, role: AccountRole.READONLY },
    ],
    data: instructionDataEncoder.encode({
      discriminator: new Uint8Array([32, 246, 191, 52, 8, 201, 73, 186]),
    }),
  };
}
