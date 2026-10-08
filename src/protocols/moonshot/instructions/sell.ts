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
import { MOONSHOT_PROGRAM } from "../constants.js";

const DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["tokenAmount", getU64Encoder()],
  ["collateralAmount", getU64Encoder()],
  ["fixedSide", getU8Encoder()],
  ["slippageBps", getU64Encoder()],
]);

/** Ordered account addresses for the native `sell` instruction. */
export interface MoonshotSellAccounts {
  readonly sender: Address;
  readonly senderTokenAccount: Address;
  readonly curveAccount: Address;
  readonly curveTokenAccount: Address;
  readonly dexFee: Address;
  readonly helioFee: Address;
  readonly mint: Address;
  readonly configAccount: Address;
  readonly tokenProgram: Address;
  readonly associatedTokenProgram: Address;
  readonly systemProgram: Address;
}

/** Atomic native amounts for `sell`; the caller validates state and limits. */
export interface MoonshotSellArgs {
  /** Token amount or token-side limit, in atomic token units. */
  readonly tokenAmount: bigint;
  /** Native SOL amount or SOL-side limit, in lamports. */
  readonly collateralAmount: bigint;
  /** Zero fixes input; one fixes output. The other amount is the already-rounded bound. */
  readonly fixedSide: 0 | 1;
}

/**
 * Build the native `sell` instruction without account discovery or validation.
 * @remarks
 * - Bytes 0–7: discriminator (8 bytes).
 * - Bytes 8–15: `tokenAmount` (u64 little endian).
 * - Bytes 16–23: `collateralAmount` (u64 little endian).
 * - Byte 24: `fixedSide` (u8).
 * - Bytes 25–32: `slippageBps` (u64 little endian).
 * Total data length: 33 bytes.
 * Native slippage is fixed to zero because the other amount already encodes the caller's minimum-output or maximum-input bound.
 * Callers validate account identities, PDAs, state, amounts and execution limits.
 * @throws Synchronous codec errors if an argument cannot be encoded.
 */
export function getMoonshotSellInstruction(
  accounts: MoonshotSellAccounts,
  args: MoonshotSellArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    tokenAmount: args.tokenAmount,
    collateralAmount: args.collateralAmount,
    fixedSide: args.fixedSide,
    slippageBps: 0n,
  });
  return {
    programAddress: MOONSHOT_PROGRAM,
    accounts: [
      { address: accounts.sender, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.senderTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.curveAccount, role: AccountRole.WRITABLE },
      { address: accounts.curveTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.dexFee, role: AccountRole.WRITABLE },
      { address: accounts.helioFee, role: AccountRole.WRITABLE },
      { address: accounts.mint, role: AccountRole.READONLY },
      { address: accounts.configAccount, role: AccountRole.READONLY },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.associatedTokenProgram, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
    ],
    data,
  };
}
