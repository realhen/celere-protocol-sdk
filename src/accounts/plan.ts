import type { Instruction } from "@solana/kit";
import { fail } from "../core/errors.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../core/types.js";
import {
  associatedTokenAddress,
  createAssociatedTokenInstruction,
  readMint,
  readTokenAccount,
} from "./tokens.js";

/** Discover common mint and token-account inputs without fetching them. */
export async function tokenRequirements(
  request: SwapRequest,
  adapter: ProtocolAdapter,
): Promise<readonly AccountRequirement[]> {
  const kinds = adapter.tokenAccountKinds?.(request) ?? { input: "spl", output: "spl" };
  const result: AccountRequirement[] = [];
  for (const side of ["input", "output"] as const) {
    if (kinds[side] === "nativeSol") continue;
    const mint = side === "input" ? request.inputMint : request.outputMint;
    result.push({ address: mint, role: `${side} mint` });
    if (request.snapshot.accounts[mint] === undefined) continue;
    const info = readMint(request.snapshot, mint);
    const account =
      request.tokenAccounts?.[side] ??
      (await associatedTokenAddress(request.owner, mint, info.tokenProgram));
    result.push({ address: account, role: `${side} token account` });
  }
  return result;
}

/** Preserve caller-owned accounts; only create an observed-absent output ATA, never close one. */
export async function planTokenAccounts(
  request: SwapRequest,
  adapter: ProtocolAdapter,
): Promise<{ accounts: ResolvedTokenAccounts; setup: readonly Instruction[] }> {
  const kinds = adapter.tokenAccountKinds?.(request) ?? { input: "spl", output: "spl" };
  const result = { input: request.owner, output: request.owner };
  const setup: Instruction[] = [];
  for (const side of ["input", "output"] as const) {
    if (kinds[side] === "nativeSol") continue;
    const mint = side === "input" ? request.inputMint : request.outputMint;
    const info = readMint(request.snapshot, mint);
    const ata = await associatedTokenAddress(request.owner, mint, info.tokenProgram);
    const account = request.tokenAccounts?.[side] ?? ata;
    result[side] = account;
    const observation = request.snapshot.accounts[account];
    if (observation === undefined)
      fail({
        code: "MISSING_ACCOUNTS",
        message: "Token account observation is required",
        accounts: [{ address: account, role: `${side} token account` }],
      });
    if (observation === null) {
      if (side === "input" || account !== ata)
        fail({
          code: "INVALID_ACCOUNT",
          address: account,
          message: "Input and custom token accounts must already exist",
        });
      setup.push(
        createAssociatedTokenInstruction(
          request.payer,
          request.owner,
          mint,
          info.tokenProgram,
          ata,
        ),
      );
    } else {
      readTokenAccount(request.snapshot, account, mint, info.tokenProgram, request.owner);
    }
  }
  return { accounts: result, setup };
}
