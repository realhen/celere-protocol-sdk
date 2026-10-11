import { Buffer } from "node:buffer";
import type { Address, createSolanaRpc } from "@solana/kit";
import { getSysvarClockDecoder, SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import {
  getSwapRequirements,
  type AccountSnapshot,
  type Result,
  type SwapRequest,
} from "celere-protocol-sdk";

export type Rpc = ReturnType<typeof createSolanaRpc>;

/** Convert an SDK failure into an application error without hiding its stable code. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * Discover dependencies in rounds, then supply one coherent RPC observation.
 * Every round refetches all known accounts together with the chain Clock sysvar.
 * Null records observed absence (for example, an output ATA the SDK will create).
 */
export async function fetchBuyRequest(
  rpc: Rpc,
  intent: Omit<SwapRequest, "snapshot">,
): Promise<SwapRequest> {
  let snapshot: AccountSnapshot = {
    slot: 0n,
    epoch: 0n,
    unixTimestamp: 0n,
    accounts: {},
  };
  const addresses = new Set<Address>([SYSVAR_CLOCK_ADDRESS]);
  for (let round = 0; round < 20; round++) {
    const request = { ...intent, snapshot };
    const requirements = unwrap(await getSwapRequirements(request));
    if (requirements.complete) return request;
    for (const account of requirements.accounts) addresses.add(account.address);
    // One getMultipleAccounts call gives a single bank context. Larger buys that
    // need more bin arrays should use a dedicated data layer, rather than mix slots.
    if (addresses.size > 100)
      throw new Error("Buy needs more than 99 accounts; reduce its size.");
    const keys = [...addresses];
    const response = await rpc
      .getMultipleAccounts(keys, {
        encoding: "base64",
        commitment: "confirmed",
        minContextSlot: snapshot.slot,
      })
      .send();
    const accounts = Object.fromEntries(
      keys.map((key, index) => {
        const account = response.value[index];
        if (account === undefined)
          throw new Error("RPC returned an incomplete account batch");
        return [
          key,
          account === null
            ? null
            : {
                address: key,
                owner: account.owner,
                data: Buffer.from(account.data[0], "base64"),
                lamports: account.lamports,
                executable: account.executable,
                slot: response.context.slot,
              },
        ];
      }),
    );
    const clockAccount = accounts[SYSVAR_CLOCK_ADDRESS];
    if (!clockAccount) throw new Error("RPC did not return the Clock sysvar");
    const clock = getSysvarClockDecoder().decode(clockAccount.data);
    snapshot = {
      accounts,
      slot: response.context.slot,
      epoch: clock.epoch,
      unixTimestamp: clock.unixTimestamp,
    };
  }
  throw new Error(
    "Account discovery did not converge; retry with a fresh market snapshot.",
  );
}
