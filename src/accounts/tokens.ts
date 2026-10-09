import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_PROGRAM } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS as ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_PROGRAM_ADDRESS as TOKEN_PROGRAM,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionDataEncoder,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS as TOKEN_2022_PROGRAM } from "@solana-program/token-2022";
import { address, getAddressDecoder, AccountRole } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { fail } from "../core/errors.js";
import { requireAccount } from "../core/snapshot.js";
import type { AccountSnapshot, SnapshotAccount } from "../core/types.js";

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
const addressDecoder = getAddressDecoder();

/** Mint fields needed by common instruction construction; no third-party SDK objects. */
export interface MintInfo {
  readonly tokenProgram: Address;
  readonly decimals: number;
  readonly supply: bigint;
}

function invalid(account: SnapshotAccount, message: string): never {
  return fail({ code: "INVALID_ACCOUNT", address: account.address, message });
}

function tokenExtensions(
  account: SnapshotAccount,
  mint: Address,
  accountType: number,
  allowed: ReadonlySet<number>,
): void {
  if (account.data.length === (accountType === 1 ? 82 : 165)) return;
  if (account.data.length < 166 || account.data[165] !== accountType)
    invalid(account, "Invalid Token-2022 account type or size");
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  const seen = new Set<number>();
  let offset = 166;
  while (offset < account.data.length) {
    if (account.data.subarray(offset).every((byte) => byte === 0)) break;
    if (offset + 4 > account.data.length)
      invalid(account, "Truncated Token-2022 extension header");
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (offset + 4 + length > account.data.length || seen.has(type))
      invalid(account, "Invalid Token-2022 extension length or duplicate");
    if (!allowed.has(type))
      fail({
        code: "UNSUPPORTED_TOKEN_EXTENSION",
        message: "Token extension is not qualified for this release",
        mint,
        extension: String(type),
      });
    seen.add(type);
    offset += 4 + length;
  }
}

/** Decode initialized mint state and reject extensions with unimplemented transfer semantics. */
export function readMint(snapshot: AccountSnapshot, mint: Address): MintInfo {
  const account = requireAccount(snapshot, mint, "mint");
  if (
    (account.owner !== TOKEN_PROGRAM && account.owner !== TOKEN_2022_PROGRAM) ||
    account.data.length < 82 ||
    account.data[45] !== 1
  )
    invalid(account, "Invalid or uninitialized token mint");
  if (account.owner === TOKEN_PROGRAM && account.data.length !== 82)
    invalid(account, "Invalid classic token mint size");
  if (account.owner === TOKEN_2022_PROGRAM)
    tokenExtensions(account, mint, 1, new Set([18, 19]));
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  return {
    tokenProgram: account.owner,
    decimals: account.data[44]!,
    supply: view.getBigUint64(36, true),
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
  if (account.data.length < 165 || account.data[108] !== 1)
    invalid(account, "Token account is uninitialized, frozen, or malformed");
  const actualMint = addressDecoder.decode(account.data.subarray(0, 32));
  const authority = addressDecoder.decode(account.data.subarray(32, 64));
  if (
    actualMint !== mint ||
    (expectedAuthority !== undefined && authority !== expectedAuthority)
  )
    invalid(account, "Token account mint or authority mismatch");
  if (tokenProgram === TOKEN_PROGRAM && account.data.length !== 165)
    invalid(account, "Invalid classic token account size");
  if (tokenProgram === TOKEN_2022_PROGRAM)
    tokenExtensions(account, mint, 2, new Set([7]));
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  return { amount: view.getBigUint64(64, true), authority };
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
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: getCreateAssociatedTokenIdempotentInstructionDataEncoder().encode({}),
  };
}
