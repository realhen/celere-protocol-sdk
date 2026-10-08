import type { Address } from "@solana/kit";
import { fail } from "./errors.js";
import type { AccountRequirement, AccountSnapshot, SnapshotAccount } from "./types.js";

/** Read supplied state only. Absence, unknown state, and unexpected owners fail explicitly. */
export function requireAccount(
  snapshot: AccountSnapshot,
  address: Address,
  role: string,
  expectedOwner?: Address,
): SnapshotAccount {
  const account = snapshot.accounts[address];
  if (account === undefined)
    fail({
      code: "MISSING_ACCOUNTS",
      message: `Missing ${role} account`,
      accounts: [{ address, role }],
    });
  if (account === null)
    fail({ code: "INVALID_ACCOUNT", message: `${role} account does not exist`, address });
  if (
    account.address !== address ||
    account.executable ||
    (expectedOwner !== undefined && account.owner !== expectedOwner)
  ) {
    fail({
      code: "INVALID_ACCOUNT",
      message: `Invalid ${role} account identity or owner`,
      address,
    });
  }
  return account;
}

/** Return unknown account observations without treating observed absence as unknown. */
export function missingAccounts(
  snapshot: AccountSnapshot,
  accounts: readonly AccountRequirement[],
): readonly AccountRequirement[] {
  return accounts.filter((account) => snapshot.accounts[account.address] === undefined);
}
