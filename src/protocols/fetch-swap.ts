import {
  getBase64Encoder,
  type Address,
  type Commitment,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { getSysvarClockDecoder, SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import type { ProtocolSdk } from "./sdk";
import type { AccountSnapshot, SnapshotAccount, SwapBuild, SwapRequest } from "./types";

/** A swap intent whose account snapshot will be fetched through the supplied RPC. */
export type FetchSwapRequest = Omit<SwapRequest, "snapshot">;

/** Controls the explicit RPC reads performed by {@link fetchSwapInstructions}. */
export interface FetchSwapConfig {
  /** Commitment used for every discovery batch. Defaults to `confirmed`. */
  readonly commitment?: Commitment;
  /** Cancels account fetching and construction. No signing or submission occurs. */
  readonly abortSignal?: AbortSignal;
}

/** Account discovery exceeded a supported bound or received an incoherent RPC batch. */
export class SwapAccountFetchError extends Error {
  /** @param message - Explanation of the discovery bound or invalid account response. */
  constructor(message: string) {
    super(message);
    this.name = "SwapAccountFetchError";
  }
}

const MAX_ACCOUNT_BATCH_SIZE = 100;
const MAX_DISCOVERY_ROUNDS = 20;

/**
 * Resolve a swap through an existing offline SDK, fetching one coherent account batch per round.
 * @throws Protocol and request error subclasses from the offline SDK, with their
 * metadata preserved directly on the error. RPC, cancellation, and unexpected
 * adapter errors propagate unchanged. Invalid RPC batches and discovery limits
 * raise {@link SwapAccountFetchError}.
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
    if (requirements.complete) {
      const result = await sdk.buildSwapInstructions(request);
      config.abortSignal?.throwIfAborted();
      return result;
    }
    if (round === MAX_DISCOVERY_ROUNDS) {
      throw new SwapAccountFetchError(
        "Swap account discovery exceeded 20 rounds; use the offline snapshot API for this request",
      );
    }

    for (const account of requirements.accounts) {
      addresses.add(account.address);
    }
    // Splitting this batch would mix bank contexts and could produce an invalid quote.
    if (addresses.size > MAX_ACCOUNT_BATCH_SIZE) {
      throw new SwapAccountFetchError(
        "Swap requires more than 99 accounts plus Clock; use the offline snapshot API with a coherent data source",
      );
    }
    const keys = [...addresses];
    const response = await rpc
      .getMultipleAccounts(keys, {
        encoding: "base64",
        commitment: config.commitment ?? "confirmed",
        minContextSlot: snapshot.slot,
      })
      .send(config.abortSignal ? { abortSignal: config.abortSignal } : undefined);
    config.abortSignal?.throwIfAborted();
    if (response.value.length !== keys.length || response.context.slot < snapshot.slot) {
      throw new SwapAccountFetchError(
        "RPC returned an incomplete account batch or an older bank context",
      );
    }

    const accounts: Record<string, SnapshotAccount | null> = {};
    for (const [index, key] of keys.entries()) {
      const account = response.value[index];
      if (account === undefined) {
        throw new SwapAccountFetchError("RPC omitted an account from its batch");
      }
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
    if (!clockAccount) {
      throw new SwapAccountFetchError("RPC did not return the Clock sysvar");
    }
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
