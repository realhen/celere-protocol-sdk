import { getBase64Encoder } from "@solana/kit";
import type {
  Address,
  Base58EncodedBytes,
  Commitment,
  GetProgramAccountsApi,
  Rpc,
} from "@solana/kit";
import {
  getNonceDecoder,
  getNonceSize,
  NonceState,
  NonceVersion,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import type { DurableNonce } from "../transactions/index.js";

/** Validated nonce account snapshot. Discovery cannot establish exclusive use or absence of pending transactions. */
export interface DiscoveredNonce extends DurableNonce {
  /** RPC context slot at which these nonce bytes were observed; not a reservation. */
  readonly slot: bigint;
}
/** One-shot discovery inputs; the RPC must support System Program account scans. */
export interface DiscoverNonceAccountsRequest {
  /** Kit RPC client supporting getProgramAccounts with context and base64 encoding. */
  readonly rpc: Rpc<GetProgramAccountsApi>;
  /** Wallet or other signer authorized to advance the nonce accounts being discovered. */
  readonly authority: Address;
  /** Commitment of the observation. Uses Kit's string union; defaults to "confirmed". */
  readonly commitment?: Commitment;
  /** Optional signal to cancel this one RPC scan. */
  readonly signal?: AbortSignal;
}
/**
 * Find initialized current-version nonce accounts for an authority using getProgramAccounts.
 *
 * @param request - RPC client, nonce authority, and optional commitment/cancellation.
 * @returns Current-version initialized nonce snapshots matching the authority, including
 * their RPC context slot. An empty list means the successful scan found no valid candidates.
 * @throws Rejects with the RPC/transport error if the scan is unsupported, fails, or is cancelled.
 *
 * @example
 * ```ts
 * import { createSolanaRpc, type Address } from "@solana/kit";
 * import { discoverNonceAccounts } from "celere-protocol-sdk/nonce";
 *
 * declare const rpcUrl: string;
 * declare const authority: Address;
 * const rpc = createSolanaRpc(rpcUrl);
 * const nonces = await discoverNonceAccounts({ rpc, authority, commitment: "confirmed" });
 * // The application decides which current nonce it can exclusively use for this trade.
 * ```
 *
 * @remarks No subscriptions or reservation state are created. The caller owns freshness and nonce selection.
 * Provider RPC errors propagate; an unsupported scan is never reported as an empty wallet.
 */
export async function discoverNonceAccounts(
  request: DiscoverNonceAccountsRequest,
): Promise<readonly DiscoveredNonce[]> {
  const response = await request.rpc
    .getProgramAccounts(SYSTEM_PROGRAM_ADDRESS, {
      encoding: "base64",
      commitment: request.commitment ?? "confirmed",
      withContext: true,
      filters: [
        { dataSize: BigInt(getNonceSize()) },
        {
          memcmp: {
            offset: 8n,
            bytes: request.authority as unknown as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send(request.signal ? { abortSignal: request.signal } : undefined);
  const result: DiscoveredNonce[] = [];
  for (const { pubkey, account } of response.value) {
    if (account.owner !== SYSTEM_PROGRAM_ADDRESS || account.executable) continue;
    try {
      const bytes = getBase64Encoder().encode(account.data[0]);
      if (bytes.length !== getNonceSize()) continue;
      const data = getNonceDecoder().decode(bytes);
      if (
        data.version !== NonceVersion.Current ||
        data.state !== NonceState.Initialized ||
        data.authority !== request.authority
      )
        continue;
      result.push({
        account: pubkey,
        authority: data.authority,
        value: data.blockhash,
        slot: response.context.slot,
      });
    } catch {
      // Filter matches are candidates, not proof of a valid nonce layout.
    }
  }
  return result;
}
