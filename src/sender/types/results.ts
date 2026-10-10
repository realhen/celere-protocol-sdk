import type { Transaction, TransactionWithLifetime } from "@solana/kit";
import type { SenderProvider } from "./providers.js";

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

/** Transaction and assigned route IDs; regional lanes can share one variant. */
export interface PreparedVariant {
  /** Unsigned transaction with required signature slots and explicit lifetime metadata. */
  readonly transaction: Transaction & TransactionWithLifetime;
  /** Client-assigned IDs of all lanes sharing this exact transaction. */
  readonly routeIds: readonly string[];
}

/** Prepared plans belong to the client that created them. Retain for external signing. */
export interface PreparedSubmission {
  /** Distinct unsigned variants in the order expected by external signing and submission. */
  readonly variants: readonly PreparedVariant[];
}

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
