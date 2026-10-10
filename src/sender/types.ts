import type {
  Address,
  Instruction,
  TransactionPartialSigner,
  Transaction,
  TransactionWithLifetime,
} from "@solana/kit";
import type {
  BlockhashLifetime,
  DurableNonce,
  LookupTable,
} from "../transactions/index.js";

/**
 * Identifies a submission provider in route results and per-send tip overrides.
 * Multiple regional routes may use the same provider. The RPC route is added by the client.
 */
export enum SenderProvider {
  Rpc = "rpc",
  Astralane = "astralane",
  BlockRazor = "blockrazor",
  ZeroSlot = "zeroslot",
  NextBlock = "nextblock",
  Helius = "helius",
}
/** Actual endpoint regions. Unsupported provider/region combinations are rejected. */
export enum Region {
  Global = "global",
  Frankfurt = "frankfurt",
  Amsterdam = "amsterdam",
  NewYork = "new-york",
  London = "london",
  Tokyo = "tokyo",
  Singapore = "singapore",
  LosAngeles = "los-angeles",
  SaltLakeCity = "salt-lake-city",
  Dublin = "dublin",
  Vilnius = "vilnius",
  Toronto = "toronto",
}
/** Astralane's provisioned fee tier. Selecting a tier does not upgrade the provider account. */
export enum AstralaneTier {
  /** Free tier: minimum tip 1,000,000 lamports. */
  Free = "free",
  /** VIP 1: minimum tip 100,000 lamports. */
  Vip1 = "vip-1",
  /** VIP 2: minimum tip 100,000 lamports. */
  Vip2 = "vip-2",
  /** VIP 3: minimum tip 10,000 lamports. */
  Vip3 = "vip-3",
}
/** Helius product tier; each has its own minimum tip. */
export enum HeliusSenderMode {
  /** Sender Max: minimum tip 1,000,000 lamports and priority fee 5,000 lamports. */
  Max = "max",
  /** SWQoS-only: minimum tip 5,000 lamports. */
  SwqosOnly = "swqos-only",
}
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
/** Shared configuration accepted by provider classes. Creating a route performs no I/O. */
export interface RouteOptions {
  /** Optional application label, unique within a client; echoed in route results. */
  readonly name?: string;
  /** Provider credential. Route configurations contain secrets and should not be logged. */
  readonly apiKey: string;
  /** Provider-supported region; defaults to Global for Astralane/Helius and Frankfurt otherwise. */
  readonly region?: Region;
  /** Full HTTP(S) submission URL, including path. Overrides the selected region's endpoint. */
  readonly endpoint?: string;
  /** HTTP deadline in milliseconds, including response-body reading. Integer 1–60,000; default 3,000. */
  readonly timeoutMs?: number;
}

/** Serialized, verified transaction supplied to a provider's request encoder. */
export interface SenderTransactionPayload {
  /** Signed wire bytes; treat as readonly. */
  readonly bytes: Uint8Array;
  /** Base64 representation of the same signed bytes. */
  readonly base64: string;
  /** Locally verified fee-payer signature. */
  readonly signature: string;
}

/** A provider-encoded HTTP submission. URLs and headers may contain credentials. */
export interface SenderHttpRequest {
  /** Complete submission URL with authentication parameters, if required. */
  readonly url: string;
  /** POST body, headers and redirect policy; the shared transport adds cancellation. */
  readonly init: RequestInit;
}

/**
 * Common contract implemented by provider classes. Construction configures one regional lane.
 * Custom implementations are trusted application code: createRequest must encode the supplied
 * payload unchanged and must not submit it itself. The client owns concurrent HTTP dispatch.
 */
export interface SenderRoute {
  /** Provider identity used in observations and per-send tip overrides. */
  readonly provider: SenderProvider;
  /** Optional application label, unique within a client. */
  readonly name?: string;
  /** HTTP deadline in milliseconds, including response-body reading. */
  readonly timeoutMs: number;
  /** Minimum allowed per-send tip in lamports. */
  readonly minimumTipLamports: bigint;
  /** Minimum total priority fee in lamports, not micro-lamports per compute unit. */
  readonly minimumPriorityFeeLamports: bigint;
  /** Provider-approved SOL recipients; regional lanes share one selected recipient. */
  readonly tipAccounts: readonly Address[];
  /**
   * Encode a signed payload without performing I/O. Called once per route during dispatch.
   * @param payload - Verified transaction bytes, base64 and expected signature.
   * @returns Credential-bearing HTTP request; callers must not log it.
   */
  createRequest(payload: SenderTransactionPayload): SenderHttpRequest;
}

/** Per-send amounts. All monetary values are atomic bigint values. No automatic fee sampling. */
export interface SenderFees {
  /**
   * Requested compute units for the entire transaction, including setup, nonce, and tip
   * instructions. Integer 1–1,400,000. The sender does not simulate or estimate this value.
   */
  readonly computeUnitLimit: number;
  /**
   * Micro-lamports per requested compute unit, as a u64 bigint. Priority fee in lamports
   * is ceil(limit × price / 1,000,000). For example, 200,000 CUs at 50,000n costs 10,000 lamports.
   */
  readonly computeUnitPriceMicroLamports: bigint;
  /**
   * Tip in lamports for each provider variant, as a u64 bigint; 1,000,000n is 0.001 SOL.
   * The default RPC variant has no provider tip. Each route's minimum is checked before signing.
   */
  readonly tipLamports: bigint;
  /** Per-provider tip amounts in lamports, replacing tipLamports for all that provider's lanes. */
  readonly tipOverrides?: Readonly<
    Partial<Record<Exclude<SenderProvider, SenderProvider.Rpc>, bigint>>
  >;
}
/**
 * Inputs for local transaction compilation. Supply exactly one nonce or blockhash lifetime.
 *
 * The sender adds compute-budget instructions and provider tips; do not add a second
 * compute budget or nonce advance instruction. A blockhash lifetime is sufficient only
 * when there is a single variant. Distinct provider/RPC variants require a shared nonce.
 * The client neither fetches a lifetime nor falls back to RPC-only sending when a nonce is missing.
 */
export type PrepareRequest = {
  /** Ordered instructions from any protocol or other Kit-compatible source. At least one is required. */
  readonly instructions: readonly Instruction[];
  /** Address paying transaction fees and provider tips; its signature is required. */
  readonly feePayer: Address;
  /** Caller-observed address lookup contents. The nonce account always remains a static account. */
  readonly lookupTables?: readonly LookupTable[];
  /** Explicit per-send fees, including the complete transaction's compute-unit limit. */
  readonly fees: SenderFees;
} & (
  | {
      /** Current nonce snapshot exclusively selected by the application for this logical trade. */
      readonly nonce: DurableNonce;
      readonly lifetime?: never;
    }
  | {
      /** Recent blockhash and expiration height for a single-variant send. */
      readonly lifetime: BlockhashLifetime;
      readonly nonce?: never;
    }
);

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
/** Default RPC route, always submitted alongside the configured provider routes. */
export interface RpcRouteOptions {
  /** Full RPC URL. This endpoint receives the untipped variant. */
  readonly url: string;
  /** HTTP deadline in milliseconds, including reading the body. Integer 1–60,000; default 3,000. */
  readonly timeoutMs?: number;
}

/**
 * HTTP implementation used for each submission, compatible with the standard Fetch API.
 *
 * A custom transport can supply an application-managed connection pool or proxy. It should
 * honor the request's abort signal. The client bounds its own wait even if a custom transport
 * ignores cancellation; the application remains responsible for that transport's resources.
 *
 * @param url - Complete provider URL, including authentication query parameters when required.
 * @param options - POST body, headers, abort signal, and redirect policy supplied by the sender.
 * @returns The HTTP response, including its status and body. Do not log credentials in URLs or headers.
 */
export type SenderHttpTransport = (
  url: string,
  options: RequestInit,
) => Promise<Response>;

/** Configuration for the reusable sender client. */
export interface SenderClientOptions {
  /** Mandatory RPC route; provider lanes supplement it rather than replace it. */
  readonly defaultRpc: RpcRouteOptions;
  /**
   * Optional HTTP implementation. Defaults to the runtime's standard `fetch` in Node,
   * browsers, and workers. The sender does not open connections during construction.
   * Lifecycle of an injected connection pool belongs to the application.
   */
  readonly fetch?: SenderHttpTransport;
  /** Initial provider lanes. Multiple regions of the same provider are supported. */
  readonly routes?: readonly SenderRoute[];
}
