import type { Address } from "@solana/kit";
import { InvalidAccountError, MissingAccountsError } from "../errors";

/** Immutable caller-observed account data. Slots record observations, not authenticity. */
export interface SnapshotAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly data: Uint8Array;
  readonly lamports: bigint;
  readonly executable: boolean;
  readonly slot: bigint;
}

/** No clock or RPC is consulted. Null means observed absent; a missing key is unknown. */
export interface AccountSnapshot {
  readonly slot: bigint;
  readonly epoch: bigint;
  readonly unixTimestamp: bigint;
  readonly accounts: Readonly<Record<string, SnapshotAccount | null>>;
}

/** A protocol-owned address discovery result, fulfilled by the consumer's data layer. */
export interface AccountRequirement {
  readonly address: Address;
  readonly role: string;
  readonly optional?: boolean;
}

/** Read supplied state only. Absence, unknown state, and unexpected owners fail explicitly. */
export function requireAccount(
  snapshot: AccountSnapshot,
  address: Address,
  role: string,
  expectedOwner?: Address,
): SnapshotAccount {
  const account = snapshot.accounts[address];
  if (account === undefined) {
    throw new MissingAccountsError({
      message: `Missing ${role} account`,
      accounts: [{ address, role }],
    });
  }

  if (account === null) {
    throw new InvalidAccountError({ message: `${role} account does not exist`, address });
  }

  if (
    account.address !== address ||
    account.executable ||
    (expectedOwner !== undefined && account.owner !== expectedOwner)
  ) {
    throw new InvalidAccountError({
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
