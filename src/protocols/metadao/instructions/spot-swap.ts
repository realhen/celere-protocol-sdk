import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU8Encoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { METADAO_PROGRAM } from "../constants.js";

/** Addresses in the native Futarchy v0.6 spot-swap account order. */
export interface MetadaoSpotSwapAccounts {
  readonly dao: Address;
  readonly userBaseAccount: Address;
  readonly userQuoteAccount: Address;
  readonly ammBaseVault: Address;
  readonly ammQuoteVault: Address;
  readonly user: Address;
  readonly eventAuthority: Address;
}

/** Atomic input and minimum output amounts; buy spends quote, sell spends base. */
export interface MetadaoSpotSwapArgs {
  readonly amountIn: bigint;
  readonly direction: "buy" | "sell";
  readonly minimumAmountOut: bigint;
}

/** 25 bytes: discriminator [0,8), inputAmount LE [8,16), swapType [16,17), minOutputAmount LE [17,25). */
const spotSwapEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["inputAmount", getU64Encoder()],
  ["swapType", getU8Encoder()],
  ["minOutputAmount", getU64Encoder()],
]);

/**
 * Builds the raw native spot-swap instruction without reading or validating pool state.
 * @remarks The caller validates PDA relationships, state, balances and slippage. No
 * signer implementation is attached. The amount fields use atomic token units.
 * @throws Synchronously if an atomic amount cannot be encoded as an unsigned u64.
 */
export function getMetadaoSpotSwapInstruction(
  accounts: MetadaoSpotSwapAccounts,
  args: MetadaoSpotSwapArgs,
): Instruction {
  return {
    programAddress: METADAO_PROGRAM,
    accounts: [
      { address: accounts.dao, role: AccountRole.WRITABLE },
      { address: accounts.userBaseAccount, role: AccountRole.WRITABLE },
      { address: accounts.userQuoteAccount, role: AccountRole.WRITABLE },
      { address: accounts.ammBaseVault, role: AccountRole.WRITABLE },
      { address: accounts.ammQuoteVault, role: AccountRole.WRITABLE },
      { address: accounts.user, role: AccountRole.READONLY_SIGNER },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: METADAO_PROGRAM, role: AccountRole.READONLY },
    ],
    data: spotSwapEncoder.encode({
      discriminator: new Uint8Array([167, 97, 12, 231, 237, 78, 166, 251]),
      inputAmount: args.amountIn,
      swapType: args.direction === "buy" ? 0 : 1,
      minOutputAmount: args.minimumAmountOut,
    }),
  };
}
