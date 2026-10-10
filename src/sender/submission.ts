import type { TransactionPartialSigner } from "@solana/kit";
import type { PrepareRequest } from "./transaction";
import type { SenderProvider } from "./providers/route";

/** Submission observations only: none of these indicate on-chain execution. */
export enum SubmissionStatus {
  /** The provider returned the locally expected signature; this is not confirmation. */
  Accepted = "accepted",
  /** The provider or HTTP endpoint explicitly rejected this submission. */
  Rejected = "rejected",
  /** Acceptance could not be established. The transaction may still reach the chain. */
  Unknown = "unknown",
  /** Cancellation was observed before this route attempted its HTTP request. */
  NotSubmitted = "not-submitted",
}

/** Optional controls shared by {@link SenderClient.send} and {@link SenderClient.submitSigned}. */
export interface SubmitSignedOptions {
  /**
   * Cancel signing/submission work. Cancellation before dispatch rejects the send;
   * cancellation during HTTP submission yields route observations. It cannot undo a transaction.
   */
  readonly signal?: AbortSignal;
  /**
   * Observe each route as its HTTP attempt settles. The callback receives the same result
   * included in {@link Submission.results}; it performs no on-chain tracking.
   * The sender does not await callback work and isolates thrown/rejected callback errors.
   */
  readonly onRouteResult?: (result: RouteResult) => void | Promise<void>;
}

/** Inputs for preparing and signing a send with caller-owned Kit partial signers. */
export type SendRequest = PrepareRequest &
  SubmitSignedOptions & {
    /**
     * Exactly one partial signer for every required address: fee payer, nonce authority,
     * and any instruction signers. Each signs the full variant batch without modifying messages.
     * Supply a shared payer/authority signer only once. No private keys are accepted directly.
     */
    readonly signers: readonly TransactionPartialSigner[];
  };

/** Local signature and immutable route assignment. Wire bytes are defensively copied. */
export interface SubmittedVariant {
  /** Locally derived fee-payer signature identifying this transaction on chain. */
  readonly signature: string;
  /** Client-assigned IDs of all lanes sharing this exact transaction. */
  readonly routeIds: readonly string[];
  /** Serialized signed transaction; copied so application changes cannot affect in-flight requests. */
  readonly wireBytes: Uint8Array;
}

/** One route's terminal transport result. Unknown means bytes may have reached the provider. */
export interface RouteResult {
  /** Automatically assigned lane identity, unique within this client. */
  readonly routeId: string;
  /** Optional label from the route configuration. */
  readonly routeName?: string;
  /** Provider serving this lane; several lanes may share the same provider. */
  readonly provider: SenderProvider;
  /** Locally derived fee-payer signature identifying this transaction on chain. */
  readonly signature: string;
  /** Transport observation only; never an on-chain execution status. */
  readonly status: SubmissionStatus;
  /** Milliseconds from beginning the route attempt to its terminal observation. */
  readonly elapsedMs: number;
  /** HTTP status when response headers were received; absent on earlier failures or cancellation. */
  readonly httpStatus?: number;
}

/** All routes have been launched when this is returned. Results never wait for chain confirmation. */
export interface Submission {
  /** Local signatures and wire bytes available as soon as every route has been launched. */
  readonly variants: readonly SubmittedVariant[];
  /**
   * Resolves in configured route order after all HTTP attempts settle. Individual provider
   * failures are values in this array, not promise rejections. Never waits for confirmation.
   */
  readonly results: Promise<readonly RouteResult[]>;
}
