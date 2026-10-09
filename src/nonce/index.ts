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
  readonly slot: bigint;
}
/** One-shot discovery inputs; the RPC must support System Program account scans. */
export interface DiscoverNonceAccountsRequest {
  readonly rpc: Rpc<GetProgramAccountsApi>;
  readonly authority: Address;
  readonly commitment?: Commitment;
  readonly signal?: AbortSignal;
}
/**
 * Find initialized current-version nonce accounts for an authority using getProgramAccounts.
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
      /* Filter matches are candidates, not proof of a valid nonce layout. */
    }
  }
  return result;
}
