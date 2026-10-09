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
/** Stable error codes for preparation/configuration/signing failures, before any dispatch. */
export enum SenderErrorCode {
  /** Invalid client, route, endpoint, or provider options. */
  InvalidConfiguration = "INVALID_CONFIGURATION",
  /** Malformed preparation inputs or a plan not owned by this client. */
  InvalidRequest = "INVALID_REQUEST",
  /** Distinct transaction variants were requested without a shared durable nonce. */
  NonceRequired = "NONCE_REQUIRED",
  /** The per-send tip is below a configured provider's minimum. */
  TipTooLow = "TIP_TOO_LOW",
  /** The total priority fee is below a configured provider's minimum. */
  PriorityFeeTooLow = "PRIORITY_FEE_TOO_LOW",
  /** The offline compiler rejected the transaction, for example because it exceeds packet size. */
  CompilationFailed = "COMPILATION_FAILED",
  /** A signer failed, a message changed, or required signatures were missing or invalid. */
  SigningFailed = "SIGNING_FAILED",
  /** Cancellation was observed before HTTP dispatch. */
  Aborted = "ABORTED",
}
/** Structured failure. Messages never include provider credentials or remote response bodies. */
export class SenderError extends Error {
  /**
   * @param code - Stable failure category suitable for application branching.
   * @param message - Human-readable explanation without credentials or provider bodies.
   */
  constructor(
    readonly code: SenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SenderError";
  }
}
/** Shared configuration accepted by provider route factories. Creating a route performs no I/O. */
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

/** Configuration for {@link zeroSlot}, including the caller's provisioned provider plan. */
export interface ZeroSlotRouteOptions extends RouteOptions {
  /**
   * Minimum allowed tip for this provider plan: 1,000,000 lamports by default, or 100,000
   * for an advanced plan. This validates sends; actual tips still come from {@link SenderFees}.
   */
  readonly minimumTipLamports?: 100_000n | 1_000_000n;
}

/** Configuration for {@link heliusSender}. */
export interface HeliusRouteOptions extends RouteOptions {
  /** Helius submission tier. Defaults to {@link HeliusSenderMode.Max}. */
  readonly mode?: HeliusSenderMode;
}

/**
 * Immutable provider lane returned by a route factory.
 *
 * Prefer the factories to constructing this structure directly: they supply the provider's
 * endpoint, authentication convention, tip recipients, and minimum tip. Contains credentials.
 */
export interface SenderRoute {
  /** Provider whose HTTP request format and tip policy apply to this lane. */
  readonly provider: SenderProvider;
  /** Optional application label echoed as {@link RouteResult.routeName}. */
  readonly name?: string;
  /** Complete submission URL, including any caller-supplied query parameters. */
  readonly endpoint: string;
  /** Credential attached according to this provider's HTTP authentication format. */
  readonly apiKey: string;
  /** Maximum duration of each HTTP attempt, in milliseconds. */
  readonly timeoutMs: number;
  /** Minimum tip in lamports; amounts below this fail before signing. */
  readonly minimumTipLamports: bigint;
  /** Provider-approved SOL recipients. A recipient is selected once per compatible provider group. */
  readonly tipAccounts: readonly Address[];
  /** Submission tier for Helius routes; absent for other providers. */
  readonly mode?: HeliusSenderMode;
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

/** Configuration shared by the direct client constructor and fluent builder. */
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
