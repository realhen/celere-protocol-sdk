import {
  getBase64Encoder,
  type Address,
  type Commitment,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { getSysvarClockDecoder, SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import { SwapBuildError } from "./core/errors";
import type { ProtocolSdk } from "./core/sdk";
import type {
  AccountSnapshot,
  SnapshotAccount,
  SwapBuild,
  SwapRequest,
} from "./core/types";

/** A swap intent whose account snapshot will be fetched through the supplied RPC. */
export type FetchSwapRequest = Omit<SwapRequest, "snapshot">;

/** Controls the explicit RPC reads performed by {@link fetchSwapInstructions}. */
export interface FetchSwapConfig {
  /** Commitment used for every discovery batch. Defaults to `confirmed`. */
  readonly commitment?: Commitment;
  /** Cancels account fetching and construction. No signing or submission occurs. */
  readonly abortSignal?: AbortSignal;
}

const MAX_ACCOUNT_BATCH_SIZE = 100;
const MAX_DISCOVERY_ROUNDS = 20;

/**
 * Resolve a swap through an existing offline SDK, fetching one coherent account batch per round.
 * @internal The root entrypoint supplies its built-in protocol registry.
 */
export async function fetchSwapWithSdk(
  sdk: ProtocolSdk,
  rpc: Rpc<GetMultipleAccountsApi>,
  intent: FetchSwapRequest,
  config: FetchSwapConfig = {},
): Promise<SwapBuild> {
  let snapshot: AccountSnapshot = {
    slot: 0n,
    epoch: 0n,
    unixTimestamp: 0n,
    accounts: {},
  };
  const addresses = new Set<Address>([SYSVAR_CLOCK_ADDRESS]);
  const decodeBase64 = getBase64Encoder();
  const clockDecoder = getSysvarClockDecoder();

  for (let round = 0; round <= MAX_DISCOVERY_ROUNDS; round++) {
    config.abortSignal?.throwIfAborted();
    const request = { ...intent, snapshot };
    const requirements = await sdk.getSwapRequirements(request);
    config.abortSignal?.throwIfAborted();
    if (!requirements.ok) throw new SwapBuildError(requirements.error);
    if (requirements.value.complete) {
      const result = await sdk.buildSwapInstructions(request);
      config.abortSignal?.throwIfAborted();
      if (!result.ok) throw new SwapBuildError(result.error);
      return result.value;
    }
    if (round === MAX_DISCOVERY_ROUNDS)
      throw new Error(
        "Swap account discovery exceeded 20 rounds; use the offline snapshot API for this request",
      );

    for (const account of requirements.value.accounts) addresses.add(account.address);
    // Splitting this batch would mix bank contexts and could produce an invalid quote.
    if (addresses.size > MAX_ACCOUNT_BATCH_SIZE)
      throw new Error(
        "Swap requires more than 99 accounts plus Clock; use the offline snapshot API with a coherent data source",
      );
    const keys = [...addresses];
    const response = await rpc
      .getMultipleAccounts(keys, {
        encoding: "base64",
        commitment: config.commitment ?? "confirmed",
        minContextSlot: snapshot.slot,
      })
      .send(config.abortSignal ? { abortSignal: config.abortSignal } : undefined);
    config.abortSignal?.throwIfAborted();
    if (response.value.length !== keys.length || response.context.slot < snapshot.slot)
      throw new Error(
        "RPC returned an incomplete account batch or an older bank context",
      );

    const accounts: Record<string, SnapshotAccount | null> = {};
    for (const [index, key] of keys.entries()) {
      const account = response.value[index];
      if (account === undefined) throw new Error("RPC omitted an account from its batch");
      accounts[key] =
        account === null
          ? null
          : {
              address: key,
              owner: account.owner,
              data: Uint8Array.from(decodeBase64.encode(account.data[0])),
              lamports: account.lamports,
              executable: account.executable,
              slot: response.context.slot,
            };
    }
    const clockAccount = accounts[SYSVAR_CLOCK_ADDRESS];
    if (!clockAccount) throw new Error("RPC did not return the Clock sysvar");
    const clock = clockDecoder.decode(clockAccount.data);
    snapshot = {
      accounts,
      slot: response.context.slot,
      epoch: clock.epoch,
      unixTimestamp: clock.unixTimestamp,
    };
  }
  throw new Error("Swap account discovery did not complete");
}
