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

/** Native provider identity; multiple routes may use the same provider. */
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
  Max = "max",
  SwqosOnly = "swqos-only",
}
/** Submission observations only: none of these indicate on-chain execution. */
export enum SubmissionStatus {
  Accepted = "accepted",
  Rejected = "rejected",
  Unknown = "unknown",
  NotSubmitted = "not-submitted",
}
/** Stable error codes for preparation/configuration/signing failures, before any dispatch. */
export enum SenderErrorCode {
  InvalidConfiguration = "INVALID_CONFIGURATION",
  InvalidRequest = "INVALID_REQUEST",
  NonceRequired = "NONCE_REQUIRED",
  TipTooLow = "TIP_TOO_LOW",
  PriorityFeeTooLow = "PRIORITY_FEE_TOO_LOW",
  CompilationFailed = "COMPILATION_FAILED",
  SigningFailed = "SIGNING_FAILED",
  Aborted = "ABORTED",
}
/** Structured failure. Messages never include provider credentials or remote response bodies. */
export class SenderError extends Error {
  constructor(
    readonly code: SenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SenderError";
  }
}
/** HTTP submission configuration. Endpoint overrides are full submission URLs, including path. */
export interface RouteOptions {
  readonly name?: string;
  readonly apiKey: string;
  readonly region?: Region;
  readonly endpoint?: string;
  /** Per-request deadline in milliseconds, including response body reading. Default: 3000. */
  readonly timeoutMs?: number;
}
/** Immutable provider configuration, produced by the route factories. Contains credentials: do not log. */
export interface SenderRoute {
  readonly provider: SenderProvider;
  readonly name?: string;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly minimumTipLamports: bigint;
  readonly tipAccounts: readonly Address[];
  readonly mode?: HeliusSenderMode;
}
/** Per-send amounts. All monetary values are atomic bigint values. No automatic fee sampling. */
export interface SenderFees {
  /** Explicit transaction CU limit, including setup, nonce and tip instructions. */
  readonly computeUnitLimit: number;
  /** Micro-lamports per requested CU; priority fee is rounded up to lamports. */
  readonly computeUnitPriceMicroLamports: bigint;
  /** Lamports attached to each provider variant; the default RPC variant is untipped. */
  readonly tipLamports: bigint;
  readonly tipOverrides?: Readonly<
    Partial<Record<Exclude<SenderProvider, SenderProvider.Rpc>, bigint>>
  >;
}
/** Offline preparation inputs. Supply exactly one lifetime. Nonce freshness/selection belongs to the caller. */
export type PrepareRequest = {
  readonly instructions: readonly Instruction[];
  readonly feePayer: Address;
  readonly lookupTables?: readonly LookupTable[];
  readonly fees: SenderFees;
} & (
  | { readonly nonce: DurableNonce; readonly lifetime?: never }
  | { readonly lifetime: BlockhashLifetime; readonly nonce?: never }
);
/** Sending uses Kit partial signers, which return signatures without modifying transaction messages. */
export type SendRequest = PrepareRequest & {
  readonly signers: readonly TransactionPartialSigner[];
  readonly signal?: AbortSignal;
  readonly onRouteResult?: (result: RouteResult) => void | Promise<void>;
};
/** Transaction and assigned route IDs; regional lanes can share one variant. */
export interface PreparedVariant {
  readonly transaction: Transaction & TransactionWithLifetime;
  readonly routeIds: readonly string[];
}
/** Prepared plans belong to the client that created them. Retain for external signing. */
export interface PreparedSubmission {
  readonly variants: readonly PreparedVariant[];
}
/** Local signature and immutable route assignment. Wire bytes are defensively copied. */
export interface SubmittedVariant {
  readonly signature: string;
  readonly routeIds: readonly string[];
  readonly wireBytes: Uint8Array;
}
/** One route's terminal transport result. Unknown means bytes may have reached the provider. */
export interface RouteResult {
  readonly routeId: string;
  readonly routeName?: string;
  readonly provider: SenderProvider;
  readonly signature: string;
  readonly status: SubmissionStatus;
  readonly elapsedMs: number;
  readonly httpStatus?: number;
}
/** All routes have been launched when this is returned. Results never wait for chain confirmation. */
export interface Submission {
  readonly variants: readonly SubmittedVariant[];
  readonly results: Promise<readonly RouteResult[]>;
}
/** Explicit default RPC plus optional provider lanes. No timers/connections start at construction. */
export interface SenderClientOptions {
  readonly defaultRpc: { readonly url: string; readonly timeoutMs?: number };
  /** Injectable HTTP transport, e.g. a caller-managed connection pool. */
  readonly fetch?: typeof globalThis.fetch;
  readonly routes?: readonly SenderRoute[];
}
