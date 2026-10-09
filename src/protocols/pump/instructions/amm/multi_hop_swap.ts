import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { PUMP_AMM_PROGRAM } from "../../constants.js";

const DISCRIMINATOR = new Uint8Array([43, 100, 73, 19, 233, 246, 111, 148]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minAmountOut", getU64Encoder()],
]);

/** A remaining-account group, in native route order. Curves use their canonical token ATAs. */
export interface PumpAmmMultiHopSwapHopAccounts {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly pool: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
}

/** Fixed native accounts plus five explicitly named accounts for each hop. */
export interface PumpAmmMultiHopSwapAccounts {
  readonly user: Address;
  readonly userInTokenAccount: Address;
  readonly userOutTokenAccount: Address;
  readonly globalConfig: Address;
  readonly feeConfig: Address;
  readonly userVolumeAccumulator: Address;
  readonly buybackFeeRecipient: Address;
  readonly tokenProgram: Address;
  readonly token2022Program: Address;
  readonly systemProgram: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
  readonly pumpProgram: Address;
  readonly pumpGlobal: Address;
  readonly pumpFeeConfig: Address;
  readonly pumpEventAuthority: Address;
  readonly hops: readonly PumpAmmMultiHopSwapHopAccounts[];
}

/** Atomic endpoint limits; the native route supports exact input only. */
export interface PumpAmmMultiHopSwapArgs {
  readonly amountIn: bigint;
  readonly minAmountOut: bigint;
}

/**
 * Build PumpSwap `multi_hop_swap` without quoting or validating account state.
 * @remarks Bytes 0–7 are the discriminator, 8–15 are `amountIn` (u64 little endian),
 * and 16–23 are `minAmountOut` (u64 little endian). Total length is 24 bytes.
 * Both user token accounts must exist when this instruction executes. A SOL curve at
 * the currency endpoint transfers native lamports while its WSOL account is only read
 * for the mint. No intermediate user token accounts are passed.
 * @throws Synchronous codec errors if an amount cannot be encoded.
 */
export function multi_hop_swap(
  accounts: PumpAmmMultiHopSwapAccounts,
  args: PumpAmmMultiHopSwapArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    amountIn: args.amountIn,
    minAmountOut: args.minAmountOut,
  });
  return {
    programAddress: PUMP_AMM_PROGRAM,
    accounts: [
      { address: accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.userInTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.userOutTokenAccount, role: AccountRole.WRITABLE },
      { address: accounts.globalConfig, role: AccountRole.READONLY },
      { address: accounts.feeConfig, role: AccountRole.READONLY },
      { address: accounts.userVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: accounts.buybackFeeRecipient, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.token2022Program, role: AccountRole.READONLY },
      { address: accounts.systemProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
      { address: accounts.pumpProgram, role: AccountRole.READONLY },
      { address: accounts.pumpGlobal, role: AccountRole.READONLY },
      { address: accounts.pumpFeeConfig, role: AccountRole.READONLY },
      { address: accounts.pumpEventAuthority, role: AccountRole.READONLY },
      ...accounts.hops.flatMap((hop) => [
        { address: hop.baseMint, role: AccountRole.READONLY },
        { address: hop.quoteMint, role: AccountRole.READONLY },
        { address: hop.pool, role: AccountRole.WRITABLE },
        { address: hop.baseVault, role: AccountRole.WRITABLE },
        { address: hop.quoteVault, role: AccountRole.WRITABLE },
      ]),
    ],
    data,
  };
}
