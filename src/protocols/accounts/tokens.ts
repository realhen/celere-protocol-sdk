import { InvalidAccountError, UnsupportedTokenExtensionError } from "../errors";
import {
  TOKEN_PROGRAM_ADDRESS as TOKEN_PROGRAM,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintSize,
  getTokenSize,
} from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ADDRESS as TOKEN_2022_PROGRAM,
  AccountState,
  getMintDecoder,
  getTokenDecoder,
  type Extension,
} from "@solana-program/token-2022";
import {
  address,
  createNoopSigner,
  isSolanaError,
  unwrapOption,
  SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH,
} from "@solana/kit";
import type { Address, Decoder, Instruction, Option } from "@solana/kit";

import { requireAccount } from "./snapshot";
import type { AccountSnapshot, SnapshotAccount } from "./snapshot";

export { TOKEN_PROGRAM, TOKEN_2022_PROGRAM };
/**
 * Wrapped SOL mint. Native-only adapters report nativeSol asset semantics explicitly.
 * @remarks The official Token client does not export the native mint address.
 */
export const WRAPPED_SOL_MINT = address("So11111111111111111111111111111111111111112");
/** Token-2022 native SOL mint; the pinned official Token-2022 client does not export it. */
export const TOKEN_2022_NATIVE_MINT = address(
  "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
);

/** Mint fields needed by common instruction construction; no third-party SDK objects. */
export interface MintInfo {
  readonly tokenProgram: Address;
  readonly decimals: number;
  readonly supply: bigint;
}

// Token-2022 decoders also handle the extension-free base layouts of classic tokens.
const mintDecoder = getMintDecoder();
const tokenDecoder = getTokenDecoder();
// Use codec kinds: the pinned client's numeric ExtensionType enum is not wire-aligned.
const supportedMintExtensions: ReadonlySet<Extension["__kind"]> = new Set([
  "MetadataPointer",
  "TokenMetadata",
]);
const supportedAccountExtensions: ReadonlySet<Extension["__kind"]> = new Set([
  "ImmutableOwner",
]);

/** Translate malformed account bytes into the SDK's account error; preserve unexpected failures. */
function decodeTokenState<T extends { extensions: Option<Extension[]> }>(
  account: SnapshotAccount,
  decoder: Decoder<T>,
): T {
  try {
    return decoder.decode(account.data);
  } catch (error) {
    if (!isSolanaError(error)) {
      throw error;
    }

    // The pinned decoder reads padding as two-byte Uninitialized entries. Complete
    // a lone zero byte only when decoding proves it is padding, not extension data.
    if (
      isSolanaError(error, SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH) &&
      error.context.bytesLength === 1 &&
      error.context.expected === 2 &&
      account.data.at(-1) === 0
    ) {
      const padded = new Uint8Array(account.data.length + 1);
      padded.set(account.data);

      try {
        const state = decoder.decode(padded);
        if (unwrapOption(state.extensions, () => []).at(-1)?.__kind === "Uninitialized") {
          return state;
        }
      } catch (paddingError) {
        if (!isSolanaError(paddingError)) {
          throw paddingError;
        }
      }
    }

    throw new InvalidAccountError({
      address: account.address,
      message: "Malformed token account data or extension encoding",
    });
  }
}

/** Apply SDK support policy to officially decoded extensions, without interpreting TLV bytes. */
function validateExtensions(
  account: SnapshotAccount,
  mint: Address,
  extensions: Option<Extension[]>,
  allowed: ReadonlySet<Extension["__kind"]>,
): void {
  const seen = new Set<Extension["__kind"]>();
  let padding = false;

  for (const extension of unwrapOption(extensions, () => [])) {
    // The official decoder exposes unused trailing TLV space as Uninitialized entries.
    if (extension.__kind === "Uninitialized") {
      padding = true;
      continue;
    }

    if (padding || seen.has(extension.__kind)) {
      throw new InvalidAccountError({
        address: account.address,
        message: "Duplicate token extension or extension after uninitialized padding",
      });
    }

    if (!allowed.has(extension.__kind)) {
      throw new UnsupportedTokenExtensionError({
        message: "Token extension is not qualified for this release",
        mint,
        extension: extension.__kind,
      });
    }

    seen.add(extension.__kind);
  }
}

/** Decode initialized mint state and reject extensions with unimplemented transfer semantics. */
export function readMint(snapshot: AccountSnapshot, mint: Address): MintInfo {
  const account = requireAccount(snapshot, mint, "mint");
  if (account.owner !== TOKEN_PROGRAM && account.owner !== TOKEN_2022_PROGRAM) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid token mint program",
    });
  }

  if (account.owner === TOKEN_PROGRAM && account.data.length !== getMintSize()) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid classic token mint size",
    });
  }

  const state = decodeTokenState(account, mintDecoder);
  if (!state.isInitialized) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Uninitialized token mint",
    });
  }

  validateExtensions(account, mint, state.extensions, supportedMintExtensions);

  return {
    tokenProgram: account.owner,
    decimals: state.decimals,
    supply: state.supply,
  };
}

/** Validate initialized token account, mint, program, and optional debit authority. */
export function readTokenAccount(
  snapshot: AccountSnapshot,
  accountAddress: Address,
  mint: Address,
  tokenProgram: Address,
  expectedAuthority?: Address,
): { readonly amount: bigint; readonly authority: Address } {
  const account = requireAccount(snapshot, accountAddress, "token", tokenProgram);
  if (tokenProgram !== TOKEN_PROGRAM && tokenProgram !== TOKEN_2022_PROGRAM) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid token account program",
    });
  }

  if (tokenProgram === TOKEN_PROGRAM && account.data.length !== getTokenSize()) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Invalid classic token account size",
    });
  }

  const state = decodeTokenState(account, tokenDecoder);
  if (state.state !== AccountState.Initialized) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Token account is uninitialized or frozen",
    });
  }

  if (
    state.mint !== mint ||
    (expectedAuthority !== undefined && state.owner !== expectedAuthority)
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Token account mint or authority mismatch",
    });
  }

  validateExtensions(account, mint, state.extensions, supportedAccountExtensions);

  return { amount: state.amount, authority: state.owner };
}

/** Derive an ATA locally. No key generation, wallet access, or network request occurs. */
export async function associatedTokenAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });

  return ata;
}

/** Idempotent ATA creation; callers supply payer authorization when signing later. */
export function createAssociatedTokenInstruction(
  payer: Address,
  owner: Address,
  mint: Address,
  tokenProgram: Address,
  ata: Address,
): Instruction {
  const instruction = getCreateAssociatedTokenIdempotentInstruction({
    payer: createNoopSigner(payer),
    owner,
    mint,
    tokenProgram,
    ata,
  });

  // Keep signer roles, but omit the library's signer object from our portable output.
  return {
    programAddress: instruction.programAddress,
    accounts: instruction.accounts.map(({ address, role }) => ({ address, role })),
    data: instruction.data,
  };
}
