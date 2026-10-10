import type { Address } from "@solana/kit";
import type { SenderTransactionPayload } from "../transaction";
import type { SenderHttpRequest } from "../transport";

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
