import type { Address, Instruction } from "@solana/kit";
import { InvalidAccountError, MissingAccountsError } from "../errors";

import type { AccountRequirement, SwapRequest } from "../types";
import {
  associatedTokenAddress,
  createAssociatedTokenInstruction,
  readMint,
  readTokenAccount,
} from "./tokens";

/** Resolved token-account addresses; setup instructions are owned by the shared planner. */
export interface ResolvedTokenAccounts {
  readonly input: Address;
  readonly output: Address;
}

/** Settlement at each endpoint determines whether a token account is required. */
export interface TokenAccountKinds {
  readonly input: "nativeSol" | "spl";
  readonly output: "nativeSol" | "spl";
}

/** Only endpoint identities and account observations are needed for account planning. */
type TokenAccountRequest = Pick<
  SwapRequest,
  "owner" | "payer" | "inputMint" | "outputMint" | "snapshot" | "tokenAccounts"
>;

/** Discover common mint and token-account inputs without fetching them. */
export async function tokenRequirements(
  request: TokenAccountRequest,
  kinds: TokenAccountKinds = { input: "spl", output: "spl" },
): Promise<readonly AccountRequirement[]> {
  const result: AccountRequirement[] = [];
  for (const side of ["input", "output"] as const) {
    if (kinds[side] === "nativeSol") {
      continue;
    }

    const mint = side === "input" ? request.inputMint : request.outputMint;
    result.push({ address: mint, role: `${side} mint` });
    if (request.snapshot.accounts[mint] === undefined) {
      continue;
    }

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
  request: TokenAccountRequest,
  kinds: TokenAccountKinds = { input: "spl", output: "spl" },
): Promise<{ accounts: ResolvedTokenAccounts; setup: readonly Instruction[] }> {
  const result = { input: request.owner, output: request.owner };
  const setup: Instruction[] = [];
  for (const side of ["input", "output"] as const) {
    if (kinds[side] === "nativeSol") {
      continue;
    }

    const mint = side === "input" ? request.inputMint : request.outputMint;
    const info = readMint(request.snapshot, mint);
    const ata = await associatedTokenAddress(request.owner, mint, info.tokenProgram);
    const account = request.tokenAccounts?.[side] ?? ata;
    result[side] = account;
    const observation = request.snapshot.accounts[account];
    if (observation === undefined) {
      throw new MissingAccountsError({
        message: "Token account observation is required",
        accounts: [{ address: account, role: `${side} token account` }],
      });
    }

    if (observation === null) {
      if (side === "input" || account !== ata) {
        throw new InvalidAccountError({
          address: account,
          message: "Input and custom token accounts must already exist",
        });
      }

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
